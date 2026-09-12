import type { OwnedPetSummary, PhotoAdditionStatus, PhotoAdditionSubmission, SubmitPhotoAdditionInput, SubmitPhotoAdditionResult } from '../types';
import { getPreviewScenario, getScenarioOwnerPet, getScenarioStorage } from '../data/previewScenarios';
import { invokePetApi, PetApiError } from './api';
import { readPreviewMyPets } from './previewPetStore';
import { isPreviewRuntime } from './runtime';
import { getSubmissionPhotos } from './submissionPhotos';
import { forgetSubmissionPhotos, uploadSubmissionPhotos } from './submissionPhotoUpload';

const PREVIEW_ADDITIONS_KEY = 'cute-enough:preview-photo-additions:v1';
const MAX_PHOTOS = 5;
const invalidResponse = () => new PetApiError('사진 등록 상태를 확인하지 못했어요. 다시 확인해 주세요.', 'INVALID_PHOTO_ADDITION_RESPONSE', 'unknown');
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

function parseSubmission(value: unknown, petId: string, submissionId?: string): PhotoAdditionSubmission {
  if (!value || typeof value !== 'object') throw invalidResponse();
  const record = value as PhotoAdditionSubmission;
  if (record.petId !== petId || typeof record.submissionId !== 'string' || !record.submissionId
    || (submissionId !== undefined && record.submissionId !== submissionId)
    || !['pending', 'approved', 'rejected'].includes(record.status)
    || !count(record.photoCount) || record.photoCount < 1 || record.photoCount > MAX_PHOTOS
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || (record.reviewNote !== undefined && typeof record.reviewNote !== 'string')) throw invalidResponse();
  // Whitelist fields: a status response must never turn pending URLs into an album.
  return { petId, submissionId: record.submissionId, status: record.status, photoCount: record.photoCount,
    createdAt: record.createdAt, ...(record.reviewNote === undefined ? {} : { reviewNote: record.reviewNote }) };
}

function parseStatus(value: unknown, petId: string, submissionId?: string): PhotoAdditionStatus {
  if (!value || typeof value !== 'object') throw invalidResponse();
  const status = value as PhotoAdditionStatus;
  if (status.petId !== petId || status.maxPhotoCount !== MAX_PHOTOS || !count(status.activePhotoCount)
    || !count(status.pendingPhotoCount) || !count(status.remainingCount)
    || status.remainingCount !== Math.max(0, MAX_PHOTOS - status.activePhotoCount - status.pendingPhotoCount)
    || typeof status.canSubmit !== 'boolean'
    || (status.canSubmit && (status.pendingPhotoCount > 0 || status.remainingCount === 0))
    || (status.unavailableReason !== undefined && typeof status.unavailableReason !== 'string')
    || (submissionId !== undefined && typeof status.found !== 'boolean')) throw invalidResponse();
  const submission = status.submission === undefined ? undefined : parseSubmission(status.submission, petId, submissionId);
  if (submissionId !== undefined && status.found !== Boolean(submission)) throw invalidResponse();
  return { petId, maxPhotoCount: MAX_PHOTOS, activePhotoCount: status.activePhotoCount,
    pendingPhotoCount: status.pendingPhotoCount, remainingCount: status.remainingCount, canSubmit: status.canSubmit,
    ...(status.unavailableReason === undefined ? {} : { unavailableReason: status.unavailableReason }),
    ...(submission === undefined ? {} : { submission }),
    ...(status.found === undefined ? {} : { found: status.found }) };
}

function previewContext(petId: string) {
  const scenario = getPreviewScenario();
  const storage = getScenarioStorage(scenario);
  const owner = getScenarioOwnerPet(scenario);
  const pet: OwnedPetSummary | undefined = owner?.id === petId ? owner : readPreviewMyPets(storage).find((item) => item.id === petId);
  if (!pet) throw new PetApiError('내가 소개한 강아지에만 사진을 더 올릴 수 있어요.', 'PHOTO_ADDITION_FORBIDDEN', 'definite', 403);
  let records: PhotoAdditionSubmission[];
  try { const stored = JSON.parse(storage.getItem(PREVIEW_ADDITIONS_KEY) ?? '[]'); records = Array.isArray(stored) ? stored : []; }
  catch { records = []; }
  return { pet, storage, records };
}

function previewStatus(petId: string, submissionId?: string): PhotoAdditionStatus {
  const { pet, records } = previewContext(petId);
  const mine = records.filter((record) => record.petId === petId);
  const activePhotoCount = pet.photoUrls?.length ?? (pet.photoUrl || pet.photoAvailable ? 1 : 0);
  const pendingPhotoCount = mine.filter((record) => record.status === 'pending').reduce((sum, record) => sum + record.photoCount, 0);
  const remainingCount = Math.max(0, MAX_PHOTOS - activePhotoCount - pendingPhotoCount);
  const allowed = ['pending', 'approved'].includes(pet.approvalStatus);
  const submission = submissionId === undefined ? mine.at(-1) : mine.find((record) => record.submissionId === submissionId);
  return { petId, activePhotoCount, pendingPhotoCount, maxPhotoCount: MAX_PHOTOS, remainingCount,
    canSubmit: allowed && remainingCount > 0 && pendingPhotoCount === 0,
    unavailableReason: !allowed ? '이 강아지는 지금 사진을 더 올릴 수 없어요.' : pendingPhotoCount > 0
      ? '추가한 사진을 검수하고 있어요. 확인이 끝나면 다시 올릴 수 있어요.'
      : remainingCount === 0 ? '사진이 5장 이상 모였어요. 기존 사진은 그대로 보관돼요.' : undefined,
    submission, ...(submissionId === undefined ? {} : { found: Boolean(submission) }) };
}

export async function fetchPhotoAdditionStatus(petId: string, submissionId?: string): Promise<PhotoAdditionStatus> {
  if (isPreviewRuntime) return previewStatus(petId, submissionId);
  const result = await invokePetApi<unknown>({ action: 'photoAdditionStatus', petId, ...(submissionId ? { submissionId } : {}) });
  return parseStatus(result, petId, submissionId);
}

/** Existing dog identity, public photos, design, collection rights and rewards never change here. */
export async function submitPhotoAddition(input: SubmitPhotoAdditionInput): Promise<SubmitPhotoAdditionResult> {
  if (isPreviewRuntime) {
    const status = previewStatus(input.petId, input.submissionId);
    if (status.submission) return { submission: status.submission, remainingCount: status.remainingCount };
    if (!status.canSubmit) throw new PetApiError(status.unavailableReason ?? '사진을 더 올릴 수 없어요.', 'PHOTO_ADDITION_UNAVAILABLE', 'definite', 409);
    const photos = getSubmissionPhotos(input);
    if (photos.length > status.remainingCount) throw new PetApiError(`사진은 ${status.remainingCount}장 더 올릴 수 있어요.`, 'PHOTO_ADDITION_LIMIT_REACHED', 'definite', 409);
    const { storage, records } = previewContext(input.petId);
    if (records.some((record) => record.submissionId === input.submissionId)) throw new PetApiError('등록 요청을 다시 시작해 주세요.', 'PHOTO_ADDITION_ID_CONFLICT', 'definite', 409);
    const submission: PhotoAdditionSubmission = { submissionId: input.submissionId, petId: input.petId,
      status: 'pending', photoCount: photos.length, createdAt: new Date().toISOString() };
    // Preview stores metadata only, not an unreviewed photo URL in public pet data.
    storage.setItem(PREVIEW_ADDITIONS_KEY, JSON.stringify([...records, submission]));
    return { submission, remainingCount: status.remainingCount - photos.length };
  }
  const photos = getSubmissionPhotos(input);
  const cacheKey = `photo-addition:${input.petId}:${input.submissionId}`;
  let photoReceipts: string[];
  try {
    photoReceipts = await uploadSubmissionPhotos(cacheKey, photos, ({ photoIndex, dataUri }) =>
      invokePetApi<{ photoReceipt: string }>({ action: 'photoAdditionUpload', petId: input.petId,
        submissionId: input.submissionId, photoIndex, dataUri }, 45_000));
  } catch (error) {
    if (error instanceof PetApiError && error.code === 'PHOTO_ADDITION_ALREADY_SUBMITTED') {
      try {
        const status = await fetchPhotoAdditionStatus(input.petId, input.submissionId);
        if (status.found && status.submission) {
          forgetSubmissionPhotos(cacheKey);
          return { submission: status.submission, remainingCount: status.remainingCount };
        }
      } catch { /* A known commit must stay locked until exact-ID reconciliation succeeds. */ }
      throw new PetApiError('사진 등록 결과를 확인하고 있어요. 같은 요청으로 다시 확인해 주세요.', 'PHOTO_ADDITION_RESULT_PENDING', 'unknown');
    }
    throw error;
  }
  try {
    const result = await invokePetApi<SubmitPhotoAdditionResult>({ action: 'photoAdditionSubmit', petId: input.petId,
      submissionId: input.submissionId, photoReceipts }, 45_000);
    if (!result || !count(result.remainingCount) || result.remainingCount > MAX_PHOTOS) throw invalidResponse();
    const submission = parseSubmission(result.submission, input.petId, input.submissionId);
    forgetSubmissionPhotos(cacheKey);
    return { submission, remainingCount: result.remainingCount };
  } catch (error) {
    if (error instanceof PetApiError && ['INVALID_PHOTO_RECEIPT', 'PHOTO_RECEIPT_EXPIRED', 'PET_PHOTO_MISSING'].includes(error.code)) forgetSubmissionPhotos(cacheKey);
    throw error;
  }
}
