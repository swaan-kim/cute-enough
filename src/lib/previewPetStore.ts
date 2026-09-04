import type { OwnedPetSummary, SubmitPetResult } from '../types';

const PREVIEW_MY_PETS_KEY = 'cute-enough:preview-my-pets';
const PREVIEW_SUBMISSIONS_KEY = 'cute-enough:preview-submissions';
const PREVIEW_REVEALS_KEY = 'cute-enough:preview-reveals';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'getItem' | 'setItem'>;
type StorageRemover = Pick<Storage, 'removeItem'>;

interface PreviewSubmissionRecord {
  submissionId: string;
  result: SubmitPetResult;
}

interface LegacyPreviewRevealRecord {
  date: string;
  petIds: string[];
}

export interface PreviewRevealRecord {
  petId: string;
  /** 새 레코드에는 항상 있고, 날짜 기반 구버전 저장값을 읽을 때만 없을 수 있다. */
  revisitUntil?: string;
  /** 자정을 넘겨 다시 열어도 처음 골랐던 실사가 바뀌지 않도록 쓴다. */
  photoDate: string;
}

function parseArray<T>(value: string | null): T[] {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch { return []; }
}

export function readPreviewMyPets(storage: StorageReader = localStorage): OwnedPetSummary[] {
  return parseArray<OwnedPetSummary>(storage.getItem(PREVIEW_MY_PETS_KEY));
}

export function findPreviewSubmission(submissionId: string, storage: StorageReader = localStorage): SubmitPetResult | undefined {
  return parseArray<PreviewSubmissionRecord>(storage.getItem(PREVIEW_SUBMISSIONS_KEY))
    .find((item) => item.submissionId === submissionId)?.result;
}

export function savePreviewSubmission(
  submissionId: string,
  result: SubmitPetResult,
  storage: StorageWriter = localStorage,
): void {
  const mine: OwnedPetSummary = {
    ...result.pet,
    isMine: true,
    ownerPinned: true,
    approvalStatus: result.pet.approvalStatus ?? 'pending',
    createdAt: new Date().toISOString(),
  };
  const pets = [mine, ...readPreviewMyPets(storage).filter((pet) => pet.id !== mine.id)];
  storage.setItem(PREVIEW_MY_PETS_KEY, JSON.stringify(pets));

  const submissions = parseArray<PreviewSubmissionRecord>(storage.getItem(PREVIEW_SUBMISSIONS_KEY));
  storage.setItem(PREVIEW_SUBMISSIONS_KEY, JSON.stringify([
    { submissionId, result: { ...result, pet: mine } },
    ...submissions.filter((item) => item.submissionId !== submissionId),
  ]));
}

function readStoredPreviewReveals(storage: StorageReader): PreviewRevealRecord[] {
  try {
    const value = JSON.parse(storage.getItem(PREVIEW_REVEALS_KEY) ?? 'null') as unknown;
    if (Array.isArray(value)) {
      return value.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const record = candidate as Record<string, unknown>;
        if (typeof record.petId !== 'string' || typeof record.photoDate !== 'string') return [];
        if (record.revisitUntil !== undefined && typeof record.revisitUntil !== 'string') return [];
        return [{
          petId: record.petId,
          photoDate: record.photoDate,
          revisitUntil: record.revisitUntil,
        } as PreviewRevealRecord];
      });
    }

    const legacy = value as LegacyPreviewRevealRecord | null;
    if (!legacy || typeof legacy.date !== 'string' || !Array.isArray(legacy.petIds)) return [];
    return legacy.petIds
      .filter((petId): petId is string => typeof petId === 'string')
      .map((petId) => ({ petId, photoDate: legacy.date }));
  } catch { return []; }
}

/** 충전 경계가 지나지 않은 미리보기 재열람 기록만 반환한다. */
export function readActivePreviewReveals(
  currentDate: string,
  now = new Date(),
  storage: StorageReader = localStorage,
): PreviewRevealRecord[] {
  return readStoredPreviewReveals(storage).filter((record) => {
    if (record.revisitUntil !== undefined) {
      const revisitUntil = new Date(record.revisitUntil).getTime();
      return Number.isFinite(revisitUntil) && revisitUntil > now.getTime();
    }
    return record.photoDate === currentDate;
  });
}

export function findActivePreviewReveal(
  petId: string,
  currentDate: string,
  now = new Date(),
  storage: StorageReader = localStorage,
): PreviewRevealRecord | undefined {
  return readActivePreviewReveals(currentDate, now, storage).find((record) => record.petId === petId);
}

/** @deprecated 시간 기반 레코드를 쓰는 코드는 `readActivePreviewReveals`를 사용한다. */
export function readPreviewRevealedPetIds(
  date: string,
  storage: StorageReader = localStorage,
  now = new Date(),
): Set<string> {
  return new Set(readActivePreviewReveals(date, now, storage).map((record) => record.petId));
}

/** 오늘 한 번이라도 실제 사진 공개에 성공한 공개견 ID. 재열람 만료와 진행도는 별개다. */
export function readPreviewMetPetIds(
  date: string,
  storage: StorageReader = localStorage,
): Set<string> {
  return new Set(
    readStoredPreviewReveals(storage)
      .filter((record) => record.photoDate === date)
      .map((record) => record.petId),
  );
}

export function markPreviewPetRevealed(
  petId: string,
  revisitUntil: string,
  photoDate: string,
  storage: StorageWriter = localStorage,
): void {
  const records = readStoredPreviewReveals(storage);
  storage.setItem(PREVIEW_REVEALS_KEY, JSON.stringify([
    { petId, revisitUntil, photoDate } satisfies PreviewRevealRecord,
    ...records.filter((record) => record.petId !== petId),
  ]));
}

export function resetPreviewReveals(storage: StorageRemover = localStorage): void {
  storage.removeItem(PREVIEW_REVEALS_KEY);
}
