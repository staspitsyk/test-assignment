import { Injectable, Logger } from '@nestjs/common';
import { DocketAlarmClient } from '../../docket-alarm/docket-alarm.client';
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

@Injectable()
export class QueryPlanner {
  private readonly logger = new Logger(QueryPlanner.name);

  constructor(private readonly docketAlarmClient: DocketAlarmClient) {}

  public async planAndSearch(
    nameCandidate: NameCandidate,
    entityType: 'Person' | 'Company',
    stateCodes: string[],
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

      this.logger.debug({
        event: 'planner_probe_start',
        step: step.id,
        query: currentQuery,
      });

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
        const results = await this.paginateQuery(currentQuery, count);
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
        const results = await this.paginateQuery(currentQuery, count);
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

  private async paginateQuery(query: string, totalCount: number): Promise<LegalResult[]> {
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
