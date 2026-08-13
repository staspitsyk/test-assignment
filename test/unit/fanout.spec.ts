import { FanoutService } from 'src/legal-results/alias-fanout/fanout.service';
import { QueryPlanner, PlannerResult } from 'src/legal-results/query-planner/query-planner';
import { EntityInput } from 'src/entities/entity-input';
import { InvalidEntityException } from 'src/shared/errors/domain.errors';
import { AppConfig } from 'src/config/config.token';
import { MetricsService } from 'src/shared/observability/metrics.service';

describe('FanoutService Unit Tests', () => {
  let fanoutService: FanoutService;
  let mockQueryPlanner: jest.Mocked<QueryPlanner>;
  let mockConfig: AppConfig;
  let mockMetrics: Partial<MetricsService>;

  beforeEach(() => {
    mockQueryPlanner = {
      planAndSearch: jest.fn(),
    } as unknown as jest.Mocked<QueryPlanner>;

    mockConfig = {
      ALIAS_CONFIDENCE_THRESHOLD: 0.5,
    } as AppConfig;

    mockMetrics = {
      aliasFanoutHistogram: { observe: jest.fn() } as unknown as MetricsService['aliasFanoutHistogram'],
    };

    fanoutService = new FanoutService(mockConfig, mockQueryPlanner, mockMetrics as MetricsService);
  });

  it('should throw InvalidEntityException if all candidates are below threshold', async () => {
    const entity: EntityInput = {
      entityId: 1,
      entityType: 'Person',
      nameCandidates: [
        { full: 'Rob Gil', confidence: 0.1, kind: 'first-last' },
      ],
    };

    await expect(fanoutService.execute(entity)).rejects.toThrow(InvalidEntityException);
  });

  it('should search candidates >= threshold and deduplicate results by court::docket', async () => {
    const entity: EntityInput = {
      entityId: 43432,
      entityType: 'Person',
      nameCandidates: [
        { full: 'Bradley Friedman', confidence: 0.9, kind: 'first-last' },
        { full: 'Brad Friedman', confidence: 0.7, kind: 'first-last' },
        { full: 'B Friedman', confidence: 0.2, kind: 'first-last' }, // dropped
      ],
    };

    const yield1: PlannerResult = {
      results: [
        { court: 'Florida State Court', docket: 'DOCK-1', title: 'Case 1', link: '', dateFiled: '2023-01-01', courtTier: 'STATE' },
        { court: 'Florida State Court', docket: 'DOCK-2', title: 'Case 2', link: '', dateFiled: '2023-02-01', courtTier: 'STATE' },
      ],
      count: 2,
      upstreamCount: 2,
      truncated: false,
      partial: false,
      unnarrowable: false,
      executedSteps: ['party'],
      finalQuery: 'q1',
    };

    const yield2: PlannerResult = {
      results: [
        { court: 'Florida State Court', docket: 'DOCK-2', title: 'Case 2 Dup', link: '', dateFiled: '2023-02-01', courtTier: 'STATE' }, // Duplicate
        { court: 'Florida State Court', docket: 'DOCK-3', title: 'Case 3', link: '', dateFiled: '2023-03-01', courtTier: 'STATE' },
      ],
      count: 2,
      upstreamCount: 2,
      truncated: false,
      partial: false,
      unnarrowable: false,
      executedSteps: ['party'],
      finalQuery: 'q2',
    };

    mockQueryPlanner.planAndSearch.mockResolvedValueOnce(yield1).mockResolvedValueOnce(yield2);

    const res = await fanoutService.execute(entity);

    expect(mockQueryPlanner.planAndSearch).toHaveBeenCalledTimes(2);
    expect(res.meta.candidatesSearched).toBe(2);
    expect(res.results).toHaveLength(3); // DOCK-1, DOCK-2, DOCK-3
    expect(res.results.map((r) => r.docket)).toEqual(['DOCK-3', 'DOCK-2', 'DOCK-1']); // sorted date desc
  });

  it('should truncate merged results to 250 max', async () => {
    const entity: EntityInput = {
      entityId: 88,
      entityType: 'Company',
      nameCandidates: [
        { full: 'GOLDMAN SACHS', confidence: 1.0, kind: 'company' },
      ],
    };

    const manyResults = Array.from({ length: 300 }, (_, i) => ({
      court: 'US District Court',
      docket: `docket-${i}`,
      title: 'Bulk Case',
      link: '',
      dateFiled: '2024-01-01',
      courtTier: 'FEDERAL' as const,
    }));

    mockQueryPlanner.planAndSearch.mockResolvedValueOnce({
      results: manyResults,
      count: 300,
      upstreamCount: 300,
      truncated: true,
      partial: true,
      unnarrowable: true,
      executedSteps: ['name', '10years'],
      finalQuery: 'q',
    });

    const res = await fanoutService.execute(entity);

    expect(res.results).toHaveLength(250);
    expect(res.meta.truncated).toBe(true);
    expect(res.meta.partial).toBe(true);
    expect(res.meta.unnarrowable).toBe(true);
  });
});
