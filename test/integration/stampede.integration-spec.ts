import { Test, TestingModule } from '@nestjs/testing';
import { MockAgent } from 'undici';
import { ClsModule } from 'nestjs-cls';
import { APP_CONFIG, AppConfig } from 'src/config/config.token';
import { RedisService } from 'src/shared/redis/redis.service';
import { UNDICI_DISPATCHER } from 'src/docket-alarm/docket-alarm.http';
import { TokenService } from 'src/docket-alarm/docket-alarm.token.service';
import { DocketAlarmLimiter } from 'src/docket-alarm/docket-alarm.limiter';
import { DocketAlarmPolicy } from 'src/docket-alarm/docket-alarm.policy';
import { DocketAlarmClient } from 'src/docket-alarm/docket-alarm.client';
import { QueryPlanner } from 'src/legal-results/query-planner/query-planner';
import { FanoutService } from 'src/legal-results/alias-fanout/fanout.service';
import { ResultCacheService } from 'src/legal-results/cache/result-cache.service';
import { LegalResultsService } from 'src/legal-results/legal-results.service';
import { MetricsService } from 'src/shared/observability/metrics.service';
import { LegalResultsRequestDto } from 'src/legal-results/dto/request.dto';

describe('Stampede Integration Test', () => {
  let moduleRef: TestingModule;
  let legalResultsService: LegalResultsService;
  let mockAgent: MockAgent;
  let mockPool: ReturnType<MockAgent['get']>;
  let searchCallCount = 0;

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
    searchCallCount = 0;
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    mockPool = mockAgent.get('https://www.docketalarm.com');

    const store = new Map<string, string>();
    const redisClientMock = {
      get: jest.fn().mockImplementation((k: string) => Promise.resolve(store.get(k) ?? null)),
      set: jest.fn().mockImplementation((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      }),
      del: jest.fn().mockImplementation((k: string) => {
        store.delete(k);
        return Promise.resolve(1);
      }),
      ttl: jest.fn().mockResolvedValue(1800),
      ping: jest.fn().mockResolvedValue('PONG'),
      on: jest.fn(),
    };

    const redisServiceMock = {
      getClient: jest.fn().mockReturnValue(redisClientMock),
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue('OK'),
      publish: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(undefined),
    };

    moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true })],
      providers: [
        TokenService,
        DocketAlarmLimiter,
        DocketAlarmPolicy,
        DocketAlarmClient,
        QueryPlanner,
        FanoutService,
        MetricsService,
        ResultCacheService,
        LegalResultsService,
        { provide: APP_CONFIG, useValue: mockConfig },
        { provide: UNDICI_DISPATCHER, useValue: mockAgent },
        { provide: RedisService, useValue: redisServiceMock },
      ],
    }).compile();

    legalResultsService = moduleRef.get<LegalResultsService>(LegalResultsService);
  });

  afterEach(async () => {
    if (mockAgent) {
      mockAgent.close();
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('coalesces 50 concurrent identical requests to EXACTLY 1 upstream DA call', async () => {
    mockPool
      .intercept({ path: '/api/v1.1/login/', method: 'POST' })
      .reply(200, { success: true, login_token: 'stampede-valid-token' })
      .persist();

    mockPool
      .intercept({
        path: (p: string) => p.includes('/api/v1.1/search/'),
        method: 'GET',
      })
      .reply(() => {
        searchCallCount++;
        return {
          statusCode: 200,
          data: JSON.stringify({
            count: 1,
            search_results: [
              {
                court: 'U.S. District Court',
                docket: '1:25-cv-00055',
                title: 'Westlake Services LLC v. Sample Corp',
                link: 'https://www.docketalarm.com/cases/55',
                date_filed: '2025-03-01',
              },
            ],
          }),
        };
      })
      .persist();

    const requestDto: LegalResultsRequestDto = {
      entityId: 55,
      entityType: 'Company',
      sender: 'INTELLIGO',
      entityDetails: {
        name: [
          {
            full: 'Westlake Services',
            confidence: 1.0,
            type: 'LLC',
          },
        ],
        address: [],
      },
    };

    // Fire 50 concurrent identical requests
    const promises = Array.from({ length: 50 }, () =>
      legalResultsService.getLegalResults(requestDto, false, 'stampede-test-req'),
    );

    const responses = await Promise.all(promises);

    expect(responses).toHaveLength(50);
    // Coalesced: exactly 1 single query planner run executed (1 probe call + 1 page fetch call = 2 total DA calls across 50 requests)
    expect(searchCallCount).toBeLessThanOrEqual(2);

    for (const res of responses) {
      expect(res.results).toHaveLength(1);
      expect(res.results[0].docket).toBe('1:25-cv-00055');
      expect(res.meta.entityId).toBe(55);
      expect(res.meta.entityType).toBe('Company');
    }
  });
});
