import { Test, TestingModule } from '@nestjs/testing';
import { Dispatcher } from 'undici';
import { APP_CONFIG, AppConfig } from 'src/config/config.token';
import { RedisService } from 'src/shared/redis/redis.service';
import { UpstreamAuthFailedException } from 'src/shared/errors/domain.errors';
import { TokenService, CachedTokenData } from 'src/docket-alarm/docket-alarm.token.service';
import { UNDICI_DISPATCHER } from 'src/docket-alarm/docket-alarm.http';

describe('TokenService', () => {
  let service: TokenService;
  let redisServiceMock: Partial<RedisService>;
  let dispatcherMock: Partial<Dispatcher>;
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
    redisClientMock = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };

    redisServiceMock = {
      getClient: jest.fn().mockReturnValue(redisClientMock),
      getJson: jest.fn(),
      setJson: jest.fn().mockResolvedValue('OK'),
      publish: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(undefined),
    };

    dispatcherMock = {
      request: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: APP_CONFIG, useValue: mockConfig },
        { provide: UNDICI_DISPATCHER, useValue: dispatcherMock },
        { provide: RedisService, useValue: redisServiceMock },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getToken', () => {
    it('returns valid cached token when far from expiration (> 10 min remaining)', async () => {
      const futureExpiry = Date.now() + 60 * 60 * 1000; // 60 mins left
      const cachedData: CachedTokenData = {
        token: 'cached-valid-token-123',
        expiresAt: futureExpiry,
      };

      (redisServiceMock.getJson as jest.Mock).mockResolvedValue(cachedData);

      const token = await service.getToken();

      expect(token).toBe('cached-valid-token-123');
      expect(redisServiceMock.getJson).toHaveBeenCalledWith('da:token');
      expect(redisClientMock.set).not.toHaveBeenCalled();
    });

    it('returns cached token and triggers background refresh when within 10 min pre-expiry window', async () => {
      const nearExpiry = Date.now() + 5 * 60 * 1000; // 5 mins left (< 10 min threshold)
      const cachedData: CachedTokenData = {
        token: 'pre-expiry-token-456',
        expiresAt: nearExpiry,
      };

      (redisServiceMock.getJson as jest.Mock).mockResolvedValue(cachedData);
      redisClientMock.set.mockResolvedValue('OK');
      redisClientMock.get.mockResolvedValue('lock-id-123');

      (dispatcherMock.request as jest.Mock).mockResolvedValue({
        statusCode: 200,
        body: {
          text: jest.fn().mockResolvedValue(
            JSON.stringify({ success: true, login_token: 'new-refreshed-token-789' }),
          ),
        },
      });

      const token = await service.getToken();

      expect(token).toBe('pre-expiry-token-456');
      expect(redisServiceMock.getJson).toHaveBeenCalledWith('da:token');
    });

    it('refreshes token synchronously when token is missing from cache', async () => {
      (redisServiceMock.getJson as jest.Mock).mockResolvedValue(null);
      redisClientMock.set.mockResolvedValue('OK');

      (dispatcherMock.request as jest.Mock).mockResolvedValue({
        statusCode: 200,
        body: {
          text: jest.fn().mockResolvedValue(
            JSON.stringify({ success: true, login_token: 'fresh-login-token-999' }),
          ),
        },
      });

      const token = await service.getToken();

      expect(token).toBe('fresh-login-token-999');
      expect(redisClientMock.set).toHaveBeenCalledWith(
        'da:token:refresh',
        expect.any(String),
        'PX',
        30000,
        'NX',
      );
      expect(redisServiceMock.setJson).toHaveBeenCalledWith(
        'da:token',
        expect.objectContaining({ token: 'fresh-login-token-999' }),
        5400,
      );
      expect(redisServiceMock.publish).toHaveBeenCalledWith('da:token:new', 'fresh-login-token-999');
    });
  });

  describe('refreshToken', () => {
    it('throws UpstreamAuthFailedException when upstream login returns non-200 or success: false', async () => {
      redisClientMock.set.mockResolvedValue('OK');

      (dispatcherMock.request as jest.Mock).mockResolvedValue({
        statusCode: 401,
        body: {
          text: jest.fn().mockResolvedValue(
            JSON.stringify({ success: false, error: 'Invalid credentials' }),
          ),
        },
      });

      await expect(service.refreshToken()).rejects.toThrow(UpstreamAuthFailedException);
    });
  });

  describe('invalidateToken', () => {
    it('deletes da:token key from Redis', async () => {
      await service.invalidateToken();
      expect(redisServiceMock.del).toHaveBeenCalledWith('da:token');
    });
  });
});
