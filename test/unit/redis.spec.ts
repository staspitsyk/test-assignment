import { AppConfig } from 'src/config/config.token';
import { RedisService } from 'src/shared/redis/redis.service';

const mockRedisClient = {
  on: jest.fn(),
  duplicate: jest.fn(),
  ping: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  publish: jest.fn(),
  subscribe: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
};

const mockSubClient = {
  on: jest.fn(),
  subscribe: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
};

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockRedisClient),
  };
});

describe('RedisService Unit Tests', () => {
  let redisService: RedisService;
  const mockConfig: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3000,
    REDIS_URL: 'redis://localhost:6379',
    DA_BASE_URL: 'https://www.docketalarm.com/api/v1.1',
    DA_USERNAME: 'user',
    DA_PASSWORD: 'pass',
    DA_TEST_MODE: true,
    CACHE_TTL_SECONDS: 1800,
    CACHE_STALE_SECONDS: 300,
    LOG_LEVEL: 'info',
    ALIAS_CONFIDENCE_THRESHOLD: 0.5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.duplicate.mockReturnValue(mockSubClient);
    redisService = new RedisService(mockConfig);
  });

  it('should initialize primary client and subscriber client', () => {
    expect(redisService.getClient()).toBe(mockRedisClient);
    expect(redisService.getSubscriber()).toBe(mockSubClient);
  });

  it('should call ping on client', async () => {
    mockRedisClient.ping.mockResolvedValue('PONG');
    const res = await redisService.ping();
    expect(res).toBe('PONG');
    expect(mockRedisClient.ping).toHaveBeenCalled();
  });

  it('should get and set values', async () => {
    mockRedisClient.get.mockResolvedValue('val');
    mockRedisClient.set.mockResolvedValue('OK');

    const getRes = await redisService.get('key');
    expect(getRes).toBe('val');

    const setRes = await redisService.set('key', 'val', 60);
    expect(setRes).toBe('OK');
    expect(mockRedisClient.set).toHaveBeenCalledWith('key', 'val', 'EX', 60);
  });

  it('should get and set JSON objects', async () => {
    const payload = { a: 1, b: 'test' };
    mockRedisClient.get.mockResolvedValue(JSON.stringify(payload));
    mockRedisClient.set.mockResolvedValue('OK');

    const jsonRes = await redisService.getJson<typeof payload>('jsonKey');
    expect(jsonRes).toEqual(payload);

    await redisService.setJson('jsonKey', payload, 120);
    expect(mockRedisClient.set).toHaveBeenCalledWith('jsonKey', JSON.stringify(payload), 'EX', 120);
  });

  it('should gracefully quit connections on module destroy', async () => {
    await redisService.onModuleDestroy();
    expect(mockRedisClient.quit).toHaveBeenCalled();
    expect(mockSubClient.quit).toHaveBeenCalled();
  });
});
