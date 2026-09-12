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
import type { AccessorySelectionMode, AlbumResult, FavoriteResult, HouseResult, OwnedPetSummary, OwnerPhotoResult, PetAccessory, PetStyleV1, PetSummary, PetTraitsV1, PhotoIntent, RevealResult, SharedPetResult, SubmissionStatusResult, SubmitPetResult, UnlockMethod } from '../types';
import { decoratePreviewAlbumPet, getPreviewAlbumPhoto, grantPreviewPhoto, previewAlbumEntries, previewPhotos, rememberPreviewPhotoRequest, selectPreviewPhoto, setPreviewFavorite } from './previewAlbum';
import { consumeAllowance, FREE_RECHARGE_INTERVAL_MS, getKstDate, readAllowance, saveAllowance } from './allowance';
import { HOUSE_PET_LIMIT, normalizeDailyProgress, orderDailyPets } from './housePets';
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
import { verifyPetDesignDelivery } from './verifyPetDesignDelivery';
import { getPetNameError, sanitizePetName } from './petName';
import { getSubmissionPhotos } from './submissionPhotos';
import type { PreparedPhoto } from './photoPreparation';
import { forgetSubmissionPhotos, uploadSubmissionPhotos } from './submissionPhotoUpload';
import type { DailyAllowance, RewardStatus, RewardSessionResult, ShareCloseSummary, ShareRewardResult } from '../types';

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
  readonly allowance?: DailyAllowance;
  readonly nextChargeAt?: string;
  readonly serverNow?: string;
  readonly retryAfter?: number;
  constructor(
    message: string,
    public readonly code: string,
    public readonly outcome: PetApiErrorOutcome,
    public readonly status?: number,
    details: { allowance?: DailyAllowance; nextChargeAt?: string; serverNow?: string; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = 'PetApiError';
    Object.assign(this, details);
  }
}

export type SubmitPetInput = {
  submissionId: string;
  name: string;
  traits: PetTraitsV1;
  style: PetStyleV1;
  accessorySelectionMode: AccessorySelectionMode;
  requestedAccessory?: PetAccessory;
} & ({ dataUris: string[]; dataUri?: string } | { dataUri: string; dataUris?: undefined });

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
      const payload = await context.json() as { error?: string; code?: string; allowance?: DailyAllowance; nextChargeAt?: string; serverNow?: string; retryAfter?: number };
      if (payload.error) return new PetApiError(
        payload.error,
        payload.code ?? 'FUNCTION_ERROR',
        context.status >= 500 && (!payload.code || ['INTERNAL_ERROR', 'REWARD_UNAVAILABLE'].includes(payload.code)) ? 'unknown' : 'definite',
        context.status,
        { allowance: payload.allowance, nextChargeAt: payload.nextChargeAt, serverNow: payload.serverNow, retryAfter: payload.retryAfter },
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

let pendingIdentity: Promise<string> | undefined;

function getRequestIdentity(signal: AbortSignal): Promise<string> {
  if (!pendingIdentity) {
    const attempt = getUserHash().finally(() => { if (pendingIdentity === attempt) pendingIdentity = undefined; });
    pendingIdentity = attempt;
  }
  const identity = pendingIdentity;
  return new Promise((resolve, reject) => {
    const abort = () => {
      if (pendingIdentity === identity) pendingIdentity = undefined;
      reject(new DOMException('사용자 확인 시간이 지났어요.', 'TimeoutError'));
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    identity.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function invokePetApi<T>(body: Record<string, unknown>, timeoutMs = 12_000, externalSignal?: AbortSignal): Promise<T> {
  const client = requireFunctions();
  if (externalSignal?.aborted) {
    throw new PetApiError('이전 요청을 취소했어요.', 'REQUEST_CANCELLED', 'definite');
  }
  try {
    const signal = requestSignal(timeoutMs, externalSignal);
    const userHash = await getRequestIdentity(signal);
    const { data, error } = await client.invoke('pet-api', {
      body: { ...body, userHash, designFormat: 'svg-scene-v1' },
      signal,
    });
    if (error) throw await toPetApiError(error);
    const verified = await verifyPetDesignDelivery(data);
    if (signal.aborted) throw new DOMException('이전 요청을 취소했어요.', 'AbortError');
    return verified as T;
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

/** Reload only the published vector design; never reveal a photo or spend a ticket. */
export async function fetchPetDesign(petId: string): Promise<import('../types').PetDesignDelivery & { id?: string; designVersion?: number }> {
  const result = await invokePetApi<{ pet: import('../types').PetDesignDelivery & { id?: string; designVersion?: number } }>({ action: 'design', petId });
  return result.pet;
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
    const albumPets = dailyPets.map((pet) => decoratePreviewAlbumPet(pet, storage, true));
    return { pets: albumPets, dailyPets: albumPets, ownerBonusPet, allowance, dailyProgress };
  }
  const result = await invokePetApi<HouseResult>({ action: 'house', apiVersion: 2, albumVersion: 2 }, 12_000, signal);
  const dailyPets = (result.dailyPets ?? result.pets ?? [])
    .map(normalizePetSummaryColors)
    .filter(hasPetPhoto)
    .slice(0, HOUSE_PET_LIMIT);
  const ownerBonusPet = result.ownerBonusPet
    ? normalizePetSummaryColors(result.ownerBonusPet)
    : undefined;
  const dailyProgress = normalizeDailyProgress(
    result.dailyProgress,
    dailyPets,
    result.allowance?.date ?? getKstDate(),
  );
  return { ...result, pets: dailyPets, dailyPets, ownerBonusPet, dailyProgress };
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
    const isInTodayHouse = (await fetchHouse()).pets.some((item) => item.id === petId);
    return {
      pet: decoratePreviewAlbumPet(normalizePetSummaryColors(withPreviewRevisit({
        ...pet,
        isMine: Boolean(owned),
        ownerPhotoAvailable: Boolean(owned && hasPetPhoto(owned)),
        ownerPinned: Boolean(owned),
        approvalStatus: pet.approvalStatus ?? 'approved',
        shareable: true,
      }, revisit)), storage, isInTodayHouse),
      allowance,
    };
  }
  const result = await invokePetApi<SharedPetResult>({ action: 'shared', apiVersion: 2, albumVersion: 2, petId }, 12_000, signal);
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
  const data = await invokePetApi<{ pets: OwnedPetSummary[] }>({ action: 'mine', albumVersion: 2 }, 12_000, signal);
  return data.pets.map(normalizePetSummaryColors);
}

export async function revealPet(pet: PetSummary, method: UnlockMethod, adSessionId?: string, requestId?: string, photoIntent: PhotoIntent = 'collect'): Promise<RevealResult> {
  const logicalRequestId = requestId ?? crypto.randomUUID();
  if (isPreviewRuntime) {
    const now = new Date();
    const scenario = getPreviewScenario();
    const storage = getScenarioStorage(scenario);
    const viewerKey = await getUserHash();
    const house = await fetchHouse();
    const current = applyScenarioAllowance(scenario, readAllowance(storage, now), now);
    if (pet.isMine) return { ...await openOwnerPhoto(pet), allowance: current, dailyProgress: house.dailyProgress };
    const isInTodayHouse = house.pets.some((item) => item.id === pet.id);
    const { photo, needsTicket } = selectPreviewPhoto(pet, photoIntent, storage, isInTodayHouse, logicalRequestId);
    if (!needsTicket) {
      rememberPreviewPhotoRequest(pet, photo.photoId, photoIntent, logicalRequestId, storage);
      return openAlbumPhoto(photo.photoId, pet);
    }
    if (scenario === 'ads-off' && method === 'REWARDED') {
      throw new Error('이 미리보기에서는 광고를 사용할 수 없어요.');
    }
    const allowance = consumeAllowance(current, method, now);
    const revisitUntil = allowance.nextChargeAt
      ?? new Date(now.getTime() + FREE_RECHARGE_INTERVAL_MS).toISOString();
    if (!revisitUntil) throw new Error('재열람 시간을 확인하지 못했어요. 다시 시도해 주세요.');
    saveAllowance(allowance, storage);
    grantPreviewPhoto(pet, photo.photoId, storage, logicalRequestId);
    markPreviewPetRevealed(pet.id, revisitUntil, current.date, storage);
    const dailyIds = orderDailyPets(getScenarioPublicPets(scenario) ?? SAMPLE_PETS, viewerKey, current.date)
      .slice(0, HOUSE_PET_LIMIT)
      .map((item) => item.id);
    const metIds = readPreviewMetPetIds(current.date, storage);
    const dailyMetIds = dailyIds.filter((petId) => metIds.has(petId));
    return {
      photoUrl: photo.url,
      photoId: photo.photoId,
      photoCaption: photo.photoCaption,
      ...albumPhotoMetadata(decoratePreviewAlbumPet(pet, storage, isInTodayHouse)),
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
  return invokePetApi<RevealResult>({ action: 'reveal', apiVersion: 2, albumVersion: 2, petId: pet.id, unlockMethod: method, adSessionId, requestId: logicalRequestId, photoIntent });
}

/** Read-only preparation: never call reveal/ownerPhoto here to warm an image. */
export async function preparePetPhoto(pet: PetSummary, requestId: string, accessKind: 'owner' | 'replay', signal?: AbortSignal): Promise<PreparedPhoto> {
  if (!isPreviewRuntime) return invokePetApi<PreparedPhoto>({ action: 'photoPrepare', apiVersion: 2, albumVersion: 2, petId: pet.id, requestId, accessKind }, 8_000, signal);
  if (signal?.aborted) throw new DOMException('사진 준비를 취소했어요.', 'AbortError');
  const storage = getScenarioStorage(getPreviewScenario());
  const allowedOwner = accessKind === 'owner' && pet.isMine && ['pending', 'approved'].includes(pet.approvalStatus ?? 'approved');
  const existing = accessKind === 'replay' && pet.approvalStatus !== 'pending'
    ? previewAlbumEntries([pet], storage, new Set(), false)[0]?.albumPhotoId : undefined;
  const photos = previewPhotos(pet);
  const photo = allowedOwner ? photos[0] : photos.find((item) => item.photoId === existing);
  if (!photo || (!allowedOwner && (!existing || ['rejected', 'paused', 'deleted'].includes(pet.approvalStatus ?? '')))) throw new Error('이미 볼 수 있는 사진만 준비할 수 있어요.');
  return { petId: pet.id, photoId: photo.photoId, photoUrl: photo.url, photoCaption: photo.photoCaption, signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString() };
}

export async function fetchRewardStatus(): Promise<RewardStatus> {
  if (isPreviewRuntime) return {
    allowance: readAllowance(getScenarioStorage(getPreviewScenario())),
    capabilities: { ads: false, share: false }, adCredits: [], serverNow: new Date().toISOString(),
  };
  return invokePetApi<RewardStatus>({ action: 'rewardStatus', apiVersion: 2, albumVersion: 2 });
}

export function startAdReward(petId: string, requestId: string): Promise<RewardSessionResult> {
  return invokePetApi({ action: 'rewardStart', apiVersion: 2, albumVersion: 2, petId, requestId });
}
export function completeAdReward(sessionId: string): Promise<RewardStatus> {
  return invokePetApi({ action: 'rewardComplete', apiVersion: 2, albumVersion: 2, sessionId });
}
export function cancelAdReward(sessionId: string): Promise<RewardStatus> {
  return invokePetApi({ action: 'rewardCancel', apiVersion: 2, albumVersion: 2, sessionId });
}
export function rebindAdReward(sessionId: string, petId: string): Promise<RewardStatus> {
  return invokePetApi({ action: 'rewardRebind', apiVersion: 2, albumVersion: 2, sessionId, petId });
}
export function startShareReward(requestId: string): Promise<RewardSessionResult> {
  return invokePetApi({ action: 'shareStart', apiVersion: 2, albumVersion: 2, requestId });
}
export function recordShareReward(sessionId: string, requestId: string, rewardAmount: number, eventSequence: number): Promise<ShareRewardResult> {
  return invokePetApi({ action: 'shareReward', apiVersion: 2, albumVersion: 2, sessionId, requestId, rewardAmount, eventSequence });
}
export function closeShareReward(sessionId: string, requestId: string, summary: ShareCloseSummary | null): Promise<ShareRewardResult> {
  return invokePetApi({ action: 'shareClose', apiVersion: 2, albumVersion: 2, sessionId, requestId, summary,
    ...(summary === null ? { abandoned: true } : {}) });
}

export interface RechargeNotificationSettings { enabled: boolean; available: boolean; templateCode?: string }
export async function fetchRechargeNotificationSettings(): Promise<RechargeNotificationSettings> {
  if (isPreviewRuntime) return { enabled: false, available: false };
  return invokePetApi({ action: 'notificationSettings', apiVersion: 2 });
}
export function setRechargeNotificationSettings(enabled: boolean, tossAgreementGranted = false): Promise<RechargeNotificationSettings> {
  return invokePetApi({ action: 'setNotificationSettings', apiVersion: 2, enabled, tossAgreementGranted });
}

/** 이미 모은 사진의 정확한 ID를 티켓 차감 없이 다시 연다. */
export async function reopenPet(pet: PetSummary): Promise<RevealResult> {
  if (pet.albumPhotoId) return openAlbumPhoto(pet.albumPhotoId, pet);
  if (isPreviewRuntime) {
    const now = new Date();
    const scenario = getPreviewScenario();
    const storage = getScenarioStorage(scenario);
    const allowance = applyScenarioAllowance(scenario, readAllowance(storage, now), now);
    const albumPet = decoratePreviewAlbumPet(pet, storage);
    if (albumPet.albumPhotoId) return openAlbumPhoto(albumPet.albumPhotoId, pet);
    const completeRevisitUntil = getCompleteScenarioRevisitUntil(scenario, now);
    const revisit = completeRevisitUntil
      ? { petId: pet.id, photoDate: allowance.date, revisitUntil: completeRevisitUntil }
      : findActivePreviewReveal(pet.id, allowance.date, now, storage);
    if (!revisit) throw new Error('아직 만나지 않은 사진이에요.');
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
  return invokePetApi<RevealResult>({ action: 'reveal', apiVersion: 2, albumVersion: 2, petId: pet.id, revisit: true, photoIntent: 'replay', requestId: crypto.randomUUID() });
}

/** 등록한 사용자만 티켓 차감 없이 pending/approved 원본을 연다. */
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
      photoId: previewPhotos(pet).find((photo) => photo.url === photoUrl)?.photoId,
      photoCaption: undefined,
      signedUrlExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      ownerPhotoAvailable: true,
    };
  }
  return invokePetApi<OwnerPhotoResult>({ action: 'ownerPhoto', albumVersion: 2, petId: pet.id });
}

export function albumPhotoMetadata(pet: Pick<PetSummary, 'isFavorite' | 'unlockedPhotoCount' | 'hasUnseenPhotos' | 'albumPhotoId' | 'collection'>) {
  return { isFavorite: pet.isFavorite, unlockedPhotoCount: pet.unlockedPhotoCount, hasUnseenPhotos: pet.hasUnseenPhotos, albumPhotoId: pet.albumPhotoId, collection: pet.collection };
}

export async function fetchAlbum(favoritesOnly = false, cursor?: string, signal?: AbortSignal): Promise<AlbumResult> {
  if (!isPreviewRuntime) return invokePetApi({ action: 'album', apiVersion: 2, albumVersion: 2, favoritesOnly, cursor, limit: 20 }, 12_000, signal);
  const scenario = getPreviewScenario();
  const house = await fetchHouse();
  const all = previewAlbumEntries(getScenarioPublicPets(scenario) ?? SAMPLE_PETS, getScenarioStorage(scenario), new Set(house.pets.map((pet) => pet.id)));
  const filtered = favoritesOnly ? all.filter((pet) => pet.isFavorite) : all;
  const start = cursor ? Number(cursor) : 0;
  return { pets: filtered.slice(start, start + 20), nextCursor: filtered.length > start + 20 ? String(start + 20) : undefined,
    legacyGiftCount: all.flatMap((pet) => pet.unlockedPhotos).filter((photo) => photo.source === 'legacy_gift').length };
}

export async function openAlbumPhoto(photoId: string, previewPet?: PetSummary): Promise<RevealResult> {
  if (!isPreviewRuntime) return invokePetApi({ action: 'albumPhoto', apiVersion: 2, albumVersion: 2, photoId });
  const scenario = getPreviewScenario();
  const storage = getScenarioStorage(scenario);
  const pet = previewPet ?? (getScenarioPublicPets(scenario) ?? SAMPLE_PETS).find((item) => previewPhotos(item).some((photo) => photo.photoId === photoId));
  if (!pet) throw new Error('이 친구의 사진을 찾지 못했어요.');
  const { photo } = getPreviewAlbumPhoto(pet, photoId, storage);
  const current = applyScenarioAllowance(scenario, readAllowance(storage), new Date());
  markPreviewPetRevealed(pet.id, new Date(Date.now() + FREE_RECHARGE_INTERVAL_MS).toISOString(), current.date, storage);
  const house = await fetchHouse();
  return { photoId, photoUrl: photo.url, photoCaption: photo.photoCaption, signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    allowance: current, dailyProgress: house.dailyProgress,
    ...albumPhotoMetadata(decoratePreviewAlbumPet(pet, storage, house.pets.some((item) => item.id === pet.id))) };
}

export async function setPetFavorite(pet: PetSummary, isFavorite: boolean): Promise<FavoriteResult> {
  if (!isPreviewRuntime) return invokePetApi({ action: 'setFavorite', apiVersion: 2, albumVersion: 2, petId: pet.id, isFavorite });
  return setPreviewFavorite(pet, isFavorite, getScenarioStorage(getPreviewScenario()));
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
    const nameError = getPetNameError(normalizedInput.name ?? '');
    if (nameError) throw new PetApiError(nameError, 'INVALID_PET_NAME', 'definite', 400);
    normalizedInput.name = sanitizePetName(normalizedInput.name);
    let photos: string[];
    try { photos = getSubmissionPhotos(normalizedInput); }
    catch (error) { throw new PetApiError(error instanceof Error ? error.message : '사진을 다시 확인해 주세요.', 'INVALID_SUBMISSION_PHOTOS', 'definite', 400); }
    await new Promise((resolve) => setTimeout(resolve, 600));
    // A repeated click during preview processing still represents one dog.
    const committed = findPreviewSubmission(normalizedInput.submissionId, storage);
    if (committed) return normalizeSubmitResultColors(committed);
    const pet: PetSummary = {
      id: crypto.randomUUID(), name: normalizedInput.name, traits: normalizedInput.traits, photoUrl: photos[0], photoUrls: photos,
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
  const payload: Record<string, unknown> = { action: 'submit', ...normalizedInput };
  if (normalizedInput.dataUris !== undefined) {
    const nameError = getPetNameError(normalizedInput.name ?? '');
    if (nameError) throw new PetApiError(nameError, 'INVALID_PET_NAME', 'definite', 400);
    let photos: string[];
    try { photos = getSubmissionPhotos(normalizedInput); }
    catch (error) { throw new PetApiError(error instanceof Error ? error.message : '사진을 다시 확인해 주세요.', 'INVALID_SUBMISSION_PHOTOS', 'definite', 400); }
    payload.name = sanitizePetName(normalizedInput.name);
    try {
      payload.photoReceipts = await uploadSubmissionPhotos(normalizedInput.submissionId, photos,
        (photo) => invokePetApi<{ photoReceipt: string }>(photo, 45_000));
    } catch (error) {
      if (error instanceof PetApiError && error.code === 'SUBMISSION_ALREADY_REGISTERED') {
        try {
          const status = await fetchSubmissionStatus(input.submissionId);
          if (status.found) { forgetSubmissionPhotos(input.submissionId); return status.result; }
        } catch { /* A known commit must remain recoverable, not start another dog. */ }
        throw new PetApiError('등록 결과를 아직 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.', 'SUBMISSION_RESULT_PENDING', 'unknown');
      }
      throw error;
    }
    delete payload.dataUri;
    delete payload.dataUris;
  }
  try {
    const result = await invokePetApi<SubmitPetResult>(payload, 45_000);
    forgetSubmissionPhotos(input.submissionId);
    return normalizeSubmitResultColors(result);
  } catch (error) {
    if (error instanceof PetApiError && ['INVALID_PHOTO_RECEIPT', 'PHOTO_RECEIPT_EXPIRED', 'PET_PHOTO_MISSING'].includes(error.code)) {
      // A new attempt must stage fresh files instead of replaying a broken receipt.
      forgetSubmissionPhotos(input.submissionId);
    }
    throw error;
  }
}

export async function reportPet(petId: string, reason = 'inappropriate'): Promise<void> {
  if (isPreviewRuntime) return;
  await invokePetApi<{ reported: boolean }>({ action: 'report', petId, reason });
}
