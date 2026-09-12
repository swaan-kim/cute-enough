import { ApiError } from '../_shared/api-error.ts';
import { verifyPhotoReceipts } from '../_shared/submission-photo-receipts.ts';
import { hasSubmissionPhotoReceipts, requirePhotoUploadInput } from '../_shared/submission-photos.ts';
import { rejectCreatorDesignFields, requireUuid } from '../_shared/validation.ts';
import { uploadSubmissionPhoto, type SubmissionClient } from './submission-api.ts';

export type PhotoAdditionSubmission = {
  submissionId: string; petId: string; status: 'pending' | 'approved' | 'rejected';
  photoCount: number; createdAt: string; reviewNote?: string;
};
export type PhotoAdditionStatus = {
  petId: string; activePhotoCount: number; pendingPhotoCount: number; maxPhotoCount: 5;
  remainingCount: number; canSubmit: boolean; unavailableReason?: string;
  submission?: PhotoAdditionSubmission; found?: boolean;
};
export interface PhotoAdditionClient extends Pick<SubmissionClient, 'from' | 'storage'> {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

export function photoAdditionError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const known: Array<[string, number, string]> = [
    ['PHOTO_ADDITION_PET_NOT_FOUND', 404, '사진을 추가할 강아지를 찾지 못했어요.'],
    ['PHOTO_ADDITION_NOT_ALLOWED', 409, '지금은 이 강아지에게 사진을 추가할 수 없어요.'],
    ['PHOTO_ADDITION_PENDING', 409, '추가한 사진을 검수하고 있어요. 검수가 끝난 뒤 다시 추가해 주세요.'],
    ['PHOTO_ADDITION_CAPACITY_REACHED', 409, '강아지 사진은 검수 중인 사진을 포함해 최대 5장까지 등록할 수 있어요.'],
    ['PHOTO_ADDITION_ALREADY_SUBMITTED', 409, '이미 접수한 사진이에요. 추가 결과를 확인해 주세요.'],
    ['PHOTO_ADDITION_CONFLICT', 409, '사진 추가 요청을 다시 시작해 주세요.'],
    ['INVALID_PHOTO_ADDITION_INPUT', 400, '사진 추가 요청을 다시 확인해 주세요.'],
    ['INVALID_PHOTO_COUNT', 400, '추가할 사진 수를 다시 확인해 주세요.'],
    ['INVALID_PHOTO_INDEX', 400, '사진 순서를 다시 확인해 주세요.'],
    ['INVALID_PHOTO_PATH', 400, '저장한 사진을 확인하지 못했어요. 사진을 다시 골라 주세요.'],
    ['PET_PHOTO_MISSING', 503, '사진 저장을 확인하지 못했어요. 사진을 다시 골라 주세요.'],
  ];
  for (const [code, status, text] of known) {
    if (message.includes(code)) return new ApiError(code === 'INVALID_PHOTO_PATH' ? 'INVALID_PHOTO_RECEIPT' : code, status, text);
  }
  return error;
}

function identity(ownerHash: string, body: Record<string, unknown>, exact = true) {
  return {
    ownerHash,
    petId: requireUuid(body.petId).toLowerCase(),
    submissionId: exact || Object.hasOwn(body, 'submissionId')
      ? requireUuid(body.submissionId, '사진 추가 요청을 다시 시작해 주세요.').toLowerCase() : undefined,
  };
}

function rejectPetChanges(body: Record<string, unknown>) {
  rejectCreatorDesignFields(body);
  if (['name', 'traits', 'style', 'accessorySelectionMode', 'requestedAccessory',
    'status', 'approvalStatus', 'rewardGranted', 'uploadRewardPetId'].some((key) => Object.hasOwn(body, key))) {
    throw new ApiError('PHOTO_ADDITION_FIELDS_FORBIDDEN', 400, '사진 추가에서는 강아지 정보를 바꿀 수 없어요.');
  }
}

/** All reads are owner-scoped summaries: no pending photo ID, path or URL. */
export function createPhotoAdditionApi(client: PhotoAdditionClient, options: {
  secret: () => string;
  uploadsEnabled: () => boolean;
  decodePhoto: (dataUri: unknown) => { bytes: Uint8Array; mime: 'image/jpeg' };
}) {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    try {
      const { data, error } = await client.rpc(name, args);
      if (error || !data) throw error ?? new Error('PHOTO_ADDITION_RESULT_UNAVAILABLE');
      return data as T;
    } catch (error) { throw photoAdditionError(error); }
  }
  const requireEnabled = () => {
    if (!options.uploadsEnabled()) throw new ApiError('UPLOADS_DISABLED', 503, '사진 추가는 지금 준비 중이에요. 잠시 뒤 다시 시도해 주세요.');
  };
  async function status(ownerHash: string, body: Record<string, unknown>) {
    const input = identity(ownerHash, body, false);
    const result = await rpc<PhotoAdditionStatus>('get_pet_photo_addition_status', {
      p_owner_hash: ownerHash, p_pet_id: input.petId, p_submission_id: input.submissionId ?? null,
    });
    if (!result.unavailableReason) return result;
    const reason = photoAdditionError({ message: result.unavailableReason });
    return { ...result, unavailableReason: reason instanceof ApiError
      ? reason.message : '지금은 사진을 추가할 수 없어요. 잠시 뒤 다시 확인해 주세요.' };
  }
  return {
    status,
    async upload(ownerHash: string, body: Record<string, unknown>) {
      rejectPetChanges(body);
      const input = identity(ownerHash, body);
      const { photoIndex, dataUri } = requirePhotoUploadInput(body);
      // Eligibility precedes CPU-heavy normalization and Storage writes.
      await rpc('prepare_pet_photo_addition', {
        p_owner_hash: ownerHash, p_pet_id: input.petId, p_submission_id: input.submissionId, p_photo_index: photoIndex,
      });
      requireEnabled();
      return uploadSubmissionPhoto(client, {
        ...input, submissionId: input.submissionId!, photoIndex, purpose: 'photo-addition',
      }, options.decodePhoto(dataUri), options.secret());
    },
    async submit(ownerHash: string, body: Record<string, unknown>): Promise<{ submission: PhotoAdditionSubmission; remainingCount: number }> {
      rejectPetChanges(body);
      const input = identity(ownerHash, body);
      // Recover successful retries before expiry/feature gates. No second reward
      // or mutation occurs, even if a creator has already decided this batch.
      const existing = await status(ownerHash, body);
      if (existing.found && existing.submission) return { submission: existing.submission, remainingCount: existing.remainingCount };
      requireEnabled();
      if (!hasSubmissionPhotoReceipts(body)) throw new ApiError('STAGED_UPLOAD_REQUIRED', 400, '사진을 한 장씩 저장한 뒤 추가를 완료해 주세요.');
      const receipts = await verifyPhotoReceipts(body.photoReceipts, {
        ...input, submissionId: input.submissionId!, purpose: 'photo-addition',
      }, options.secret());
      try {
        return await rpc('submit_pet_photo_addition', {
          p_owner_hash: ownerHash, p_pet_id: input.petId, p_submission_id: input.submissionId,
          p_storage_paths: receipts.map((photo) => photo.storagePath), p_photo_sha256: receipts.map((photo) => photo.sha256),
        });
      } catch (error) {
        // A timeout can arrive after commit; reconcile the exact request. All
        // staged objects survive failed/uncertain responses and concurrent retries.
        try {
          const recovered = await status(ownerHash, body);
          if (recovered.found && recovered.submission) return { submission: recovered.submission, remainingCount: recovered.remainingCount };
        } catch { /* Original error remains the actionable response. */ }
        throw error;
      }
    },
  };
}
