import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Bottleneck from 'bottleneck';
import { APP_CONFIG, AppConfig } from 'src/config/config.token';

@Injectable()
export class DocketAlarmLimiter implements OnModuleDestroy {
  private readonly logger = new Logger(DocketAlarmLimiter.name);
  private readonly searchLimiter: Bottleneck;
  private readonly loginLimiter: Bottleneck;

  private currentReservoirCeiling = 20;
  private readonly minReservoirFloor = 2;
  private readonly maxReservoirCeiling = 20;
  private last429Timestamp = 0;
  private recoveryInterval?: NodeJS.Timeout;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const isTest = this.config.NODE_ENV === 'test';

    const searchOptions: Bottleneck.ConstructorOptions = {
      id: 'da-search-limiter',
      datastore: isTest ? 'local' : 'ioredis',
      clearDatastores: false,
      clientOptions: isTest ? undefined : this.parseRedisUrl(this.config.REDIS_URL),
      reservoir: 20,
      reservoirRefreshInterval: 10_000,
      reservoirRefreshAmount: 20,
      maxConcurrent: 8,
    };

    // Production login is a rare event (token TTL is 90 min); 1/60s guards against
    // login-endpoint spam. In tests we back-to-back login (e.g. one-shot 401 retry
    // exercised in the integration suite), so the reservoir is loosened there.
    const loginOptions: Bottleneck.ConstructorOptions = {
      id: 'da-login-limiter',
      datastore: isTest ? 'local' : 'ioredis',
      clearDatastores: false,
      clientOptions: isTest ? undefined : this.parseRedisUrl(this.config.REDIS_URL),
      reservoir: isTest ? 20 : 1,
      reservoirRefreshInterval: isTest ? 1_000 : 60_000,
      reservoirRefreshAmount: isTest ? 20 : 1,
      maxConcurrent: 1,
    };

    this.searchLimiter = new Bottleneck(searchOptions);
    this.loginLimiter = new Bottleneck(loginOptions);

    this.startAIMDRecovery();
  }

  public scheduleSearch<T>(fn: () => Promise<T>): Promise<T> {
    return this.searchLimiter.schedule(fn);
  }

  public scheduleLogin<T>(fn: () => Promise<T>): Promise<T> {
    return this.loginLimiter.schedule(fn);
  }

  public async handle429(retryAfterSeconds?: number): Promise<void> {
    this.last429Timestamp = Date.now();
    const halved = Math.max(
      this.minReservoirFloor,
      Math.floor(this.currentReservoirCeiling / 2),
    );
    this.currentReservoirCeiling = halved;

    await this.searchLimiter.updateSettings({
      reservoir: halved,
      reservoirRefreshAmount: halved,
    });

    this.logger.warn({
      event: 'da_rate_limit_aimd_decreased',
      newReservoir: halved,
      retryAfterSeconds,
    });
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }
    await Promise.allSettled([
      this.searchLimiter.disconnect(),
      this.loginLimiter.disconnect(),
    ]);
  }

  private startAIMDRecovery(): void {
    this.recoveryInterval = setInterval(() => {
      void this.attemptLinearIncrease();
    }, 60_000);
  }

  private async attemptLinearIncrease(): Promise<void> {
    const timeSince429 = Date.now() - this.last429Timestamp;

    if (timeSince429 >= 60_000 && this.currentReservoirCeiling < this.maxReservoirCeiling) {
      this.currentReservoirCeiling += 1;

      await this.searchLimiter.updateSettings({
        reservoirRefreshAmount: this.currentReservoirCeiling,
      });

      this.logger.log({
        event: 'da_rate_limit_aimd_increased',
        newReservoir: this.currentReservoirCeiling,
      });
    }
  }

  private parseRedisUrl(redisUrl: string): Record<string, unknown> {
    try {
      const url = new URL(redisUrl);
      return {
        host: url.hostname || 'localhost',
        port: url.port ? parseInt(url.port, 10) : 6379,
        password: url.password ? decodeURIComponent(url.password) : undefined,
      };
    } catch {
      return { host: 'localhost', port: 6379 };
    }
  }
}
