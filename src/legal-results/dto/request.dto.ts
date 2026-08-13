import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { EntityInput } from '../../entities/entity-input';
import { InvalidEntityException } from '../../shared/errors/domain.errors';

export const NameCandidateSchema = z.object({
  full: z.string(),
  confidence: z.number().min(0).max(1),
  type: z.string().optional(),
});

export const AddressCandidateSchema = z.object({
  full: z.string(),
  confidence: z.number().min(0).max(1),
});

export const LegalResultsRequestSchema = z.object({
  entityId: z.number().int(),
  entityType: z.enum(['Person', 'Company']),
  sender: z.string().optional(),
  entityDetails: z.object({
    name: z.array(NameCandidateSchema),
    address: z.array(AddressCandidateSchema).optional().default([]),
  }),
});

export class LegalResultsRequestDto extends createZodDto(LegalResultsRequestSchema) {}

export type LegalResultsRequest = z.infer<typeof LegalResultsRequestSchema>;

export function validateAndNormalizeEntityRequest(
  req: LegalResultsRequest,
  threshold = 0.5,
): EntityInput {
  const rawNames = req.entityDetails?.name;

  if (!rawNames || !Array.isArray(rawNames) || rawNames.length === 0) {
    throw new InvalidEntityException('Name candidates array must not be empty');
  }

  // Filter candidates with confidence >= threshold and non-empty trimmed full name
  const validCandidates = rawNames.filter(
    (c) => c && typeof c.confidence === 'number' && c.confidence >= threshold && c.full && c.full.trim().length > 0,
  );

  if (validCandidates.length === 0) {
    throw new InvalidEntityException(
      'No name candidate meets the minimum confidence threshold',
    );
  }

  // Sort candidates by confidence descending
  const sortedCandidates = [...validCandidates].sort((a, b) => b.confidence - a.confidence);
  const topCandidate = sortedCandidates[0];

  if (req.entityType === 'Person') {
    const tokens = topCandidate.full.trim().split(/\s+/);
    if (tokens.length < 2) {
      throw new InvalidEntityException(
        'Person entity top-confidence name candidate must contain at least a first and last name',
      );
    }
  } else if (req.entityType === 'Company') {
    if (!topCandidate.full || topCandidate.full.trim().length === 0) {
      throw new InvalidEntityException(
        'Company entity top-confidence name candidate must not be empty',
      );
    }
  }

  return {
    entityId: req.entityId,
    sender: req.sender,
    entityType: req.entityType,
    nameCandidates: req.entityDetails.name.map((nc) => ({
      full: nc.full,
      confidence: nc.confidence,
      type: nc.type,
    })),
    addressCandidates: (req.entityDetails.address || []).map((ac) => ({
      full: ac.full,
      confidence: ac.confidence,
    })),
  } as EntityInput;
}
