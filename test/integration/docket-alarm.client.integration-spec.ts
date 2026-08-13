import { Test, TestingModule } from '@nestjs/testing';
import { MockAgent } from 'undici';
import { APP_CONFIG, AppConfig } from 'src/config/config.token';
import { RedisService } from 'src/shared/redis/redis.service';
import { MetricsService } from 'src/shared/observability/metrics.service';
import { DocketAlarmClient } from 'src/docket-alarm/docket-alarm.client';
import { TokenService } from 'src/docket-alarm/docket-alarm.token.service';
import { DocketAlarmLimiter } from 'src/docket-alarm/docket-alarm.limiter';
import { DocketAlarmPolicy } from 'src/docket-alarm/docket-alarm.policy';
import { UNDICI_DISPATCHER } from 'src/docket-alarm/docket-alarm.http';
import {
  UpstreamAuthFailedException,
  UpstreamRateLimitedException,
  UpstreamUnavailableException,
} from 'src/shared/errors/domain.errors';

describe('DocketAlarmClient (Integration with MockAgent)', () => {
  // Retry backoffs (cockatiel decorrelated jitter, up to 5s per delay) plus 3 attempts can
  // push a fully-failing call past the default 5s Jest timeout. This suite exercises the
  // resilience wrapper, so give it room.
  jest.setTimeout(20_000);

  let moduleRef: TestingModule;
  let client: DocketAlarmClient;
  let mockAgent: MockAgent;
  let mockPool: ReturnType<MockAgent['get']>;
  let redisServiceMock: Partial<RedisService>;
  let redisClientMock: { set: jest.Mock; get: jest.Mock; del: jest.Mock };

  const mockConfig: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3000,
    REDIS_URL: 'redis://localhost:6379',
    DA_BASE_URL: 'https://www.docketalarm.com/api/v1.1',
    DA_USERNAME: 'testuser',
    DA_PASSWORD: 'testpassword',
    DA_TEST_MODE: true,
    CACHE_TTL_SECONDS: 1800,
    CACHE_STALE_SECONDS: 300,
    LOG_LEVEL: 'info',
    ALIAS_CONFIDENCE_THRESHOLD: 0.5,
  };

  beforeEach(async () => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    mockPool = mockAgent.get('https://www.docketalarm.com');

    // Stateful mock: setJson stores, getJson reads back, del clears.
    // Prevents redundant login-limiter contention across retries — a fresh token from
    // setJson must be visible to subsequent getJson calls, otherwise every retry loop
    // re-runs login and stalls on the 1-req/60s login reservoir.
    const store = new Map<string, unknown>();
    redisClientMock = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockImplementation((key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      }),
    };

    redisServiceMock = {
      getClient: jest.fn().mockReturnValue(redisClientMock),
      getJson: jest.fn().mockImplementation(async (key: string) => {
        return store.get(key) ?? null;
      }),
      setJson: jest.fn().mockImplementation(async (key: string, value: unknown) => {
        store.set(key, value);
        return 'OK';
      }),
      publish: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockImplementation(async (key: string) => {
        store.delete(key);
        return 1;
      }),
      subscribe: jest.fn().mockResolvedValue(undefined),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        DocketAlarmLimiter,
        DocketAlarmPolicy,
        DocketAlarmClient,
        MetricsService,
        { provide: APP_CONFIG, useValue: mockConfig },
        { provide: UNDICI_DISPATCHER, useValue: mockAgent },
        { provide: RedisService, useValue: redisServiceMock },
      ],
    }).compile();

    client = moduleRef.get<DocketAlarmClient>(DocketAlarmClient);
  });

  afterEach(async () => {
    if (mockAgent) {
      mockAgent.close();
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('performs happy path search returning search results', async () => {
    mockPool
      .intercept({ path: '/api/v1.1/login/', method: 'POST' })
      .reply(200, { success: true, login_token: 'valid-test-token' })
      .persist();

    mockPool
      .intercept({
        path: (p: string) => p.includes('/api/v1.1/search/'),
        method: 'GET',
      })
      .reply(200, {
        count: 1,
        search_results: [
          {
            court: 'U.S. District Court',
            docket: '1:23-cv-00100',
            title: 'Apple Inc. v. Samsung',
            link: 'https://www.docketalarm.com/cases/123',
            date_filed: '2025-01-15',
          },
        ],
      });

    const res = await client.search('party:(name:"Apple Inc.") AND is:docket');

    expect(res.count).toBe(1);
    expect(res.search_results).toHaveLength(1);
    expect(res.search_results[0].court).toBe('U.S. District Court');
    expect(res.search_results[0].docket).toBe('1:23-cv-00100');
  });

  it('invalidates token and throws UpstreamAuthFailedException on HTTP 401', async () => {
    mockPool
      .intercept({ path: '/api/v1.1/login/', method: 'POST' })
      .reply(200, { success: true, login_token: 'bad-auth-token' })
      .persist();

    mockPool
      .intercept({
        path: (p: string) => p.includes('/api/v1.1/search/'),
        method: 'GET',
      })
      .reply(401, { success: false, error: 'Unauthorized token' })
      .persist();

    // With the one-shot 401 retry, the client will call search twice within a single
    // policy attempt (invalidate + fresh token + retry). Persist the 401 so the second
    // call also matches an interceptor; then AuthFailedException throws deterministically.
    await expect(
      client.search('party:(name:"John Doe") AND is:docket'),
    ).rejects.toThrow(UpstreamAuthFailedException);

    expect(redisServiceMock.del).toHaveBeenCalledWith('da:token');
  });

  it('triggers AIMD backoff and throws UpstreamRateLimitedException on HTTP 429', async () => {
    mockPool
      .intercept({ path: '/api/v1.1/login/', method: 'POST' })
      .reply(200, { success: true, login_token: 'rate-limit-test-token' })
      .persist();

    mockPool
      .intercept({
        path: (p: string) => p.includes('/api/v1.1/search/'),
        method: 'GET',
      })
      .reply(
        429,
        { success: false, error: 'Rate limit exceeded' },
        { headers: { 'retry-after': '5' } },
      )
      .persist();

    try {
      await client.search('party:(name:"Jane Doe") AND is:docket');
      fail('Expected search to throw UpstreamRateLimitedException');
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamRateLimitedException);
      expect((err as UpstreamRateLimitedException).retryAfter).toBe(5);
    }
  });

  it('throws UpstreamUnavailableException on HTTP 503 upstream error', async () => {
    mockPool
      .intercept({ path: '/api/v1.1/login/', method: 'POST' })
      .reply(200, { success: true, login_token: '503-test-token' })
      .persist();

    mockPool
      .intercept({
        path: (p: string) => p.includes('/api/v1.1/search/'),
        method: 'GET',
      })
      .reply(503, 'Service Temporarily Unavailable')
      .persist();

    await expect(
      client.search('party:(name:"Acme Corp") AND is:docket'),
    ).rejects.toThrow(UpstreamUnavailableException);
  });
});
