import type { AccessorySelectionMode, PetAccessory, PetStyleV1, PetSummary, PetTraitsV1 } from '../types';
import type { PetDesignV1, PublishedPetDesign } from '../../supabase/functions/_shared/pet-design';
import type { PetDesignEditorState } from '../design/designEditor';

export interface ReviewEditorState { finalTraits: PetTraitsV1; finalStyle: PetStyleV1; publishedAccessory: PetAccessory | null; editor: PetDesignEditorState; }
export interface ReviewDesignDraft { petId: string; draftRevision: number; expectedDesignVersion: number; sha256: string; document: PetDesignV1; editorState: ReviewEditorState; }
export interface ReviewPhoto {
  photoId: string;
  url: string | null;
  caption: string | null;
  sortOrder: number | null;
  isActive: boolean;
  available: boolean;
}
export interface ReviewPhotoSet { petId: string; revision: string; photos: ReviewPhoto[]; }
export interface ReviewPhotoAddition {
  batchId: string; petId: string; name: string | null; petStatus: string; createdAt: string; expectedRevision: string;
  photos: Array<{ photoId: string; url: string | null }>;
}
export interface ReviewPhotoAdditionRequest { batchId: string; expectedRevision: string; decision: 'approved' | 'rejected'; note: string; }
export interface SaveReviewPhotosRequest {
  petId: string;
  expectedRevision: string;
  photos: Array<{ photoId: string; caption: string | null }>;
}
export interface SaveDesignDraftRequest { petId: string; expectedDraftRevision: number; expectedDesignVersion: number; document: PetDesignV1; editorState: ReviewEditorState; }

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
  /** Includes photos whose temporary URL could not be issued. */
  photoCount?: number;
  accessorySelectionMode: AccessorySelectionMode;
  accessoryRequired: boolean;
  requestedAccessory: PetAccessory | null;
  publishedAccessory: PetAccessory | null;
  designVersion: number;
  similarPets: PetSummary[];
  draftDesign?: ReviewDesignDraft | null;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
}

export interface ReviewRequest {
  expectedDraftRevision?: number;
  expectedDesignVersion?: number;
  petId: string;
  decision: ReviewDecision;
  reason?: string;
  finalName?: string;
  reviewNote?: string;
}

export interface ReviewResponse {
  petId: string;
  status: ReviewDecision;
  designVersion?: number;
  publishedDesign?: PublishedPetDesign;
  draftRevision?: number;
}

export type PublicationAction = 'revise' | 'pause' | 'republish';

export interface ReviewCatalogItem {
  designStatus?: 'missing' | 'ready' | 'unavailable';
  publishedDesign?: PublishedPetDesign | null;
  draftDesign?: ReviewDesignDraft | null;
  publishedEditorState?: ReviewEditorState | null;
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
  expectedDraftRevision?: number;
  expectedDesignVersion?: number;
  petId: string;
  action: PublicationAction;
  reviewNote: string;
}

export interface ReviewApi {
  getPhotoAdditions?(signal?: AbortSignal): Promise<ReviewPhotoAddition[]>;
  reviewPhotoAddition?(request: ReviewPhotoAdditionRequest): Promise<{ batchId: string; petId: string; status: 'approved' | 'rejected' }>;
  getPhotos?(petId: string, signal?: AbortSignal): Promise<ReviewPhotoSet>;
  savePhotos?(request: SaveReviewPhotosRequest): Promise<ReviewPhotoSet>;
  getQueue(signal?: AbortSignal): Promise<ReviewQueueItem[]>;
  review(request: ReviewRequest): Promise<ReviewResponse>;
  getCatalog(query: string, signal?: AbortSignal): Promise<ReviewCatalogItem[]>;
  manage(request: PublicationRequest): Promise<{ petId: string; status: 'approved' | 'paused'; designVersion?: number; publishedDesign?: PublishedPetDesign; draftRevision?: number }>;
  saveDraft(request: SaveDesignDraftRequest): Promise<ReviewDesignDraft>;
}
