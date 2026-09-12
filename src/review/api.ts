import { hashPetDesign, validatePetDesign } from '../../supabase/functions/_shared/pet-design';
import type { ReviewDesignDraft, ReviewPhotoSet, ReviewPhotoAddition } from './types';
import type {
  ReviewApi,
  ReviewQueueItem,
  ReviewQueueResponse,
  ReviewRequest,
  ReviewResponse,
  PublicationRequest,
  ReviewCatalogItem,
} from './types';

type Fetcher = typeof fetch;

export class ReviewApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAccessory(value: unknown) {
  if (!isRecord(value)) return false;
  return ['ribbon', 'scarf', 'vest', 'ball'].includes(String(value.kind))
    && ['pink', 'sky', 'yellow', 'mint'].includes(String(value.color))
    && (value.assetKey === undefined || value.assetKey === `builtin:${String(value.kind)}`);
}

function isStyle(value: unknown) {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1
    && (value.coatMode === 'solid' || value.coatMode === 'point')
    && ['neat', 'fluffy', 'cloud'].includes(String(value.furStyle));
}

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  if (isRecord(payload.error) && typeof payload.error.message === 'string' && payload.error.message.trim()) {
    return payload.error.message;
  }
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isQueueItem(value: unknown): value is ReviewQueueItem {
  return isRecord(value)
    && typeof value.petId === 'string'
    && (typeof value.name === 'string' || value.name === null)
    && typeof value.createdAt === 'string'
    && typeof value.photoPresent === 'boolean'
    && Array.isArray(value.photoUrls)
    && value.photoUrls.every((url) => typeof url === 'string')
    && (value.photoCount === undefined || (Number.isInteger(value.photoCount) && Number(value.photoCount) >= value.photoUrls.length))
    && isRecord(value.traits)
    && isRecord(value.submittedTraits)
    && isStyle(value.submittedStyle)
    && isStyle(value.publishedStyle)
    && (value.accessorySelectionMode === 'owner' || value.accessorySelectionMode === 'reviewer')
    && typeof value.accessoryRequired === 'boolean'
    && (value.requestedAccessory === null || isAccessory(value.requestedAccessory))
    && (value.publishedAccessory === null || isAccessory(value.publishedAccessory))
    && typeof value.designVersion === 'number'
    && Array.isArray(value.similarPets);
}

function isCatalogItem(value: unknown): value is ReviewCatalogItem {
  return isRecord(value)
    && typeof value.petId === 'string'
    && (typeof value.name === 'string' || value.name === null)
    && (value.status === 'approved' || value.status === 'paused')
    && isRecord(value.traits)
    && isStyle(value.publishedStyle)
    && (value.publishedAccessory === null || isAccessory(value.publishedAccessory))
    && typeof value.designVersion === 'number';
}

function readPhotoSet(value: unknown, petId: string): ReviewPhotoSet {
  if (!isRecord(value) || value.petId !== petId || typeof value.revision !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.revision) || !Array.isArray(value.photos)
    || !value.photos.every((photo) => isRecord(photo)
      && typeof photo.photoId === 'string' && photo.photoId.length > 0
      && (photo.url === null || (typeof photo.url === 'string' && (/^https?:\/\//.test(photo.url) || /^\/[^/]/.test(photo.url))))
      && (photo.caption === null || (typeof photo.caption === 'string' && Array.from(photo.caption).length <= 30
        && !/[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(photo.caption)))
      && (photo.sortOrder === null || (Number.isInteger(photo.sortOrder) && Number(photo.sortOrder) >= 0))
      && typeof photo.isActive === 'boolean' && typeof photo.available === 'boolean')
    || new Set(value.photos.map((photo) => photo.photoId)).size !== value.photos.length) {
    throw new ReviewApiError('사진 응답 형식이 올바르지 않아요. 다시 불러와 주세요.');
  }
  return value as unknown as ReviewPhotoSet;
}

export function createReviewApi(fetcher: Fetcher = fetch): ReviewApi {
  return {
    async getPhotoAdditions(signal) {
      const response = await fetcher('/api/review-photo-additions', { credentials: 'same-origin', cache: 'no-store', signal });
      const payload = await readJson(response);
      if (!response.ok) throw new ReviewApiError(apiErrorMessage(payload, '추가 사진을 불러오지 못했어요.'));
      if (!isRecord(payload) || !Array.isArray(payload.items) || !payload.items.every((item) => isRecord(item)
        && typeof item.batchId === 'string' && typeof item.petId === 'string' && typeof item.expectedRevision === 'string'
        && typeof item.petStatus === 'string' && typeof item.createdAt === 'string' && (item.name === null || typeof item.name === 'string')
        && Array.isArray(item.photos) && item.photos.length > 0 && item.photos.length <= 5
        && item.photos.every((photo) => isRecord(photo) && typeof photo.photoId === 'string'
          && (photo.url === null || (typeof photo.url === 'string' && /^\/api\/review-photo\/[A-Za-z0-9_-]+$/.test(photo.url)))))) {
        throw new ReviewApiError('추가 사진 응답을 확인하지 못했어요.');
      }
      return payload.items as unknown as ReviewPhotoAddition[];
    },
    async reviewPhotoAddition(request) {
      const response = await fetcher('/api/review-photo-additions', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      const payload = await readJson(response);
      if (!response.ok) throw new ReviewApiError(apiErrorMessage(payload, '추가 사진 검수를 저장하지 못했어요.'));
      if (!isRecord(payload) || payload.batchId !== request.batchId || typeof payload.petId !== 'string' || payload.status !== request.decision) {
        throw new ReviewApiError('저장 결과를 확인하지 못했어요. 새로고침해 주세요.');
      }
      return { batchId: request.batchId, petId: payload.petId, status: request.decision };
    },
    async getPhotos(petId, signal) {
      const response = await fetcher(`/api/review-photos?petId=${encodeURIComponent(petId)}`, {
        credentials: 'same-origin', headers: { Accept: 'application/json' }, signal,
      });
      const payload = await readJson(response);
      if (!response.ok) throw new ReviewApiError(apiErrorMessage(payload, '사진을 불러오지 못했어요.'));
      return readPhotoSet(payload, petId);
    },

    async savePhotos(request) {
      const response = await fetcher('/api/review-photos', {
        method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new ReviewApiError(apiErrorMessage(payload, '사진 변경을 저장하지 못했어요.'));
      const saved = readPhotoSet(payload, request.petId);
      const active = saved.photos.filter((photo) => photo.isActive).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      if (JSON.stringify(active.map(({ photoId, caption }) => ({ photoId, caption }))) !== JSON.stringify(request.photos)) {
        throw new ReviewApiError('저장된 사진 순서·문구가 요청과 달라요. 다시 불러와 확인해 주세요.');
      }
      return saved;
    },
    async getQueue(signal) {
      const response = await fetcher('/api/review-queue', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal,
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new ReviewApiError(apiErrorMessage(payload, '검수 목록을 불러오지 못했어요.'));
      }
      if (!isRecord(payload) || !Array.isArray(payload.items) || !payload.items.every(isQueueItem)) {
        throw new ReviewApiError('검수 목록 응답 형식이 올바르지 않아요.');
      }

      return (payload as unknown as ReviewQueueResponse).items;
    },

    async saveDraft(request) {
      const response = await fetcher('/api/review-design-draft', {
        method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new ReviewApiError(apiErrorMessage(payload, 'SVG 초안을 저장하지 못했어요.'));
      if (!isRecord(payload) || payload.petId !== request.petId || !Number.isInteger(payload.draftRevision) || !isRecord(payload.editorState)) {
        throw new ReviewApiError('초안 저장 응답 형식이 올바르지 않아요.');
      }
      const document = validatePetDesign(payload.document);
      if (await hashPetDesign(document) !== payload.sha256 || await hashPetDesign(request.document) !== payload.sha256) {
        throw new ReviewApiError('저장 전후 SVG가 일치하지 않아요. 새로고침 후 확인해 주세요.');
      }
      return { ...payload, document } as unknown as ReviewDesignDraft;
    },

    async review(request: ReviewRequest) {
      const response = await fetcher('/api/review', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new ReviewApiError(apiErrorMessage(payload, '검수 결과를 저장하지 못했어요.'));
      }
      if (
        !isRecord(payload)
        || typeof payload.petId !== 'string'
        || (payload.status !== 'approved' && payload.status !== 'rejected')
      ) {
        throw new ReviewApiError('검수 저장 응답 형식이 올바르지 않아요.');
      }

      return payload as unknown as ReviewResponse;
    },

    async getCatalog(query, signal) {
      const response = await fetcher(`/api/review-catalog?q=${encodeURIComponent(query.trim())}`, {
        credentials: 'same-origin', headers: { Accept: 'application/json' }, signal,
      });
      const payload = await readJson(response);
      if (!response.ok) throw new ReviewApiError(apiErrorMessage(payload, '승인 강아지 목록을 불러오지 못했어요. 다시 시도해 주세요.'));
      if (!isRecord(payload) || !Array.isArray(payload.items) || !payload.items.every(isCatalogItem)) {
        throw new ReviewApiError('승인 강아지 응답 형식이 올바르지 않아요.');
      }
      return payload.items as ReviewCatalogItem[];
    },

    async manage(request: PublicationRequest) {
      const response = await fetcher('/api/review-publication', {
        method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new ReviewApiError(apiErrorMessage(payload, '공개 상태를 저장하지 못했어요.'));
      if (!isRecord(payload) || typeof payload.petId !== 'string' || (payload.status !== 'approved' && payload.status !== 'paused')) {
        throw new ReviewApiError('공개 상태 응답 형식이 올바르지 않아요.');
      }
      return payload as { petId: string; status: 'approved' | 'paused' };
    },
  };
}

export const reviewApi = createReviewApi();
