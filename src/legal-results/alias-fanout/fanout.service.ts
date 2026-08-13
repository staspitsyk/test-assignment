import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config.token';
import { EntityInput } from '../../entities/entity-input';
import { LegalResult } from '../../entities/legal-result';
import { InvalidEntityException } from '../../shared/errors/domain.errors';
import { MetricsService } from '../../shared/observability/metrics.service';
import { QueryPlanner, CallBudget } from '../query-planner/query-planner';
import { parseStateCodes } from '../query-planner/address-parser';
import { dedupResults } from './dedup';
import { sortLegalResults } from '../sort/sort';

// Hard upper bound on DA upstream calls per incoming request. Prevents a single
// pathological input (many aliases × many pages × many ladder steps) from burning
// down the shared rate-limiter reservoir on behalf of one caller.
const PER_REQUEST_CALL_BUDGET = 30;

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
    private readonly metrics: MetricsService,
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

    this.metrics.aliasFanoutHistogram.observe(validCandidates.length);

    this.logger.debug({
      event: 'fanout_start',
      candidatesCount: validCandidates.length,
      stateCodes,
    });

    // Shared per-request budget: at most PER_REQUEST_CALL_BUDGET upstream DA calls
    // across ALL candidates. Each candidate's planner cooperatively spends from it.
    const budget = new CallBudget(PER_REQUEST_CALL_BUDGET);

    // Run query planner for candidate aliases concurrently (concurrency 3)
    const plannerYields = await pMap(
      validCandidates,
      (candidate) =>
        this.queryPlanner.planAndSearch(candidate, entity.entityType, stateCodes, budget),
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

    // Enforce max 250 cap on merged results.
    // `truncated` means "returned < what upstream held". `partial` means "narrowing was exhausted
    // and we still had > 250" (or the budget ran out mid-flight). Keep them distinct.
    const mergedOverCap = sorted.length > 250;
    const isMergedTruncated = mergedOverCap || anyTruncated;
    const isMergedPartial = anyPartial;
    const finalResults = sorted.slice(0, 250);

    if (budget.leftover() === 0) {
      this.logger.warn({
        event: 'fanout_budget_fully_spent',
        candidates: validCandidates.length,
      });
    }

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
