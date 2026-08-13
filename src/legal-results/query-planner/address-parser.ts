import { AddressCandidate } from '../../entities/address-candidate';

const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
]);

const STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO',
  MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH',
  OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  'DISTRICT OF COLUMBIA': 'DC',
};

export function parseStateCodes(addresses?: AddressCandidate[]): string[] {
  if (!addresses || addresses.length === 0) {
    return [];
  }

  const maxConfidence = Math.max(...addresses.map((a) => a.confidence));
  if (maxConfidence <= 0 || !isFinite(maxConfidence)) {
    return [];
  }

  const topCandidates = addresses.filter((a) => a.confidence === maxConfidence);
  const foundStateCodes = new Set<string>();

  for (const candidate of topCandidates) {
    const text = candidate.full;
    if (!text || typeof text !== 'string') continue;

    const state = extractStateFromText(text);
    if (state) {
      foundStateCodes.add(state);
    }
  }

  return Array.from(foundStateCodes);
}

function extractStateFromText(text: string): string | null {
  const upper = text.toUpperCase();

  // 1. Check full state names
  for (const [stateName, code] of Object.entries(STATE_NAME_TO_CODE)) {
    const regex = new RegExp(`\\b${stateName}\\b`, 'i');
    if (regex.test(text)) {
      return code;
    }
  }

  // 2. Check 2-letter state code pattern:
  // e.g. ", NY 10001", ", CA", " Boise, ID 83702", "IN 46204", " FL "
  const codeMatch = upper.match(/(?:,\s*|\s+)\b([A-Z]{2})\b(?:\s*\d{5}(-\d{4})?|\s+USA|\s*,|\s*$)/i);
  if (codeMatch && codeMatch[1]) {
    const code = codeMatch[1].toUpperCase();
    if (STATE_CODES.has(code)) {
      return code;
    }
  }

  // Fallback: direct match for 2-letter state isolated by word boundary if it's in STATE_CODES
  // and preceded by comma or space
  const words = upper.split(/[\s,]+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (STATE_CODES.has(word)) {
      // Avoid matching single 'OR' or 'IN' if it looks like a word in English unless adjacent to zip code
      if (word === 'OR' || word === 'IN') {
        const nextWord = words[i + 1];
        if (nextWord && /^\d{5}/.test(nextWord)) {
          return word;
        }
        if (i > 0 && text.includes(`, ${word}`)) {
          return word;
        }
        continue;
      }
      return word;
    }
  }

  return null;
}
