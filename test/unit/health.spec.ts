import { ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckService } from '@nestjs/terminus';
import { HealthController, ReadinessStateService } from 'src/shared/health/health.controller';
import { RedisService } from 'src/shared/redis/redis.service';

describe('HealthController Unit Tests', () => {
  let healthController: HealthController;
  let readinessService: ReadinessStateService;
  let mockHealthCheckService: jest.Mocked<HealthCheckService>;
  let mockRedisService: jest.Mocked<RedisService>;

  beforeEach(() => {
    readinessService = new ReadinessStateService();
    mockHealthCheckService = {
      check: jest.fn().mockImplementation((indicators) =>
        Promise.all(indicators.map((fn: () => any) => fn())).then((results) => ({
          status: 'ok',
          info: Object.assign({}, ...results),
          error: {},
          details: Object.assign({}, ...results),
        })),
      ),
    } as unknown as jest.Mocked<HealthCheckService>;

    mockRedisService = {
      ping: jest.fn().mockResolvedValue('PONG'),
    } as unknown as jest.Mocked<RedisService>;

    healthController = new HealthController(
      mockHealthCheckService,
      mockRedisService,
      readinessService,
    );
  });

  it('should return liveness status', async () => {
    const res = await healthController.checkLiveness();
    expect(res.status).toBe('ok');
    expect(res.info).toEqual({ process: { status: 'up' } });
  });

  it('should return readiness status when ready and Redis ping succeeds', async () => {
    const res = await healthController.checkReadiness();
    expect(res.status).toBe('ok');
    expect(res.info).toEqual({ redis: { status: 'up' } });
  });

  it('should throw ServiceUnavailableException when readiness flag is false', async () => {
    readinessService.setReady(false);
    await expect(healthController.checkReadiness()).rejects.toThrow(ServiceUnavailableException);
  });

  it('should throw ServiceUnavailableException when Redis ping fails', async () => {
    mockRedisService.ping.mockRejectedValue(new Error('Connection refused'));
    await expect(healthController.checkReadiness()).rejects.toThrow(ServiceUnavailableException);
  });
});
