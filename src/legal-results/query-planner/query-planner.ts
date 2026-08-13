import { Injectable, Logger } from '@nestjs/common';
import { DocketAlarmClient } from '../../docket-alarm/docket-alarm.client';
import { MetricsService } from '../../shared/observability/metrics.service';
import { NameCandidate } from '../../entities/name-candidate';
import { LegalResult } from '../../entities/legal-result';
import { classifyCourt } from './court-classifier';
import { PERSON_LADDER, COMPANY_LADDER, LadderContext, LadderStep } from './ladder';

export interface PlannerResult {
  results: LegalResult[];
  count: number;
  upstreamCount: number;
  truncated: boolean;
  partial: boolean;
  unnarrowable: boolean;
  executedSteps: string[];
  finalQuery: string;
}

// Simple mutable counter passed through the fan-out to enforce a hard per-request
// upstream-call budget. `spend()` returns false when the budget is exhausted; callers
// must short-circuit instead of continuing.
export class CallBudget {
  constructor(private remaining: number) {}
  public spend(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining -= 1;
    return true;
  }
  public leftover(): number {
    return this.remaining;
  }
}

@Injectable()
export class QueryPlanner {
  private readonly logger = new Logger(QueryPlanner.name);

  constructor(
    private readonly docketAlarmClient: DocketAlarmClient,
    private readonly metrics: MetricsService,
  ) {}

  public async planAndSearch(
    nameCandidate: NameCandidate,
    entityType: 'Person' | 'Company',
    stateCodes: string[],
    budget?: CallBudget,
  ): Promise<PlannerResult> {
    const ctx: LadderContext = {
      fullName: nameCandidate.full,
      type: nameCandidate.type,
      stateCodes,
    };

    const ladder: LadderStep[] = entityType === 'Person' ? PERSON_LADDER : COMPANY_LADDER;
    const applicableSteps = ladder.filter((step) => step.applicable(ctx));

    if (applicableSteps.length === 0) {
      return {
        results: [],
        count: 0,
        upstreamCount: 0,
        truncated: false,
        partial: false,
        unnarrowable: false,
        executedSteps: [],
        finalQuery: '',
      };
    }

    let currentQuery = '';
    const executedSteps: string[] = [];

    for (let i = 0; i < applicableSteps.length; i++) {
      const step = applicableSteps[i];
      currentQuery = step.buildQuery(currentQuery, ctx);
      executedSteps.push(step.id);
      this.metrics.narrowingStepsCounter.inc({ ladder_step: step.id });

      this.logger.debug({
        event: 'planner_probe_start',
        step: step.id,
        query: currentQuery,
      });

      if (budget && !budget.spend()) {
        // Ran out of budget on the probe — return whatever the previous step yielded (nothing here).
        return this.budgetExhaustedResult(currentQuery, executedSteps);
      }
      const probeRes = await this.docketAlarmClient.search(currentQuery, 1, 0);
      const count = probeRes.count ?? 0;

      this.logger.debug({
        event: 'planner_probe_result',
        step: step.id,
        count,
        query: currentQuery,
      });

      const isLastStep = i + 1 === applicableSteps.length;

      if (count <= 250) {
        const results = await this.paginateQuery(currentQuery, count, budget);
        return {
          results,
          count: results.length,
          upstreamCount: count,
          truncated: results.length < count,
          partial: false,
          unnarrowable: false,
          executedSteps: [...executedSteps],
          finalQuery: currentQuery,
        };
      } else if (isLastStep) {
        // Exhausted ladder steps and count > 250
        const results = await this.paginateQuery(currentQuery, count, budget);
        return {
          results,
          count: results.length,
          upstreamCount: count,
          truncated: true,
          partial: true,
          unnarrowable: true,
          executedSteps: [...executedSteps],
          finalQuery: currentQuery,
        };
      }
      // count > 250 and not last step -> loop continues to next step
    }

    return {
      results: [],
      count: 0,
      upstreamCount: 0,
      truncated: false,
      partial: false,
      unnarrowable: false,
      executedSteps,
      finalQuery: currentQuery,
    };
  }

  private budgetExhaustedResult(query: string, executedSteps: string[]): PlannerResult {
    this.logger.warn({ event: 'planner_budget_exhausted', query });
    return {
      results: [],
      count: 0,
      upstreamCount: 0,
      truncated: true,
      partial: true,
      unnarrowable: true,
      executedSteps: [...executedSteps],
      finalQuery: query,
    };
  }

  private async paginateQuery(
    query: string,
    totalCount: number,
    budget?: CallBudget,
  ): Promise<LegalResult[]> {
    const totalToFetch = Math.min(totalCount, 250);
    if (totalToFetch <= 0) {
      return [];
    }

    const pageSize = 50;
    const pagesNeeded = Math.ceil(totalToFetch / pageSize);
    const allResults: LegalResult[] = [];

    for (let page = 0; page < pagesNeeded; page++) {
      const offset = page * pageSize;
      const limit = Math.min(pageSize, totalToFetch - offset);

      if (budget && !budget.spend()) {
        this.logger.warn({
          event: 'planner_budget_exhausted_mid_pagination',
          fetchedSoFar: allResults.length,
        });
        break;
      }

      const pageRes = await this.docketAlarmClient.search(query, limit, offset);
      const items = pageRes?.search_results ?? [];

      for (const item of items) {
        allResults.push({
          court: item.court,
          docket: item.docket,
          title: item.title,
          link: item.link,
          dateFiled: item.date_filed ?? null,
          courtTier: classifyCourt(item.court),
        });
      }
    }

    return allResults;
  }
}
