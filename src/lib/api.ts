import { FunctionsClient } from '@supabase/functions-js';
import { SAMPLE_PETS } from '../data/samplePets';
import {
  applyScenarioAllowance,
  getCompleteScenarioRevisitUntil,
  getPreviewScenario,
  getScenarioOwnerPet,
  getScenarioPublicPets,
  getScenarioStorage,
} from '../data/previewScenarios';
import type { AccessorySelectionMode, HouseResult, OwnedPetSummary, OwnerPhotoResult, PetAccessory, PetStyleV1, PetSummary, PetTraitsV1, RevealResult, SharedPetResult, SubmissionStatusResult, SubmitPetResult, UnlockMethod } from '../types';
import { consumeAllowance, FREE_RECHARGE_INTERVAL_MS, getKstDate, readAllowance, saveAllowance } from './allowance';
import { HOUSE_PET_LIMIT, orderDailyPets } from './housePets';
import {
  findActivePreviewReveal,
  findPreviewSubmission,
  markPreviewPetRevealed,
  readActivePreviewReveals,
  readPreviewMetPetIds,
  readPreviewMyPets,
  savePreviewSubmission,
  type PreviewRevealRecord,
} from './previewPetStore';
import { isPreviewRuntime } from './runtime';
import { hasPetPhoto, selectPetPhotoUrl } from './petPhoto';
import { normalizePetTraitColors } from './petTraits';
import { applyCoatMode, normalizePetStyle } from './petStyle';
import { getUserHash } from './toss';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const functions = !isPreviewRuntime && url && key
  ? new FunctionsClient(`${url.replace(/\/+$/, '')}/functions/v1`, {
    // pet-api validates the Apps-in-Toss anonymous key in the request body.
    // Only the public project key is needed for the Supabase gateway itself.
    headers: { apikey: key },
  })
  : null;

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
  style: PetStyleV1;
  accessorySelectionMode: AccessorySelectionMode;
  requestedAccessory?: PetAccessory;
}

export function isUnknownPetApiOutcome(error: unknown): error is PetApiError {
  return error instanceof PetApiError && error.outcome === 'unknown';
}

function requireFunctions() {
  if (!functions) throw new PetApiError('운영 서버 연결이 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요.', 'API_UNAVAILABLE', 'definite');
  return functions;
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

function requestSignal(timeoutMs: number, externalSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([externalSignal, timeoutSignal]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

async function invokePetApi<T>(body: Record<string, unknown>, timeoutMs = 12_000, externalSignal?: AbortSignal): Promise<T> {
  const client = requireFunctions();
  const userHash = await getUserHash();
  if (externalSignal?.aborted) {
    throw new PetApiError('이전 요청을 취소했어요.', 'REQUEST_CANCELLED', 'definite');
  }
  try {
    const { data, error } = await client.invoke('pet-api', {
      body: { ...body, userHash },
      signal: requestSignal(timeoutMs, externalSignal),
    });
    if (error) throw await toPetApiError(error);
    return data as T;
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new PetApiError('이전 요청을 취소했어요.', 'REQUEST_CANCELLED', 'definite');
    }
    throw await toPetApiError(error);
  }
}

function normalizePetSummaryColors<T extends PetSummary>(pet: T): T {
  const traits = normalizePetTraitColors(pet.traits);
  const publishedStyle = normalizePetStyle(traits, pet.publishedStyle);
  return { ...pet, traits, publishedStyle };
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

export async function fetchHouse(signal?: AbortSignal): Promise<HouseResult> {
  if (isPreviewRuntime) {
    const now = new Date();
    const scenario = getPreviewScenario();
    const storage = getScenarioStorage(scenario);
    const allowance = applyScenarioAllowance(scenario, readAllowance(storage, now), now);
    const viewerKey = await getUserHash();
    const revisitRecords = readActivePreviewReveals(allowance.date, now, storage);
    const revisitByPetId = new Map(revisitRecords.map((record) => [record.petId, record]));
    const scenarioOwner = getScenarioOwnerPet(scenario);
    const mine = (scenarioOwner ? [scenarioOwner] : readPreviewMyPets(storage)).map((pet) => normalizePetSummaryColors(
      withPreviewRevisit({ ...pet, ownerPhotoAvailable: hasPetPhoto(pet) }, revisitByPetId.get(pet.id)),
    ));
    const ownedIds = new Set(mine.map((pet) => pet.id));
    const publicPool = getScenarioPublicPets(scenario) ?? SAMPLE_PETS;
    const completeRevisitUntil = getCompleteScenarioRevisitUntil(scenario, now);
    const dailyPets = orderDailyPets(publicPool.filter((pet) => !ownedIds.has(pet.id)), viewerKey, allowance.date)
      .slice(0, HOUSE_PET_LIMIT)
      .map((pet) => ({
      ...normalizePetSummaryColors(withPreviewRevisit(pet, completeRevisitUntil
        ? { petId: pet.id, photoDate: allowance.date, revisitUntil: completeRevisitUntil }
        : revisitByPetId.get(pet.id))),
      approvalStatus: 'approved' as const,
      shareable: true,
      }));
    const ownerBonusPet = mine.find((pet) => (
      hasPetPhoto(pet) && ['pending', 'approved'].includes(pet.approvalStatus)
    ));
    const metIds = readPreviewMetPetIds(allowance.date, storage);
    const dailyMetIds = completeRevisitUntil
      ? dailyPets.map((pet) => pet.id)
      : dailyPets.filter((pet) => metIds.has(pet.id)).map((pet) => pet.id);
    const dailyProgress = {
      date: allowance.date,
      metPetIds: dailyMetIds,
      metCount: dailyMetIds.length,
      totalCount: HOUSE_PET_LIMIT,
      completed: dailyMetIds.length >= HOUSE_PET_LIMIT,
    };
    return { pets: dailyPets, dailyPets, ownerBonusPet, allowance, dailyProgress };
  }
  const result = await invokePetApi<HouseResult>({ action: 'house', apiVersion: 2 }, 12_000, signal);
  const dailyPets = (result.dailyPets ?? result.pets ?? [])
    .map(normalizePetSummaryColors)
    .filter(hasPetPhoto)
    .slice(0, HOUSE_PET_LIMIT);
  const ownerBonusPet = result.ownerBonusPet
    ? normalizePetSummaryColors(result.ownerBonusPet)
    : undefined;
  return { ...result, pets: dailyPets, dailyPets, ownerBonusPet };
}

export async function fetchSharedPet(petId: string, signal?: AbortSignal): Promise<SharedPetResult> {
  if (signal?.aborted) throw new PetApiError('이전 요청을 취소했어요.', 'REQUEST_CANCELLED', 'definite');
  if (isPreviewRuntime) {
    const scenario = getPreviewScenario();
    const storage = getScenarioStorage(scenario);
    const scenarioOwner = getScenarioOwnerPet(scenario);
    const owned = (scenarioOwner ? [scenarioOwner] : readPreviewMyPets(storage)).find((item) => item.id === petId);
    const pet = (getScenarioPublicPets(scenario) ?? SAMPLE_PETS).find((item) => item.id === petId) ?? owned;
    if (!pet) throw new Error('이 친구는 지금 만날 수 없어요.');
    const now = new Date();
    const allowance = applyScenarioAllowance(scenario, readAllowance(storage, now), now);
    const completeRevisitUntil = getCompleteScenarioRevisitUntil(scenario, now);
    const revisit = completeRevisitUntil
      ? { petId: pet.id, photoDate: allowance.date, revisitUntil: completeRevisitUntil }
      : findActivePreviewReveal(pet.id, allowance.date, now, storage);
    return {
      pet: normalizePetSummaryColors(withPreviewRevisit({
        ...pet,
        isMine: Boolean(owned),
        ownerPhotoAvailable: Boolean(owned && hasPetPhoto(owned)),
        ownerPinned: Boolean(owned),
        approvalStatus: pet.approvalStatus ?? 'approved',
        shareable: true,
      }, revisit)),
      allowance,
    };
  }
  const result = await invokePetApi<SharedPetResult>({ action: 'shared', petId }, 12_000, signal);
  return { ...result, pet: normalizePetSummaryColors(result.pet) };
}

export async function fetchMyPets(signal?: AbortSignal): Promise<OwnedPetSummary[]> {
  if (signal?.aborted) throw new PetApiError('이전 요청을 취소했어요.', 'REQUEST_CANCELLED', 'definite');
  if (isPreviewRuntime) {
    const now = new Date();
    const scenario = getPreviewScenario();
    const storage = getScenarioStorage(scenario);
    const allowance = applyScenarioAllowance(scenario, readAllowance(storage, now), now);
    const revisitRecords = readActivePreviewReveals(allowance.date, now, storage);
    const revisitByPetId = new Map(revisitRecords.map((record) => [record.petId, record]));
    const scenarioOwner = getScenarioOwnerPet(scenario);
    return (scenarioOwner ? [scenarioOwner] : readPreviewMyPets(storage)).map((pet) => normalizePetSummaryColors(
      withPreviewRevisit({ ...pet, ownerPhotoAvailable: hasPetPhoto(pet) }, revisitByPetId.get(pet.id)),
    ));
  }
  const data = await invokePetApi<{ pets: OwnedPetSummary[] }>({ action: 'mine' }, 12_000, signal);
  return data.pets.map(normalizePetSummaryColors);
}

export async function revealPet(pet: PetSummary, method: UnlockMethod, adSessionId?: string): Promise<RevealResult> {
  if (isPreviewRuntime) {
    const now = new Date();
    const scenario = getPreviewScenario();
    const storage = getScenarioStorage(scenario);
    const current = applyScenarioAllowance(scenario, readAllowance(storage, now), now);
    if (scenario === 'ads-off' && method === 'REWARDED') {
      throw new Error('이 미리보기에서는 광고를 사용할 수 없어요.');
    }
    const viewerKey = await getUserHash();
    const photoUrl = selectPetPhotoUrl(pet, current.date, viewerKey);
    if (!photoUrl) throw new Error('이 친구의 사진을 불러오지 못했어요.');
    const allowance = consumeAllowance(current, method, now);
    const revisitUntil = allowance.nextChargeAt
      ?? new Date(now.getTime() + FREE_RECHARGE_INTERVAL_MS).toISOString();
    if (!revisitUntil) throw new Error('재열람 시간을 확인하지 못했어요. 다시 시도해 주세요.');
    saveAllowance(allowance, storage);
    markPreviewPetRevealed(pet.id, revisitUntil, current.date, storage);
    const dailyIds = orderDailyPets(getScenarioPublicPets(scenario) ?? SAMPLE_PETS, viewerKey, current.date)
      .slice(0, HOUSE_PET_LIMIT)
      .map((item) => item.id);
    const metIds = readPreviewMetPetIds(current.date, storage);
    const dailyMetIds = dailyIds.filter((petId) => metIds.has(petId));
    return {
      photoUrl,
      signedUrlExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      revisitUntil,
      allowance,
      dailyProgress: {
        date: current.date,
        metPetIds: dailyMetIds,
        metCount: dailyMetIds.length,
        totalCount: HOUSE_PET_LIMIT,
        completed: dailyMetIds.length >= HOUSE_PET_LIMIT,
      },
    };
  }
  return invokePetApi<RevealResult>({ action: 'reveal', apiVersion: 2, petId: pet.id, unlockMethod: method, adSessionId });
}

/** 충전 경계 전에 공개한 같은 사진을 이용권 차감 없이 다시 연다. */
export async function reopenPet(pet: PetSummary): Promise<RevealResult> {
  if (isPreviewRuntime) {
    const now = new Date();
    const scenario = getPreviewScenario();
    const storage = getScenarioStorage(scenario);
    const allowance = applyScenarioAllowance(scenario, readAllowance(storage, now), now);
    const completeRevisitUntil = getCompleteScenarioRevisitUntil(scenario, now);
    const revisit = completeRevisitUntil
      ? { petId: pet.id, photoDate: allowance.date, revisitUntil: completeRevisitUntil }
      : findActivePreviewReveal(pet.id, allowance.date, now, storage);
    if (!revisit) throw new Error('이용권이 충전되기 전에 만난 사진만 다시 볼 수 있어요.');
    const viewerKey = await getUserHash();
    const photoUrl = selectPetPhotoUrl(pet, revisit.photoDate, viewerKey);
    if (!photoUrl) throw new Error('이 친구의 사진을 불러오지 못했어요.');
    return {
      photoUrl,
      signedUrlExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      revisitUntil: revisit.revisitUntil,
      allowance,
      dailyProgress: (() => {
        const dailyIds = orderDailyPets(getScenarioPublicPets(scenario) ?? SAMPLE_PETS, viewerKey, allowance.date)
          .slice(0, HOUSE_PET_LIMIT)
          .map((item) => item.id);
        const metIds = readPreviewMetPetIds(allowance.date, storage);
        const dailyMetIds = completeRevisitUntil ? dailyIds : dailyIds.filter((petId) => metIds.has(petId));
        return {
          date: allowance.date,
          metPetIds: dailyMetIds,
          metCount: dailyMetIds.length,
          totalCount: HOUSE_PET_LIMIT,
          completed: dailyMetIds.length >= HOUSE_PET_LIMIT,
        };
      })(),
    };
  }
  return invokePetApi<RevealResult>({ action: 'reveal', apiVersion: 2, petId: pet.id, revisit: true });
}

/** 등록한 사용자만 이용권 차감 없이 pending/approved 원본을 연다. */
export async function openOwnerPhoto(pet: PetSummary): Promise<OwnerPhotoResult> {
  if (isPreviewRuntime) {
    if (!pet.isMine || !['pending', 'approved'].includes(pet.approvalStatus ?? 'approved')) {
      throw new Error('내가 소개한 강아지의 사진만 바로 볼 수 있어요.');
    }
    const now = new Date();
    const viewerKey = await getUserHash();
    const photoUrl = selectPetPhotoUrl(pet, getKstDate(now), viewerKey);
    if (!photoUrl) throw new Error('이 친구의 사진을 불러오지 못했어요.');
    return {
      photoUrl,
      signedUrlExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      ownerPhotoAvailable: true,
    };
  }
  return invokePetApi<OwnerPhotoResult>({ action: 'ownerPhoto', petId: pet.id });
}

export async function fetchSubmissionStatus(submissionId: string): Promise<SubmissionStatusResult> {
  if (isPreviewRuntime) {
    const existing = findPreviewSubmission(submissionId, getScenarioStorage(getPreviewScenario()));
    return existing ? { found: true, result: normalizeSubmitResultColors(existing) } : { found: false };
  }
  const status = await invokePetApi<SubmissionStatusResult>({ action: 'submissionStatus', submissionId }, 8_000);
  return status.found
    ? { found: true, result: normalizeSubmitResultColors(status.result) }
    : status;
}

export async function submitPet(input: SubmitPetInput): Promise<SubmitPetResult> {
  const style = normalizePetStyle(input.traits, input.style);
  const normalizedTraits = applyCoatMode(normalizePetTraitColors(input.traits), style.coatMode, input.traits);
  const normalizedInput = { ...input, traits: normalizedTraits, style };
  if (isPreviewRuntime) {
    const storage = getScenarioStorage(getPreviewScenario());
    const existing = findPreviewSubmission(normalizedInput.submissionId, storage);
    if (existing) return normalizeSubmitResultColors(existing);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const pet: PetSummary = {
      id: crypto.randomUUID(), name: normalizedInput.name, traits: normalizedInput.traits, photoUrl: normalizedInput.dataUri,
      isMine: true, ownerPhotoAvailable: true, ownerPinned: true, approvalStatus: 'pending', shareable: true,
      publishedAccessory: normalizedInput.accessorySelectionMode === 'owner' ? normalizedInput.requestedAccessory : undefined,
      publishedStyle: normalizedInput.style,
      designVersion: 1,
    };
    const current = readAllowance(storage);
    const rewardGranted = !current.uploadCredit;
    const result = { pet, rewardGranted, uploadRewardPetId: rewardGranted ? pet.id : undefined };
    savePreviewSubmission(normalizedInput.submissionId, result, storage);
    return result;
  }
  const result = await invokePetApi<SubmitPetResult>({ action: 'submit', ...normalizedInput });
  return normalizeSubmitResultColors(result);
}

export async function reportPet(petId: string, reason = 'inappropriate'): Promise<void> {
  if (isPreviewRuntime) return;
  await invokePetApi<{ reported: boolean }>({ action: 'report', petId, reason });
}
