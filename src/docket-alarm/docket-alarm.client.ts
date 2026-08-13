import { Inject, Injectable, Logger } from '@nestjs/common';
import { Dispatcher } from 'undici';
import { APP_CONFIG, AppConfig } from 'src/config/config.token';
import { UNDICI_DISPATCHER } from './docket-alarm.http';
import { TokenService } from './docket-alarm.token.service';
import { DocketAlarmLimiter } from './docket-alarm.limiter';
import { DocketAlarmPolicy } from './docket-alarm.policy';
import { mapDocketAlarmError } from './docket-alarm.errors';
import { DaSearchResponse } from './docket-alarm.types';

@Injectable()
export class DocketAlarmClient {
  private readonly logger = new Logger(DocketAlarmClient.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(UNDICI_DISPATCHER) private readonly dispatcher: Dispatcher,
    private readonly tokenService: TokenService,
    private readonly limiter: DocketAlarmLimiter,
    private readonly policy: DocketAlarmPolicy,
  ) {}

  public async search(
    query: string,
    limit = 50,
    offset = 0,
  ): Promise<DaSearchResponse> {
    return this.limiter.scheduleSearch(() =>
      this.policy.execute(() => this.executeSearch(query, limit, offset)),
    );
  }

  private async executeSearch(
    query: string,
    limit: number,
    offset: number,
  ): Promise<DaSearchResponse> {
    const token = await this.tokenService.getToken();

    const parsedBaseUrl = new URL(this.config.DA_BASE_URL);
    const origin = parsedBaseUrl.origin;
    const searchBasePath = `${parsedBaseUrl.pathname.replace(/\/$/, '')}/search/`;

    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      offset: String(offset),
      o: '-date_filed',
    });

    if (this.config.NODE_ENV === 'test' || this.config.DA_TEST_MODE) {
      params.set('test', '1');
    }

    const path = `${searchBasePath}?${params.toString()}`;

    try {
      const response = await this.dispatcher.request({
        origin,
        path,
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
      });

      const rawText = await response.body.text();

      if (response.statusCode === 401) {
        await this.tokenService.invalidateToken();
        throw mapDocketAlarmError(401, rawText || 'Unauthorized token', this.logger);
      }

      if (response.statusCode === 429) {
        const retryAfterHeader = response.headers['retry-after'];
        const retryAfterSeconds = this.parseRetryAfter(retryAfterHeader);
        await this.limiter.handle429(retryAfterSeconds);
        throw mapDocketAlarmError(
          429,
          rawText || 'Rate limit exceeded',
          this.logger,
          retryAfterSeconds,
        );
      }

      if (response.statusCode !== 200) {
        throw mapDocketAlarmError(response.statusCode, rawText, this.logger);
      }

      let resData: DaSearchResponse;
      try {
        resData = JSON.parse(rawText) as DaSearchResponse;
      } catch {
        throw mapDocketAlarmError(200, 'Invalid JSON response from upstream search', this.logger);
      }

      if (resData.success === false || resData.error) {
        throw mapDocketAlarmError(200, resData, this.logger);
      }

      return {
        count: resData.count ?? 0,
        search_results: resData.search_results ?? [],
        success: resData.success ?? true,
      };
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        'status' in err
      ) {
        throw err;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw mapDocketAlarmError(500, errorMsg, this.logger);
    }
  }

  private parseRetryAfter(header?: string | string[]): number | undefined {
    if (!header) return undefined;
    const val = Array.isArray(header) ? header[0] : header;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? undefined : parsed;
  }
}
