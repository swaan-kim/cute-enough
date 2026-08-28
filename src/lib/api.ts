import { createClient } from '@supabase/supabase-js';
import { SAMPLE_PETS } from '../data/samplePets';
import type { HouseResult, OwnedPetSummary, PetSummary, PetTraitsV1, RevealResult, SharedPetResult, SubmissionStatusResult, SubmitPetResult, UnlockMethod } from '../types';
import { consumeAllowance, FREE_RECHARGE_INTERVAL_MS, readAllowance, saveAllowance } from './allowance';
import { composeHousePets, orderDailyPets } from './housePets';
import {
  findActivePreviewReveal,
  findPreviewSubmission,
  markPreviewPetRevealed,
  readActivePreviewReveals,
  readPreviewMyPets,
  savePreviewSubmission,
  type PreviewRevealRecord,
} from './previewPetStore';
import { isPreviewRuntime } from './runtime';
import { hasPetPhoto, selectPetPhotoUrl } from './petPhoto';
import { normalizePetTraitColors } from './petTraits';
import { getUserHash } from './toss';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = !isPreviewRuntime && url && key ? createClient(url, key) : null;

export type PetApiErrorOutcome = 'definite' | 'unknown';

export class PetApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly outcome: PetApiErrorOutcome,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PetApiError';
  }
}

export interface SubmitPetInput {
  submissionId: string;
  dataUri: string;
  name?: string;
  traits: PetTraitsV1;
}

export function isUnknownPetApiOutcome(error: unknown): error is PetApiError {
  return error instanceof PetApiError && error.outcome === 'unknown';
}

function requireSupabase() {
  if (!supabase) throw new PetApiError('운영 서버 연결이 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요.', 'API_UNAVAILABLE', 'definite');
  return supabase;
}

function errorDetails(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? '');
  const candidate = error as { name?: unknown; message?: unknown; cause?: unknown };
  return [candidate.name, candidate.message, candidate.cause]
    .filter((value) => typeof value === 'string')
    .join('|');
}

export async function toPetApiError(error: unknown): Promise<PetApiError> {
  if (error instanceof PetApiError) return error;
  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: Response }).context
    : undefined;
  if (context && typeof context.json === 'function') {
    try {
      const payload = await context.json() as { error?: string; code?: string };
      if (payload.error) return new PetApiError(
        payload.error,
        payload.code ?? 'FUNCTION_ERROR',
        context.status >= 500 && (!payload.code || payload.code === 'INTERNAL_ERROR') ? 'unknown' : 'definite',
        context.status,
      );
    } catch { /* Fall through to a transport-safe error. */ }
  }
  const details = errorDetails(error).toUpperCase();
  if (details.includes('TIMEOUT') || details.includes('ABORT')) {
    return new PetApiError('요청 결과를 아직 확인하지 못했어요.', 'REQUEST_TIMEOUT', 'unknown');
  }
  return new PetApiError('서버와 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.', 'NETWORK_ERROR', 'unknown');
}

async function invokePetApi<T>(body: Record<string, unknown>, timeoutMs = 12_000): Promise<T> {
  const client = requireSupabase();
  const userHash = await getUserHash();
  try {
    const { data, error } = await client.functions.invoke('pet-api', {
      body: { ...body, userHash },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (error) throw await toPetApiError(error);
    return data as T;
  } catch (error) {
    throw await toPetApiError(error);
  }
}

function normalizePetSummaryColors<T extends PetSummary>(pet: T): T {
  const traits = normalizePetTraitColors(pet.traits);
  return traits === pet.traits ? pet : { ...pet, traits };
}

function normalizeSubmitResultColors(result: SubmitPetResult): SubmitPetResult {
  const pet = normalizePetSummaryColors(result.pet);
  return pet === result.pet ? result : { ...result, pet };
}

function withPreviewRevisit<T extends PetSummary>(pet: T, record?: PreviewRevealRecord): T {
  return {
    ...pet,
    revisitUntil: record?.revisitUntil,
    // 기존 화면의 문구/표시도 새 시간 기반 기록과 같이 유지한다.
    revealedToday: Boolean(record),
  };
}

export async function fetchHouse(): Promise<HouseResult> {
  if (isPreviewRuntime) {
    const now = new Date();
    const allowance = readAllowance(undefined, now);
    const viewerKey = await getUserHash();
    const revisitRecords = readActivePreviewReveals(allowance.date, now);
    const revisitByPetId = new Map(revisitRecords.map((record) => [record.petId, record]));
    const mine = readPreviewMyPets().map((pet) => normalizePetSummaryColors(
      withPreviewRevisit(pet, revisitByPetId.get(pet.id)),
    ));
    const publicPets = orderDailyPets(SAMPLE_PETS, viewerKey, allowance.date).map((pet) => ({
      ...normalizePetSummaryColors(withPreviewRevisit(pet, revisitByPetId.get(pet.id))),
      approvalStatus: 'approved' as const,
      shareable: true,
    }));
    return { pets: composeHousePets(mine, publicPets), allowance };
  }
  const result = await invokePetApi<HouseResult>({ action: 'house' });
  return { ...result, pets: result.pets.map(normalizePetSummaryColors).filter(hasPetPhoto) };
}

export async function fetchSharedPet(petId: string): Promise<SharedPetResult> {
  if (isPreviewRuntime) {
    const owned = readPreviewMyPets().find((item) => item.id === petId);
    const pet = SAMPLE_PETS.find((item) => item.id === petId) ?? owned;
    if (!pet) throw new Error('이 친구는 지금 만날 수 없어요.');
    const now = new Date();
    const allowance = readAllowance(undefined, now);
    const revisit = findActivePreviewReveal(pet.id, allowance.date, now);
    return {
      pet: normalizePetSummaryColors(withPreviewRevisit({
        ...pet,
        isMine: Boolean(owned),
        ownerPinned: Boolean(owned),
        approvalStatus: pet.approvalStatus ?? 'approved',
        shareable: true,
      }, revisit)),
      allowance,
    };
  }
  const result = await invokePetApi<SharedPetResult>({ action: 'shared', petId });
  return { ...result, pet: normalizePetSummaryColors(result.pet) };
}

export async function fetchMyPets(): Promise<OwnedPetSummary[]> {
  if (isPreviewRuntime) {
    const now = new Date();
    const allowance = readAllowance(undefined, now);
    const revisitRecords = readActivePreviewReveals(allowance.date, now);
    const revisitByPetId = new Map(revisitRecords.map((record) => [record.petId, record]));
    return readPreviewMyPets().map((pet) => normalizePetSummaryColors(
      withPreviewRevisit(pet, revisitByPetId.get(pet.id)),
    ));
  }
  const data = await invokePetApi<{ pets: OwnedPetSummary[] }>({ action: 'mine' });
  return data.pets.map(normalizePetSummaryColors);
}

export async function revealPet(pet: PetSummary, method: UnlockMethod, adSessionId?: string): Promise<RevealResult> {
  if (isPreviewRuntime) {
    const now = new Date();
    const current = readAllowance(undefined, now);
    const viewerKey = await getUserHash();
    const photoUrl = selectPetPhotoUrl(pet, current.date, viewerKey);
    if (!photoUrl) throw new Error('이 친구의 사진을 불러오지 못했어요.');
    const allowance = consumeAllowance(current, method, now);
    const revisitUntil = allowance.nextChargeAt
      ?? new Date(now.getTime() + FREE_RECHARGE_INTERVAL_MS).toISOString();
    if (!revisitUntil) throw new Error('재열람 시간을 확인하지 못했어요. 다시 시도해 주세요.');
    saveAllowance(allowance);
    markPreviewPetRevealed(pet.id, revisitUntil, current.date);
    return {
      photoUrl,
      signedUrlExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      revisitUntil,
      allowance,
    };
  }
  return invokePetApi<RevealResult>({ action: 'reveal', petId: pet.id, unlockMethod: method, adSessionId });
}

/** 충전 경계 전에 공개한 같은 사진을 이용권 차감 없이 다시 연다. */
export async function reopenPet(pet: PetSummary): Promise<RevealResult> {
  if (isPreviewRuntime) {
    const now = new Date();
    const allowance = readAllowance(undefined, now);
    const revisit = findActivePreviewReveal(pet.id, allowance.date, now);
    if (!revisit) throw new Error('이용권이 충전되기 전에 만난 사진만 다시 볼 수 있어요.');
    const viewerKey = await getUserHash();
    const photoUrl = selectPetPhotoUrl(pet, revisit.photoDate, viewerKey);
    if (!photoUrl) throw new Error('이 친구의 사진을 불러오지 못했어요.');
    return {
      photoUrl,
      signedUrlExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      revisitUntil: revisit.revisitUntil,
      allowance,
    };
  }
  return invokePetApi<RevealResult>({ action: 'reveal', petId: pet.id, revisit: true });
}

export async function fetchSubmissionStatus(submissionId: string): Promise<SubmissionStatusResult> {
  if (isPreviewRuntime) {
    const existing = findPreviewSubmission(submissionId);
    return existing ? { found: true, result: normalizeSubmitResultColors(existing) } : { found: false };
  }
  const status = await invokePetApi<SubmissionStatusResult>({ action: 'submissionStatus', submissionId }, 8_000);
  return status.found
    ? { found: true, result: normalizeSubmitResultColors(status.result) }
    : status;
}

export async function submitPet(input: SubmitPetInput): Promise<SubmitPetResult> {
  const normalizedInput = { ...input, traits: normalizePetTraitColors(input.traits) };
  if (isPreviewRuntime) {
    const existing = findPreviewSubmission(normalizedInput.submissionId);
    if (existing) return normalizeSubmitResultColors(existing);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const pet: PetSummary = {
      id: crypto.randomUUID(), name: normalizedInput.name, traits: normalizedInput.traits, photoUrl: normalizedInput.dataUri,
      isMine: true, ownerPinned: true, approvalStatus: 'pending', shareable: true,
    };
    const current = readAllowance();
    const rewardGranted = !current.uploadCredit;
    const result = { pet, rewardGranted, uploadRewardPetId: rewardGranted ? pet.id : undefined };
    savePreviewSubmission(normalizedInput.submissionId, result);
    return result;
  }
  const result = await invokePetApi<SubmitPetResult>({ action: 'submit', ...normalizedInput });
  return normalizeSubmitResultColors(result);
}

export async function reportPet(petId: string, reason = 'inappropriate'): Promise<void> {
  if (isPreviewRuntime) return;
  await invokePetApi<{ reported: boolean }>({ action: 'report', petId, reason });
}
