import { parseStateCodes } from 'src/legal-results/query-planner/address-parser';

describe('Address Parser Unit Tests', () => {
  it('should parse top-confidence state code from address candidate', () => {
    const addresses = [
      { full: '123 Main St, Miami, FL 33101', confidence: 0.9 },
    ];
    expect(parseStateCodes(addresses)).toEqual(['FL']);
  });

  it('should extract multiple state codes for multi-state inputs tied for highest confidence', () => {
    const addresses = [
      { full: '123 Main St, Boise, ID 83702', confidence: 1.0 },
      { full: '456 Oak Rd, Salt Lake City, UT 84101', confidence: 1.0 },
      { full: '789 Pine Ave, St. Louis, MO 63101', confidence: 1.0 },
      { full: '101 Beach Blvd, Phoenix, AZ 85001', confidence: 1.0 },
    ];
    const states = parseStateCodes(addresses);
    expect(states).toContain('ID');
    expect(states).toContain('UT');
    expect(states).toContain('MO');
    expect(states).toContain('AZ');
    expect(states).toHaveLength(4);
  });

  it('should only use top-confidence address candidates and ignore lower-confidence ones', () => {
    const addresses = [
      { full: '123 Main St, Miami, FL 33101', confidence: 0.9 },
      { full: '456 Secondary St, Austin, TX 78701', confidence: 0.4 },
    ];
    expect(parseStateCodes(addresses)).toEqual(['FL']);
  });

  it('should parse full state names in addresses', () => {
    const addresses = [
      { full: '789 Elm St, Seattle, Washington', confidence: 0.8 },
    ];
    expect(parseStateCodes(addresses)).toEqual(['WA']);
  });

  it('should return empty array when no address candidate can be parsed', () => {
    expect(parseStateCodes([])).toEqual([]);
    expect(parseStateCodes([{ full: 'Unknown Location', confidence: 0.5 }])).toEqual([]);
  });
});
