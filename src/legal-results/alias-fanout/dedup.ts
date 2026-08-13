import { LegalResult } from '../../entities/legal-result';

export function dedupResults(results: LegalResult[]): LegalResult[] {
  const seen = new Set<string>();
  const deduped: LegalResult[] = [];

  for (const item of results) {
    const key = `${item.court}::${item.docket}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  return deduped;
}
