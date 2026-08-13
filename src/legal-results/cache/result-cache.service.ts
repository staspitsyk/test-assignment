import { Inject, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { createCache, Cache } from 'async-cache-dedupe';
import { ClsService } from 'nestjs-cls';
import { APP_CONFIG, AppConfig } from '../../config/config.token';
import { RedisService } from '../../shared/redis/redis.service';
import { MetricsService } from '../../shared/observability/metrics.service';
import { EntityInput } from '../../entities/entity-input';
import { FanoutService, FanoutResponse } from '../alias-fanout/fanout.service';

export type CacheStatus = 'hit' | 'miss' | 'stale' | 'bypass';

// CLS key used to carry per-request cache status from the async-cache-dedupe
// callbacks back to the calling handler without a shared mutable instance field.
const CLS_CACHE_STATUS_KEY = 'legal-results:cache-status';

export interface CachedLegalResults {
  fanoutResponse: FanoutResponse;
  cacheStatus: CacheStatus;
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

// Typed shim over the dynamic async-cache-dedupe API — replaces the previous `as any`
// cast at the call site with a single, localized cast that documents the shape.
interface LegalResultsCache extends Cache {
  getLegalResults(entity: EntityInput): Promise<FanoutResponse>;
}

@Injectable()
export class ResultCacheService {
  private readonly logger = new Logger(ResultCacheService.name);
  private readonly dedupeCache: LegalResultsCache;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redisService: RedisService,
    private readonly metricsService: MetricsService,
    private readonly fanoutService: FanoutService,
    private readonly cls: ClsService,
  ) {
    const threshold = this.config.ALIAS_CONFIDENCE_THRESHOLD ?? 0.5;
    const ttlSeconds = this.config.CACHE_TTL_SECONDS ?? 1800;
    const staleSeconds = this.config.CACHE_STALE_SECONDS ?? 300;

    const isTest = this.config.NODE_ENV === 'test';

    const cache = createCache({
      storage: isTest
        ? { type: 'memory' }
        : {
            type: 'redis',
            options: {
              client: this.redisService.getClient(),
            },
          },
      onHit: (key: string) => {
        this.setStatus('hit');
        this.logger.debug({ event: 'cache_hit', key });
      },
      onMiss: (key: string) => {
        this.setStatus('miss');
        this.logger.debug({ event: 'cache_miss', key });
      },
      onDedupe: (key: string) => {
        this.logger.debug({ event: 'cache_dedupe', key });
        this.metricsService.dedupWinsCounter.inc({ scope: 'in_process' });
      },
    });

    cache.define(
      'getLegalResults',
      {
        serialize: (args: unknown): string => {
          const entity = Array.isArray(args) ? args[0] : args;
          if (typeof entity === 'string') {
            return entity;
          }
          return normalizedEntityHash(entity as EntityInput, threshold);
        },
        ttl: (result: FanoutResponse): number => {
          if (result && result.meta && result.meta.unnarrowable) {
            return 60; // Short 60s TTL for negative / unnarrowable results
          }
          return ttlSeconds;
        },
        stale: (_result: FanoutResponse): number => staleSeconds,
      },
      async (entity: EntityInput): Promise<FanoutResponse> => {
        return this.fanoutService.execute(entity);
      },
    );

    this.dedupeCache = cache as LegalResultsCache;
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
        .catch((err: Error) => {
          this.logger.warn({ event: 'cache_bypass_update_failed', error: err.message });
        });

      return {
        fanoutResponse: freshResponse,
        cacheStatus: 'bypass',
      };
    }

    // Seed the per-request status; onHit/onMiss will overwrite via CLS.
    this.setStatus('miss');
    const fanoutResponse = await this.dedupeCache.getLegalResults(entity);
    const cacheStatus = this.getStatus() ?? 'miss';

    this.metricsService.cacheHitsCounter.inc({ result: cacheStatus });

    return {
      fanoutResponse,
      cacheStatus,
    };
  }

  private setStatus(status: CacheStatus): void {
    // Guard against callbacks firing outside a CLS context (e.g. during warm-up); in that
    // case the caller falls back to 'miss', which is the least-misleading default.
    if (this.cls.isActive()) {
      this.cls.set(CLS_CACHE_STATUS_KEY, status);
    }
  }

  private getStatus(): CacheStatus | undefined {
    if (!this.cls.isActive()) return undefined;
    return this.cls.get<CacheStatus>(CLS_CACHE_STATUS_KEY);
  }
}
