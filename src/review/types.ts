import type { PetTraitsV1 } from '../types';

export type ReviewDecision = 'approved' | 'rejected';

export interface ReviewQueueItem {
  petId: string;
  name: string | null;
  traits: PetTraitsV1;
  createdAt: string;
  photoPresent: boolean;
  photoUrls: string[];
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
}

export interface ReviewRequest {
  petId: string;
  decision: ReviewDecision;
  reason?: string;
}

export interface ReviewResponse {
  petId: string;
  status: ReviewDecision;
}

export interface ReviewApi {
  getQueue(signal?: AbortSignal): Promise<ReviewQueueItem[]>;
  review(request: ReviewRequest): Promise<ReviewResponse>;
}
