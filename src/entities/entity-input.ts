import { NameCandidate } from './name-candidate';
import { AddressCandidate } from './address-candidate';

export interface BaseEntityInput {
  entityId: number;
  sender?: string;
  nameCandidates: NameCandidate[];
  addressCandidates?: AddressCandidate[];
}

export interface PersonEntity extends BaseEntityInput {
  entityType: 'Person';
}

export interface CompanyEntity extends BaseEntityInput {
  entityType: 'Company';
}

export type EntityInput = PersonEntity | CompanyEntity;
