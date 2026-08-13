import { CourtTier } from '../../entities/legal-result';

const UNCATEGORIZED_OVERRIDES = [
  'tax court',
];

const COUNTY_PATTERNS = [
  'county',
  'court of common pleas',
  'magisterial district court',
];

const STATE_PATTERNS = [
  'state,',
  'state court',
  'superior court',
  'state supreme',
];

const FEDERAL_PATTERNS = [
  'u.s.',
  'united states',
  'federal',
  'district court',
  'circuit',
  'bankruptcy court',
];

export function classifyCourt(court: string): CourtTier {
  if (!court || typeof court !== 'string') {
    return 'UNCATEGORIZED';
  }

  const lower = court.toLowerCase();

  // 1. UNCATEGORIZED Overrides (curated list starting with 'Tax Court')
  for (const override of UNCATEGORIZED_OVERRIDES) {
    if (lower.includes(override)) {
      return 'UNCATEGORIZED';
    }
  }

  // 2. COUNTY
  for (const pattern of COUNTY_PATTERNS) {
    if (lower.includes(pattern)) {
      return 'COUNTY';
    }
  }

  // 3. STATE
  for (const pattern of STATE_PATTERNS) {
    if (lower.includes(pattern)) {
      return 'STATE';
    }
  }

  // 4. FEDERAL
  for (const pattern of FEDERAL_PATTERNS) {
    if (lower.includes(pattern)) {
      return 'FEDERAL';
    }
  }

  // 5. UNCATEGORIZED (default)
  return 'UNCATEGORIZED';
}
