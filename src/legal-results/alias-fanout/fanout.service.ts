import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config.token';
import { EntityInput } from '../../entities/entity-input';
import { LegalResult } from '../../entities/legal-result';
import { InvalidEntityException } from '../../shared/errors/domain.errors';
import { QueryPlanner } from '../query-planner/query-planner';
import { parseStateCodes } from '../query-planner/address-parser';
import { dedupResults } from './dedup';
import { sortLegalResults } from '../sort/sort';

export interface FanoutResponse {
  results: LegalResult[];
  meta: {
    count: number;
    upstreamCount: number;
    truncated: boolean;
    partial: boolean;
    unnarrowable: boolean;
    candidatesSearched: number;
  };
}

async function pMap<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await mapper(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

@Injectable()
export class FanoutService {
  private readonly logger = new Logger(FanoutService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queryPlanner: QueryPlanner,
  ) {}

  public async execute(entity: EntityInput): Promise<FanoutResponse> {
    const threshold = this.config.ALIAS_CONFIDENCE_THRESHOLD ?? 0.5;

    // Filter candidate names with confidence >= ALIAS_CONFIDENCE_THRESHOLD
    const validCandidates = (entity.nameCandidates ?? []).filter(
      (c) => c && c.confidence >= threshold && c.full && c.full.trim().length > 0,
    );

    if (validCandidates.length === 0) {
      throw new InvalidEntityException(
        'No name candidate meets the minimum confidence threshold',
      );
    }

    // Parse state codes from addresses (if any)
    const stateCodes = parseStateCodes(entity.addressCandidates);

    this.logger.debug({
      event: 'fanout_start',
      candidatesCount: validCandidates.length,
      stateCodes,
    });

    // Run query planner for candidate aliases concurrently (concurrency 3)
    const plannerYields = await pMap(
      validCandidates,
      (candidate) =>
        this.queryPlanner.planAndSearch(candidate, entity.entityType, stateCodes),
      3,
    );

    const allRawResults: LegalResult[] = [];
    let maxUpstreamCount = 0;
    let anyTruncated = false;
    let anyPartial = false;
    let anyUnnarrowable = false;

    for (const yieldItem of plannerYields) {
      allRawResults.push(...yieldItem.results);
      if (yieldItem.upstreamCount > maxUpstreamCount) {
        maxUpstreamCount = yieldItem.upstreamCount;
      }
      if (yieldItem.truncated) anyTruncated = true;
      if (yieldItem.partial) anyPartial = true;
      if (yieldItem.unnarrowable) anyUnnarrowable = true;
    }

    // Deduplicate merged results by court::docket
    const deduped = dedupResults(allRawResults);

    // Sort results by court tier authority -> filing date desc -> tiebreaker
    const sorted = sortLegalResults(deduped);

    // Enforce max 250 cap on merged results
    const isMergedTruncated = sorted.length > 250 || anyTruncated;
    const isMergedPartial = sorted.length > 250 || anyPartial;
    const finalResults = sorted.slice(0, 250);

    return {
      results: finalResults,
      meta: {
        count: finalResults.length,
        upstreamCount: maxUpstreamCount,
        truncated: isMergedTruncated,
        partial: isMergedPartial,
        unnarrowable: anyUnnarrowable,
        candidatesSearched: validCandidates.length,
      },
    };
  }
}
