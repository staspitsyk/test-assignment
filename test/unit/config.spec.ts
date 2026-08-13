import { envSchema, validateEnv } from 'src/config/config.schema';

describe('ConfigModule Unit Tests', () => {
  const validBaseEnv = {
    DA_USERNAME: 'test_user',
    DA_PASSWORD: 'test_password',
  };

  it('should parse valid environment variables with correct defaults', () => {
    const config = envSchema.parse(validBaseEnv);

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
    expect(config.DA_BASE_URL).toBe('https://www.docketalarm.com/api/v1.1');
    expect(config.DA_USERNAME).toBe('test_user');
    expect(config.DA_PASSWORD).toBe('test_password');
    expect(config.DA_TEST_MODE).toBe(false);
    expect(config.CACHE_TTL_SECONDS).toBe(1800);
    expect(config.CACHE_STALE_SECONDS).toBe(300);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.ALIAS_CONFIDENCE_THRESHOLD).toBe(0.5);
  });

  it('should allow custom overrides for environment variables', () => {
    const customEnv = {
      NODE_ENV: 'production',
      PORT: '8080',
      REDIS_URL: 'redis://redis-cluster:6379',
      DA_BASE_URL: 'https://custom.docketalarm.com/api',
      DA_USERNAME: 'prod_user',
      DA_PASSWORD: 'prod_password',
      DA_TEST_MODE: 'true',
      CACHE_TTL_SECONDS: '3600',
      CACHE_STALE_SECONDS: '600',
      LOG_LEVEL: 'debug',
      ALIAS_CONFIDENCE_THRESHOLD: '0.8',
    };

    const config = envSchema.parse(customEnv);

    expect(config.NODE_ENV).toBe('production');
    expect(config.PORT).toBe(8080);
    expect(config.REDIS_URL).toBe('redis://redis-cluster:6379');
    expect(config.DA_BASE_URL).toBe('https://custom.docketalarm.com/api');
    expect(config.DA_TEST_MODE).toBe(true);
    expect(config.CACHE_TTL_SECONDS).toBe(3600);
    expect(config.CACHE_STALE_SECONDS).toBe(600);
    expect(config.LOG_LEVEL).toBe('debug');
    expect(config.ALIAS_CONFIDENCE_THRESHOLD).toBe(0.8);
  });

  it('should fail validation when DA_USERNAME is missing', () => {
    const invalidEnv = {
      DA_PASSWORD: 'test_password',
    };

    expect(() => validateEnv(invalidEnv)).toThrow('[ConfigModule] Invalid environment variables');
  });

  it('should fail validation when DA_PASSWORD is missing', () => {
    const invalidEnv = {
      DA_USERNAME: 'test_user',
    };

    expect(() => validateEnv(invalidEnv)).toThrow('[ConfigModule] Invalid environment variables');
  });

  it('should fail validation when ALIAS_CONFIDENCE_THRESHOLD is out of range', () => {
    const invalidEnv = {
      ...validBaseEnv,
      ALIAS_CONFIDENCE_THRESHOLD: '1.5',
    };

    expect(() => validateEnv(invalidEnv)).toThrow('[ConfigModule] Invalid environment variables');
  });
});
