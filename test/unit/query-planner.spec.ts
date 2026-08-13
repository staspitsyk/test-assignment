import { QueryPlanner } from 'src/legal-results/query-planner/query-planner';
import { DocketAlarmClient } from 'src/docket-alarm/docket-alarm.client';
import { NameCandidate } from 'src/entities/name-candidate';

describe('QueryPlanner Unit Tests', () => {
  let queryPlanner: QueryPlanner;
  let mockDaClient: jest.Mocked<DocketAlarmClient>;

  beforeEach(() => {
    mockDaClient = {
      search: jest.fn(),
    } as unknown as jest.Mocked<DocketAlarmClient>;

    queryPlanner = new QueryPlanner(mockDaClient);
  });

  describe('Person Ladder', () => {
    const personCandidate: NameCandidate = {
      full: 'Bradley Friedman',
      confidence: 0.9,
      kind: 'first-last',
    };

    it('should fit at step 0 if count <= 250', async () => {
      // Step 0 probe
      mockDaClient.search.mockResolvedValueOnce({
        count: 45,
        search_results: [
          { court: 'Florida Circuit Court', docket: '101', title: 'Friedman v. State', link: 'http://link', date_filed: '2023-01-01' },
        ],
      });

      // Pagination call (offset 0)
      mockDaClient.search.mockResolvedValueOnce({
        count: 45,
        search_results: [
          { court: 'Florida Circuit Court', docket: '101', title: 'Friedman v. State', link: 'http://link', date_filed: '2023-01-01' },
        ],
      });

      const res = await queryPlanner.planAndSearch(personCandidate, 'Person', ['FL']);

      expect(res.count).toBe(1);
      expect(res.upstreamCount).toBe(45);
      expect(res.partial).toBe(false);
      expect(res.unnarrowable).toBe(false);
      expect(res.executedSteps).toEqual(['party']);
      expect(res.finalQuery).toBe('party:(name:"Bradley Friedman") AND is:docket');
    });

    it('should advance to state step if count > 250 on step 0', async () => {
      // Step 0 probe: count = 500 (> 250)
      mockDaClient.search.mockResolvedValueOnce({ count: 500, search_results: [] });
      // Step 1 probe: count = 120 (<= 250)
      mockDaClient.search.mockResolvedValueOnce({ count: 120, search_results: [] });

      // Step 1 pagination: 120 items requires 3 pages (offset 0, 50, 100)
      mockDaClient.search.mockResolvedValueOnce({
        count: 120,
        search_results: [
          { court: 'Florida Circuit Court', docket: '102', title: 'Friedman Case', link: '', date_filed: '2022-05-05' },
        ],
      });
      mockDaClient.search.mockResolvedValueOnce({
        count: 120,
        search_results: [],
      });
      mockDaClient.search.mockResolvedValueOnce({
        count: 120,
        search_results: [],
      });

      const res = await queryPlanner.planAndSearch(personCandidate, 'Person', ['FL']);

      expect(res.executedSteps).toEqual(['party', 'state']);
      expect(res.finalQuery).toContain('court:("Florida State" OR "Florida Circuit Court") AND is:state');
      expect(res.partial).toBe(false);
      expect(res.upstreamCount).toBe(120);
    });

    it('should advance to 10years step and flag unnarrowable if all steps exhausted with count > 250', async () => {
      // Step 0 probe count = 1000
      mockDaClient.search.mockResolvedValueOnce({ count: 1000, search_results: [] });
      // Step 1 probe count = 800
      mockDaClient.search.mockResolvedValueOnce({ count: 800, search_results: [] });
      // Step 2 probe count = 400
      mockDaClient.search.mockResolvedValueOnce({ count: 400, search_results: [] });
      // Step 2 pagination pages (capped to 250 items = 5 pages of 50)
      for (let p = 0; p < 5; p++) {
        mockDaClient.search.mockResolvedValueOnce({
          count: 400,
          search_results: Array.from({ length: 50 }, (_, i) => ({
            court: 'Florida Circuit Court',
            docket: `docket-${p}-${i}`,
            title: 'Sample Case',
            link: '',
            date_filed: '2023-01-01',
          })),
        });
      }

      const res = await queryPlanner.planAndSearch(personCandidate, 'Person', ['FL']);

      expect(res.executedSteps).toEqual(['party', 'state', '10years']);
      expect(res.finalQuery).toContain('from:-10years');
      expect(res.count).toBe(250);
      expect(res.upstreamCount).toBe(400);
      expect(res.truncated).toBe(true);
      expect(res.partial).toBe(true);
      expect(res.unnarrowable).toBe(true);
    });
  });

  describe('Company Ladder', () => {
    const companyCandidate: NameCandidate = {
      full: 'Westlake Services',
      type: 'LLC',
      confidence: 1.0,
      kind: 'company',
    };

    it('should weave company type into name term on step 1', async () => {
      // Step 0 probe: count = 600
      mockDaClient.search.mockResolvedValueOnce({ count: 600, search_results: [] });
      // Step 1 probe: count = 50 (<= 250)
      mockDaClient.search.mockResolvedValueOnce({ count: 50, search_results: [] });
      // Step 1 pagination
      mockDaClient.search.mockResolvedValueOnce({
        count: 50,
        search_results: [
          { court: 'Delaware Chancery', docket: '999', title: 'Westlake LLC', link: '', date_filed: '2024-02-01' },
        ],
      });

      const res = await queryPlanner.planAndSearch(companyCandidate, 'Company', []);

      expect(res.executedSteps).toEqual(['name', 'type']);
      expect(res.finalQuery).toBe('party:(name:"Westlake Services LLC") AND is:docket');
      expect(res.partial).toBe(false);
    });
  });
});
