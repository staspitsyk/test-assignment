import { CourtTier, LegalResult } from '../../entities/legal-result';

const TIER_ORDER: Record<CourtTier, number> = {
  FEDERAL: 0,
  STATE: 1,
  COUNTY: 2,
  UNCATEGORIZED: 3,
};

export function sortLegalResults(results: LegalResult[]): LegalResult[] {
  return [...results].sort((a, b) => {
    // Tier 1: Court Tier authority
    const tierA = TIER_ORDER[a.courtTier] ?? 3;
    const tierB = TIER_ORDER[b.courtTier] ?? 3;
    if (tierA !== tierB) {
      return tierA - tierB;
    }

    // Tier 2: dateFiled descending (missing / unparseable dates sort last)
    const timeA = parseDateTimestamp(a.dateFiled);
    const timeB = parseDateTimestamp(b.dateFiled);

    const validA = !isNaN(timeA);
    const validB = !isNaN(timeB);

    if (validA && validB) {
      if (timeA !== timeB) {
        return timeB - timeA; // descending order
      }
    } else if (validA && !validB) {
      return -1; // valid date comes before missing date
    } else if (!validA && validB) {
      return 1; // missing date comes after valid date
    }

    // Tier 3: Deterministic tiebreaker on (court, docket)
    const courtDiff = a.court.localeCompare(b.court);
    if (courtDiff !== 0) {
      return courtDiff;
    }
    return a.docket.localeCompare(b.docket);
  });
}

function parseDateTimestamp(dateStr: string | null): number {
  if (!dateStr || typeof dateStr !== 'string') {
    return NaN;
  }
  const timestamp = Date.parse(dateStr);
  return isNaN(timestamp) ? NaN : timestamp;
}
