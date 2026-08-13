import { getStateCourts, STATE_COURTS_MAP } from 'src/legal-results/query-planner/state-courts';

describe('State Courts Unit Tests', () => {
  it('should map state abbreviations to full court names without relying on bare abbreviations', () => {
    expect(getStateCourts('NY')).toEqual([
      'New York State',
      'New York Supreme Court',
      'New York County Supreme Court',
    ]);
    expect(getStateCourts('IN')).toEqual([
      'Indiana State',
      'Indiana Circuit Court',
      'Indiana Superior Court',
    ]);
    expect(getStateCourts('OR')).toEqual([
      'Oregon State',
      'Oregon Circuit Court',
    ]);
  });

  it('should handle case insensitivity and whitespace', () => {
    expect(getStateCourts('   ca  ')).toEqual([
      'California State',
      'California Superior Court',
    ]);
  });

  it('should return fallback for unknown 2-letter state code', () => {
    expect(getStateCourts('XX')).toEqual(['XX State']);
  });

  it('should return empty array for empty or invalid input', () => {
    expect(getStateCourts('')).toEqual([]);
  });
});
