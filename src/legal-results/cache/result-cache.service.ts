import { Inject, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { createCache, Cache } from 'async-cache-dedupe';
import { APP_CONFIG, AppConfig } from '../../config/config.token';
import { RedisService } from '../../shared/redis/redis.service';
import { MetricsService } from '../../shared/observability/metrics.service';
import { EntityInput } from '../../entities/entity-input';
import { FanoutService, FanoutResponse } from '../alias-fanout/fanout.service';

export interface CachedLegalResults {
  fanoutResponse: FanoutResponse;
  cacheStatus: 'hit' | 'miss' | 'stale' | 'bypass';
}

export function normalizedEntityHash(entity: EntityInput, threshold = 0.5): string {
  const normalizedEntityType = entity.entityType.toLowerCase();

  const validNames = (entity.nameCandidates || [])
    .filter((c) => c && typeof c.confidence === 'number' && c.confidence >= threshold && c.full && c.full.trim().length > 0)
    .map((c) => ({
      full: c.full.trim().toLowerCase().replace(/\s+/g, ' '),
      confidence: c.confidence,
      type: c.type ? c.type.trim().toLowerCase().replace(/\s+/g, ' ') : undefined,
    }))
    .sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.full.localeCompare(b.full);
    });

  const validAddresses = (entity.addressCandidates || [])
    .filter((a) => a && typeof a.confidence === 'number' && a.confidence >= threshold && a.full && a.full.trim().length > 0)
    .map((a) => ({
      full: a.full.trim().toLowerCase().replace(/\s+/g, ' '),
      confidence: a.confidence,
    }))
    .sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.full.localeCompare(b.full);
    });

  const payload = {
    entityType: normalizedEntityType,
    names: validNames,
    addresses: validAddresses,
  };

  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

  return `legal:results:${hash}`;
}

@Injectable()
export class ResultCacheService {
  private readonly logger = new Logger(ResultCacheService.name);
  private readonly dedupeCache: Cache;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redisService: RedisService,
    private readonly metricsService: MetricsService,
    private readonly fanoutService: FanoutService,
  ) {
    const threshold = this.config.ALIAS_CONFIDENCE_THRESHOLD ?? 0.5;
    const ttlSeconds = this.config.CACHE_TTL_SECONDS ?? 1800;
    const staleSeconds = this.config.CACHE_STALE_SECONDS ?? 300;

    this.dedupeCache = createCache({
      storage: {
        type: 'redis',
        options: {
          client: this.redisService.getClient(),
        },
      },
      onHit: (key: string) => {
        this.logger.debug({ event: 'cache_hit', key });
      },
      onMiss: (key: string) => {
        this.logger.debug({ event: 'cache_miss', key });
      },
      onDedupe: (key: string) => {
        this.logger.debug({ event: 'cache_dedupe', key });
        this.metricsService.dedupWinsCounter.inc({ scope: 'in_process' });
      },
    });

    this.dedupeCache.define(
      'getLegalResults',
      {
        serialize: (args: any) => {
          const entity = Array.isArray(args) ? args[0] : args;
          return normalizedEntityHash(entity, threshold);
        },
        ttl: (result: FanoutResponse) => {
          if (result && result.meta && result.meta.unnarrowable) {
            return 60; // Short 60s TTL for negative / unnarrowable results
          }
          return ttlSeconds;
        },
        stale: (result: FanoutResponse) => {
          return staleSeconds;
        },
      },
      async (entity: EntityInput): Promise<FanoutResponse> => {
        return this.fanoutService.execute(entity);
      },
    );
  }

  public async getLegalResults(
    entity: EntityInput,
    options?: { bypassCache?: boolean },
  ): Promise<CachedLegalResults> {
    const threshold = this.config.ALIAS_CONFIDENCE_THRESHOLD ?? 0.5;
    const hashKey = normalizedEntityHash(entity, threshold);

    if (options?.bypassCache) {
      this.logger.log({ event: 'cache_bypass', hashKey });
      this.metricsService.cacheHitsCounter.inc({ result: 'bypass' });

      const freshResponse = await this.fanoutService.execute(entity);

      // Asynchronously update cache so subsequent requests can hit it
      const ttl = freshResponse.meta.unnarrowable ? 60 : (this.config.CACHE_TTL_SECONDS ?? 1800);
      this.dedupeCache
        .set('getLegalResults', hashKey, freshResponse, ttl)
        .catch((err) => {
          this.logger.warn({ event: 'cache_bypass_update_failed', error: err.message });
        });

      return {
        fanoutResponse: freshResponse,
        cacheStatus: 'bypass',
      };
    }

    const storageKey = `getLegalResults~${hashKey}`;
    const exists = await this.dedupeCache.exists('getLegalResults', hashKey);

    let cacheStatus: 'hit' | 'miss' | 'stale' = 'miss';

    if (exists) {
      const remainingTtl = await this.redisService.getClient().ttl(storageKey);
      const staleThreshold = this.config.CACHE_STALE_SECONDS ?? 300;

      if (remainingTtl > 0 && remainingTtl <= staleThreshold) {
        cacheStatus = 'stale';
      } else {
        cacheStatus = 'hit';
      }
    } else {
      cacheStatus = 'miss';
    }

    this.metricsService.cacheHitsCounter.inc({ result: cacheStatus });

    // Call async-cache-dedupe defined function (handles in-process dedup & Redis read/write)
    const fanoutResponse = await (this.dedupeCache as any).getLegalResults(entity);

    return {
      fanoutResponse,
      cacheStatus,
    };
  }
}
