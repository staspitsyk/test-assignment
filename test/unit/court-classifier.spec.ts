import { classifyCourt } from 'src/legal-results/query-planner/court-classifier';

describe('Court Classifier Unit Tests', () => {
  it('should override Tax Court to UNCATEGORIZED despite containing United States', () => {
    expect(classifyCourt('United States Tax Court')).toBe('UNCATEGORIZED');
    expect(classifyCourt('U.S. Tax Court')).toBe('UNCATEGORIZED');
  });

  it('should classify COUNTY courts correctly', () => {
    expect(classifyCourt('Ohio State, Hamilton County, Court of Common Pleas')).toBe('COUNTY');
    expect(classifyCourt('Pennsylvania State, Magisterial District Court, Chester County')).toBe('COUNTY');
    expect(classifyCourt('Cook County Circuit Court')).toBe('COUNTY');
  });

  it('should classify STATE courts correctly', () => {
    expect(classifyCourt('Connecticut State, Superior Court')).toBe('STATE');
    expect(classifyCourt('New York State Supreme Court')).toBe('STATE');
    expect(classifyCourt('California State Court')).toBe('STATE');
  });

  it('should classify FEDERAL courts correctly', () => {
    expect(classifyCourt('Florida Middle District Court')).toBe('FEDERAL');
    expect(classifyCourt('U.S. Court of Appeals, Second Circuit')).toBe('FEDERAL');
    expect(classifyCourt('Nevada Bankruptcy Court')).toBe('FEDERAL');
    expect(classifyCourt('United States District Court for the Southern District of New York')).toBe('FEDERAL');
  });

  it('should default unmatched courts to UNCATEGORIZED', () => {
    expect(classifyCourt('Arbitration Tribunal')).toBe('UNCATEGORIZED');
    expect(classifyCourt('')).toBe('UNCATEGORIZED');
  });
});
