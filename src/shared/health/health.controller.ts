import { Controller, Get, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { RedisService } from 'src/shared/redis/redis.service';

@Injectable()
export class ReadinessStateService {
  private isReadyFlag = true;

  public setReady(ready: boolean): void {
    this.isReadyFlag = ready;
  }

  public isReady(): boolean {
    return this.isReadyFlag;
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisService: RedisService,
    private readonly readinessState: ReadinessStateService,
  ) {}

  @Get('live')
  @HealthCheck()
  public async checkLiveness(): Promise<HealthCheckResult> {
    return this.health.check([
      async (): Promise<HealthIndicatorResult> => ({
        process: { status: 'up' },
      }),
    ]);
  }

  @Get('ready')
  @HealthCheck()
  public async checkReadiness(): Promise<HealthCheckResult> {
    if (!this.readinessState.isReady()) {
      throw new ServiceUnavailableException({
        status: 'error',
        readiness: { status: 'down', message: 'Service is shutting down' },
      });
    }

    return this.health.check([
      async (): Promise<HealthIndicatorResult> => {
        try {
          const pong = await this.redisService.ping();
          const isUp = pong === 'PONG';
          return {
            redis: {
              status: isUp ? 'up' : 'down',
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new ServiceUnavailableException({
            redis: {
              status: 'down',
              message,
            },
          });
        }
      },
    ]);
  }
}
