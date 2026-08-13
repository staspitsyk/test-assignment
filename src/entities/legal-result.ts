export type CourtTier = 'FEDERAL' | 'STATE' | 'COUNTY' | 'UNCATEGORIZED';

export interface LegalResult {
  court: string;
  docket: string;
  title: string;
  link: string;
  dateFiled: string | null;
  courtTier: CourtTier;
}
