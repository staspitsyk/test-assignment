import { sortLegalResults } from 'src/legal-results/sort/sort';
import { LegalResult } from 'src/entities/legal-result';

describe('Sort Legal Results Unit Tests', () => {
  it('should sort primarily by Court Tier authority: FEDERAL > STATE > COUNTY > UNCATEGORIZED', () => {
    const results: LegalResult[] = [
      { court: 'Arbitration', docket: '1', title: 'Case 1', link: '', dateFiled: '2024-01-01', courtTier: 'UNCATEGORIZED' },
      { court: 'Florida Circuit Court', docket: '2', title: 'Case 2', link: '', dateFiled: '2024-01-01', courtTier: 'COUNTY' },
      { court: 'Florida District Court', docket: '3', title: 'Case 3', link: '', dateFiled: '2024-01-01', courtTier: 'FEDERAL' },
      { court: 'Florida Supreme Court', docket: '4', title: 'Case 4', link: '', dateFiled: '2024-01-01', courtTier: 'STATE' },
    ];

    const sorted = sortLegalResults(results);
    expect(sorted.map((r) => r.courtTier)).toEqual(['FEDERAL', 'STATE', 'COUNTY', 'UNCATEGORIZED']);
  });

  it('should sort secondarily by dateFiled descending, putting missing or null dates last', () => {
    const results: LegalResult[] = [
      { court: 'US District Court', docket: '1', title: 'Case 1', link: '', dateFiled: '2020-05-10', courtTier: 'FEDERAL' },
      { court: 'US District Court', docket: '2', title: 'Case 2', link: '', dateFiled: null, courtTier: 'FEDERAL' },
      { court: 'US District Court', docket: '3', title: 'Case 3', link: '', dateFiled: '2024-08-01', courtTier: 'FEDERAL' },
      { court: 'US District Court', docket: '4', title: 'Case 4', link: '', dateFiled: 'invalid-date', courtTier: 'FEDERAL' },
    ];

    const sorted = sortLegalResults(results);
    expect(sorted.map((r) => r.docket)).toEqual(['3', '1', '2', '4']);
  });

  it('should break ties deterministically on (court, docket)', () => {
    const results: LegalResult[] = [
      { court: 'US District Court B', docket: '102', title: 'Case', link: '', dateFiled: '2024-01-01', courtTier: 'FEDERAL' },
      { court: 'US District Court A', docket: '105', title: 'Case', link: '', dateFiled: '2024-01-01', courtTier: 'FEDERAL' },
      { court: 'US District Court A', docket: '101', title: 'Case', link: '', dateFiled: '2024-01-01', courtTier: 'FEDERAL' },
    ];

    const sorted = sortLegalResults(results);
    expect(sorted.map((r) => `${r.court}::${r.docket}`)).toEqual([
      'US District Court A::101',
      'US District Court A::105',
      'US District Court B::102',
    ]);
  });
});
