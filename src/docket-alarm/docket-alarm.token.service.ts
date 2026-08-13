import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Dispatcher } from 'undici';
import { APP_CONFIG, AppConfig } from 'src/config/config.token';
import { RedisService } from 'src/shared/redis/redis.service';
import { UpstreamAuthFailedException } from 'src/shared/errors/domain.errors';
import { UNDICI_DISPATCHER } from './docket-alarm.http';
import { DaLoginResponse } from './docket-alarm.types';

export interface CachedTokenData {
  token: string;
  expiresAt: number;
}

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(UNDICI_DISPATCHER) private readonly dispatcher: Dispatcher,
    private readonly redisService: RedisService,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.redisService.subscribe('da:token:new', (_channel, message) => {
      this.logger.debug({ event: 'da_token_pubsub_received', messageLength: message.length });
    });
  }

  public async getToken(): Promise<string> {
    const cached = await this.redisService.getJson<CachedTokenData>('da:token');
    const now = Date.now();

    if (cached && cached.token && cached.expiresAt) {
      const remainingMs = cached.expiresAt - now;

      // Pre-expiry window: 10 minutes (600,000 ms)
      if (remainingMs > 600_000) {
        return cached.token;
      }

      if (remainingMs > 0) {
        // Probabilistic warm pre-expiry refresh
        this.refreshToken().catch((err: Error) => {
          this.logger.warn({
            event: 'background_token_refresh_failed',
            error: err.message,
          });
        });
        return cached.token;
      }
    }

    return this.refreshToken();
  }

  public async refreshToken(): Promise<string> {
    const lockId = randomUUID();
    const redisClient = this.redisService.getClient();

    const acquired = await redisClient.set('da:token:refresh', lockId, 'PX', 30_000, 'NX');

    if (!acquired) {
      return this.waitForToken();
    }

    try {
      const loginToken = await this.executeLogin();
      const expiresAt = Date.now() + 90 * 60 * 1000;
      const tokenData: CachedTokenData = { token: loginToken, expiresAt };

      await this.redisService.setJson('da:token', tokenData, 5400);
      await this.redisService.publish('da:token:new', loginToken);

      this.logger.log({ event: 'da_token_refreshed', expiresAt });
      return loginToken;
    } finally {
      const currentLock = await redisClient.get('da:token:refresh');
      if (currentLock === lockId) {
        await redisClient.del('da:token:refresh');
      }
    }
  }

  public async invalidateToken(): Promise<void> {
    this.logger.warn({ event: 'da_token_invalidated' });
    await this.redisService.del('da:token');
  }

  private async waitForToken(maxWaitMs = 5000): Promise<string> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const cached = await this.redisService.getJson<CachedTokenData>('da:token');
      if (cached && cached.token && cached.expiresAt > Date.now()) {
        return cached.token;
      }
    }
    throw new UpstreamAuthFailedException('Timed out waiting for token election refresh');
  }

  private async executeLogin(): Promise<string> {
    const parsedBaseUrl = new URL(this.config.DA_BASE_URL);
    const origin = parsedBaseUrl.origin;
    const loginPath = `${parsedBaseUrl.pathname.replace(/\/$/, '')}/login/`;

    const body = new URLSearchParams({
      username: this.config.DA_USERNAME,
      password: this.config.DA_PASSWORD,
    }).toString();

    try {
      const response = await this.dispatcher.request({
        origin,
        path: loginPath,
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
      });

      const rawText = await response.body.text();
      let resData: DaLoginResponse;
      try {
        resData = JSON.parse(rawText) as DaLoginResponse;
      } catch {
        this.logger.error({ event: 'da_upstream_error', error: rawText });
        throw new UpstreamAuthFailedException('Invalid JSON response from DocketAlarm login');
      }

      if (response.statusCode !== 200 || resData.success === false || !resData.login_token) {
        const errMsg = resData.error || `HTTP status ${response.statusCode}`;
        this.logger.error({ event: 'da_upstream_error', error: errMsg });
        throw new UpstreamAuthFailedException();
      }

      return resData.login_token;
    } catch (err: unknown) {
      if (err instanceof UpstreamAuthFailedException) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ event: 'da_upstream_error', error: msg });
      throw new UpstreamAuthFailedException();
    }
  }
}
