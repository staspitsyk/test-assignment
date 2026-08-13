import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config.token';
import { ResultCacheService } from './cache/result-cache.service';
import {
  LegalResultsRequestDto,
  validateAndNormalizeEntityRequest,
} from './dto/request.dto';
import { LegalResultsResponse } from './dto/response.dto';

@Injectable()
export class LegalResultsService {
  private readonly logger = new Logger(LegalResultsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly resultCacheService: ResultCacheService,
  ) {}

  public async getLegalResults(
    requestDto: LegalResultsRequestDto,
    bypassCache = false,
    requestId = 'req-unknown',
  ): Promise<LegalResultsResponse> {
    const startTime = Date.now();
    const threshold = this.config.ALIAS_CONFIDENCE_THRESHOLD ?? 0.5;

    // Validate and normalize input entity
    const entityInput = validateAndNormalizeEntityRequest(requestDto, threshold);

    // Retrieve results via cache layer (which delegates to FanoutService on miss/bypass)
    const cachedResult = await this.resultCacheService.getLegalResults(
      entityInput,
      { bypassCache },
    );

    const elapsedMs = Date.now() - startTime;

    const response: LegalResultsResponse = {
      results: cachedResult.fanoutResponse.results,
      meta: {
        entityId: entityInput.entityId,
        entityType: entityInput.entityType,
        count: cachedResult.fanoutResponse.meta.count,
        upstream_count: cachedResult.fanoutResponse.meta.upstreamCount,
        truncated: cachedResult.fanoutResponse.meta.truncated,
        partial: cachedResult.fanoutResponse.meta.partial,
        unnarrowable: cachedResult.fanoutResponse.meta.unnarrowable,
        cache: cachedResult.cacheStatus,
        requestId,
        elapsedMs,
      },
    };

    this.logger.log({
      event: 'legal_results_executed',
      entityId: entityInput.entityId,
      entityType: entityInput.entityType,
      count: response.meta.count,
      upstreamCount: response.meta.upstream_count,
      cache: response.meta.cache,
      requestId,
      elapsedMs,
    });

    return response;
  }
}
