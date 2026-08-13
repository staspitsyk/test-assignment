import {
  LegalResultsRequestSchema,
  validateAndNormalizeEntityRequest,
} from '../../src/legal-results/dto/request.dto';
import { InvalidEntityException } from '../../src/shared/errors/domain.errors';

describe('LegalResults DTO & Entity Request Validation', () => {
  describe('Zod Schema Validation', () => {
    it('should pass for valid Person request body', () => {
      const validBody = {
        entityId: 43432,
        entityType: 'Person',
        sender: 'INTELLIGO',
        entityDetails: {
          name: [{ full: 'Bradley Friedman', confidence: 0.9 }],
          address: [{ full: 'Miami, FL 33139', confidence: 0.95 }],
        },
      };

      const parsed = LegalResultsRequestSchema.safeParse(validBody);
      expect(parsed.success).toBe(true);
    });

    it('should pass for valid Company request body', () => {
      const validBody = {
        entityId: 55,
        entityType: 'Company',
        entityDetails: {
          name: [{ full: 'Westlake Services', confidence: 1.0, type: 'LLC' }],
        },
      };

      const parsed = LegalResultsRequestSchema.safeParse(validBody);
      expect(parsed.success).toBe(true);
    });

    it('should fail for invalid entityType', () => {
      const invalidBody = {
        entityId: 1,
        entityType: 'InvalidType',
        entityDetails: {
          name: [{ full: 'Test Name', confidence: 1.0 }],
        },
      };

      const parsed = LegalResultsRequestSchema.safeParse(invalidBody);
      expect(parsed.success).toBe(false);
    });
  });

  describe('validateAndNormalizeEntityRequest rules', () => {
    it('should throw InvalidEntityException when name array is empty', () => {
      const request: any = {
        entityId: 100,
        entityType: 'Person',
        entityDetails: {
          name: [],
        },
      };

      expect(() => validateAndNormalizeEntityRequest(request, 0.5)).toThrow(
        InvalidEntityException,
      );
    });

    it('should throw InvalidEntityException when all name candidates are below confidence threshold', () => {
      const request: any = {
        entityId: 101,
        entityType: 'Person',
        entityDetails: {
          name: [
            { full: 'Low Conf Person', confidence: 0.2 },
            { full: 'Another Low Conf', confidence: 0.4 },
          ],
        },
      };

      expect(() => validateAndNormalizeEntityRequest(request, 0.5)).toThrow(
        InvalidEntityException,
      );
    });

    it('should throw InvalidEntityException for single-token Person name (no last name)', () => {
      const request: any = {
        entityId: 102,
        entityType: 'Person',
        entityDetails: {
          name: [{ full: 'Cher', confidence: 0.9 }],
        },
      };

      expect(() => validateAndNormalizeEntityRequest(request, 0.5)).toThrow(
        InvalidEntityException,
      );
    });

    it('should throw InvalidEntityException for empty Company name after trimming', () => {
      const request: any = {
        entityId: 103,
        entityType: 'Company',
        entityDetails: {
          name: [{ full: '   ', confidence: 0.9 }],
        },
      };

      expect(() => validateAndNormalizeEntityRequest(request, 0.5)).toThrow(
        InvalidEntityException,
      );
    });

    it('should successfully validate and normalize a valid Person input', () => {
      const request: any = {
        entityId: 43432,
        entityType: 'Person',
        sender: 'INTELLIGO',
        entityDetails: {
          name: [{ full: 'Bradley Friedman', confidence: 0.9 }],
          address: [{ full: 'Miami, FL 33139', confidence: 0.95 }],
        },
      };

      const entity = validateAndNormalizeEntityRequest(request, 0.5);
      expect(entity.entityId).toBe(43432);
      expect(entity.entityType).toBe('Person');
      expect(entity.nameCandidates).toHaveLength(1);
      expect(entity.nameCandidates[0].full).toBe('Bradley Friedman');
    });

    it('should successfully validate and normalize a valid Company input', () => {
      const request: any = {
        entityId: 55,
        entityType: 'Company',
        entityDetails: {
          name: [{ full: 'Westlake Services', confidence: 1.0, type: 'LLC' }],
        },
      };

      const entity = validateAndNormalizeEntityRequest(request, 0.5);
      expect(entity.entityId).toBe(55);
      expect(entity.entityType).toBe('Company');
      expect(entity.nameCandidates[0].full).toBe('Westlake Services');
      expect(entity.nameCandidates[0].type).toBe('LLC');
    });
  });
});
