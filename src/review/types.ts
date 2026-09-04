import type { AccessorySelectionMode, PetAccessory, PetStyleV1, PetSummary, PetTraitsV1 } from '../types';

export type ReviewDecision = 'approved' | 'rejected';

export interface ReviewQueueItem {
  petId: string;
  name: string | null;
  traits: PetTraitsV1;
  submittedTraits: PetTraitsV1;
  submittedStyle: PetStyleV1;
  publishedStyle: PetStyleV1;
  createdAt: string;
  photoPresent: boolean;
  photoUrls: string[];
  accessorySelectionMode: AccessorySelectionMode;
  accessoryRequired: boolean;
  requestedAccessory: PetAccessory | null;
  publishedAccessory: PetAccessory | null;
  designVersion: number;
  similarPets: PetSummary[];
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
}

export interface ReviewRequest {
  petId: string;
  decision: ReviewDecision;
  reason?: string;
  finalName?: string;
  publishedAccessory?: PetAccessory | null;
  finalTraits?: PetTraitsV1;
  finalStyle?: PetStyleV1;
  reviewNote?: string;
}

export interface ReviewResponse {
  petId: string;
  status: ReviewDecision;
}

export type PublicationAction = 'revise' | 'pause' | 'republish';

export interface ReviewCatalogItem {
  petId: string;
  name: string | null;
  status: 'approved' | 'paused';
  traits: PetTraitsV1;
  publishedStyle: PetStyleV1;
  publishedAccessory: PetAccessory | null;
  designVersion: number;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

export interface PublicationRequest {
  petId: string;
  action: PublicationAction;
  finalTraits?: PetTraitsV1;
  finalStyle?: PetStyleV1;
  publishedAccessory?: PetAccessory | null;
  reviewNote: string;
}

export interface ReviewApi {
  getQueue(signal?: AbortSignal): Promise<ReviewQueueItem[]>;
  review(request: ReviewRequest): Promise<ReviewResponse>;
  getCatalog(query: string, signal?: AbortSignal): Promise<ReviewCatalogItem[]>;
  manage(request: PublicationRequest): Promise<{ petId: string; status: 'approved' | 'paused' }>;
}
