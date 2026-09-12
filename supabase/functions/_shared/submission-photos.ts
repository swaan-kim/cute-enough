import { ApiError } from './api-error.ts';

export const MAX_SUBMISSION_PHOTOS = 5;
export const MAX_SOURCE_IMAGE_BYTES = 4 * 1024 * 1024;
// Normalization runs once per request. Permit a single source plus its matching
// legacy field and metadata; multi-photo clients use staged uploads then receipts.
export const MAX_PET_API_REQUEST_BYTES = 2
  * (Math.ceil(MAX_SOURCE_IMAGE_BYTES / 3) * 4 + 23) + 64 * 1024;

/** The array is authoritative; legacy clients may keep sending one dataUri. */
export function requireSubmissionDataUris(body: Record<string, unknown>): string[] {
  const photos = Object.hasOwn(body, 'dataUris') ? body.dataUris : [body.dataUri];
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > MAX_SUBMISSION_PHOTOS) {
    throw new ApiError('INVALID_PHOTO_COUNT', 400, '사진은 1장부터 5장까지 골라 주세요.');
  }
  if (photos.some((photo) => typeof photo !== 'string' || !photo)) {
    throw new ApiError('INVALID_IMAGE', 400, '사진을 다시 골라주세요.');
  }
  if (Object.hasOwn(body, 'dataUris') && Object.hasOwn(body, 'dataUri') && body.dataUri !== photos[0]) {
    throw new ApiError('AMBIGUOUS_PHOTOS', 400, '등록할 사진을 다시 확인해 주세요.');
  }
  return [...photos] as string[];
}

export function requireDirectSubmissionDataUri(body: Record<string, unknown>): string {
  const photos = requireSubmissionDataUris(body);
  if (photos.length > 1) {
    throw new ApiError('STAGED_UPLOAD_REQUIRED', 400, '사진을 한 장씩 저장한 뒤 등록을 완료해 주세요.');
  }
  return photos[0];
}

export function requireSubmissionPhotoIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= MAX_SUBMISSION_PHOTOS) {
    throw new ApiError('INVALID_PHOTO_INDEX', 400, '사진 순서를 다시 확인해 주세요.');
  }
  return value;
}

export function hasSubmissionPhotoReceipts(body: Record<string, unknown>): boolean {
  const staged = Object.hasOwn(body, 'photoReceipts');
  if (staged && (Object.hasOwn(body, 'dataUris') || Object.hasOwn(body, 'dataUri'))) {
    throw new ApiError('AMBIGUOUS_PHOTOS', 400, '등록할 사진을 다시 확인해 주세요.');
  }
  return staged;
}

export function requirePhotoUploadInput(body: Record<string, unknown>): { photoIndex: number; dataUri: string } {
  if (Object.hasOwn(body, 'dataUris') || Object.hasOwn(body, 'photoReceipts')) {
    throw new ApiError('AMBIGUOUS_PHOTOS', 400, '사진은 한 장씩 저장해 주세요.');
  }
  return { photoIndex: requireSubmissionPhotoIndex(body.photoIndex), dataUri: requireDirectSubmissionDataUri(body) };
}

/** Bound streamed bodies too: Content-Length may be absent or untrusted. */
export async function readPetApiBody(request: Request, maxBytes = MAX_PET_API_REQUEST_BYTES): Promise<Record<string, unknown>> {
  const tooLarge = () => new ApiError('REQUEST_TOO_LARGE', 413, '요청한 사진 용량이 너무 커요.');
  if (Number(request.headers.get('Content-Length') ?? 0) > maxBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('INVALID_JSON', 400, '요청 내용을 확인해 주세요.');
  const decoder = new TextDecoder();
  let byteLength = 0;
  let source = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    const body: unknown = JSON.parse(source);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected object');
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('INVALID_JSON', 400, '요청 내용을 확인해 주세요.');
  } finally {
    reader.releaseLock();
  }
}
