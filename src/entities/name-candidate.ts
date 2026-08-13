export interface NameCandidate {
  full: string;
  confidence: number;
  type?: string;
  kind?: 'first-last' | 'company';
}
