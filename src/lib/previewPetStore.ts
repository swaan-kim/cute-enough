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

interface PreviewRevealRecord {
  date: string;
  petIds: string[];
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

export function readPreviewRevealedPetIds(date: string, storage: StorageReader = localStorage): Set<string> {
  try {
    const value = JSON.parse(storage.getItem(PREVIEW_REVEALS_KEY) ?? 'null') as PreviewRevealRecord | null;
    return value?.date === date && Array.isArray(value.petIds) ? new Set(value.petIds) : new Set();
  } catch { return new Set(); }
}

export function markPreviewPetRevealed(petId: string, date: string, storage: StorageWriter = localStorage): void {
  const petIds = readPreviewRevealedPetIds(date, storage);
  petIds.add(petId);
  storage.setItem(PREVIEW_REVEALS_KEY, JSON.stringify({ date, petIds: [...petIds] } satisfies PreviewRevealRecord));
}

export function resetPreviewReveals(storage: StorageRemover = localStorage): void {
  storage.removeItem(PREVIEW_REVEALS_KEY);
}
