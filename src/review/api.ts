import type {
  ReviewApi,
  ReviewQueueItem,
  ReviewQueueResponse,
  ReviewRequest,
  ReviewResponse,
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
    && isRecord(value.traits);
}

export function createReviewApi(fetcher: Fetcher = fetch): ReviewApi {
  return {
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
  };
}

export const reviewApi = createReviewApi();
