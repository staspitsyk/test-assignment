import { Inject, Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from 'src/config/config.token';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly subClient: Redis;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.client = new Redis(this.config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.subClient = this.client.duplicate();

    this.client.on('error', (err: Error) => {
      this.logger.error({ event: 'redis_client_error', error: err.message }, err.stack);
    });

    this.subClient.on('error', (err: Error) => {
      this.logger.error({ event: 'redis_sub_client_error', error: err.message }, err.stack);
    });
  }

  public getClient(): Redis {
    return this.client;
  }

  public getSubscriber(): Redis {
    return this.subClient;
  }

  public async ping(): Promise<string> {
    return this.client.ping();
  }

  public async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<'OK'> {
    if (ttlSeconds && ttlSeconds > 0) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  public async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  public async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<'OK'> {
    const jsonStr = JSON.stringify(value);
    return this.set(key, jsonStr, ttlSeconds);
  }

  public async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  public async subscribe(
    channel: string,
    onMessage: (channel: string, message: string) => void,
  ): Promise<void> {
    await this.subClient.subscribe(channel);
    this.subClient.on('message', (chan, msg) => {
      if (chan === channel) {
        onMessage(chan, msg);
      }
    });
  }

  public async onModuleDestroy(): Promise<void> {
    this.logger.log({ event: 'redis_disconnecting' });
    await Promise.allSettled([
      this.client.quit().catch(() => this.client.disconnect()),
      this.subClient.quit().catch(() => this.subClient.disconnect()),
    ]);
  }
}
