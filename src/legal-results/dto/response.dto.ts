import { z } from 'zod';
import { LegalResult } from '../../entities/legal-result';

export const LegalResultSchema = z.object({
  court: z.string(),
  docket: z.string(),
  title: z.string(),
  link: z.string(),
  dateFiled: z.string().nullable(),
  courtTier: z.enum(['FEDERAL', 'STATE', 'COUNTY', 'UNCATEGORIZED']),
});

export const LegalResultsMetaSchema = z.object({
  entityId: z.number().int(),
  entityType: z.enum(['Person', 'Company']),
  count: z.number().int(),
  upstream_count: z.number().int(),
  truncated: z.boolean(),
  partial: z.boolean(),
  unnarrowable: z.boolean(),
  cache: z.enum(['hit', 'miss', 'stale', 'bypass']),
  requestId: z.string(),
  elapsedMs: z.number(),
});

export const LegalResultsResponseSchema = z.object({
  results: z.array(LegalResultSchema),
  meta: LegalResultsMetaSchema,
});

export interface LegalResultsMeta {
  entityId: number;
  entityType: 'Person' | 'Company';
  count: number;
  upstream_count: number;
  truncated: boolean;
  partial: boolean;
  unnarrowable: boolean;
  cache: 'hit' | 'miss' | 'stale' | 'bypass';
  requestId: string;
  elapsedMs: number;
}

export interface LegalResultsResponse {
  results: LegalResult[];
  meta: LegalResultsMeta;
}
