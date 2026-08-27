import { createClient } from '@supabase/supabase-js';
import { SAMPLE_PETS } from '../data/samplePets';
import type { HouseResult, OwnedPetSummary, PetSummary, PetTraitsV1, RevealResult, SharedPetResult, SubmitPetResult, UnlockMethod } from '../types';
import { consumeAllowance, readAllowance, saveAllowance } from './allowance';
import { composeHousePets, orderDailyPets } from './housePets';
import { findPreviewSubmission, markPreviewPetRevealed, readPreviewMyPets, readPreviewRevealedPetIds, savePreviewSubmission } from './previewPetStore';
import { isPreviewRuntime } from './runtime';
import { hasPetPhoto, selectPetPhotoUrl } from './petPhoto';
import { normalizePetTraitColors } from './petTraits';
import { getUserHash } from './toss';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = !isPreviewRuntime && url && key ? createClient(url, key) : null;

function requireSupabase() {
  if (!supabase) throw new Error('운영 서버 연결이 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요.');
  return supabase;
}

async function throwFunctionError(error: unknown): Promise<never> {
  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: Response }).context
    : undefined;
  if (context && typeof context.json === 'function') {
    try {
      const payload = await context.json() as { error?: string; code?: string };
      if (payload.error) throw new Error(payload.error);
    } catch (contextError) {
      if (contextError instanceof Error && contextError.message !== 'Unexpected end of JSON input') throw contextError;
    }
  }
  throw new Error('서버와 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.');
}

async function invokePetApi<T>(body: Record<string, unknown>): Promise<T> {
  const client = requireSupabase();
  const userHash = await getUserHash();
  const { data, error } = await client.functions.invoke('pet-api', {
    body: { ...body, userHash },
    signal: AbortSignal.timeout(12_000),
  });
  if (error) return throwFunctionError(error);
  return data as T;
}

function normalizePetSummaryColors<T extends PetSummary>(pet: T): T {
  const traits = normalizePetTraitColors(pet.traits);
  return traits === pet.traits ? pet : { ...pet, traits };
}

function normalizeSubmitResultColors(result: SubmitPetResult): SubmitPetResult {
  const pet = normalizePetSummaryColors(result.pet);
  return pet === result.pet ? result : { ...result, pet };
}

export async function fetchHouse(): Promise<HouseResult> {
  if (isPreviewRuntime) {
    const allowance = readAllowance();
    const viewerKey = await getUserHash();
    const revealedIds = readPreviewRevealedPetIds(allowance.date);
    const mine = readPreviewMyPets().map((pet) => normalizePetSummaryColors({ ...pet, revealedToday: revealedIds.has(pet.id) }));
    const publicPets = orderDailyPets(SAMPLE_PETS, viewerKey, allowance.date).map((pet) => ({
      ...normalizePetSummaryColors(pet),
      approvalStatus: 'approved' as const,
      shareable: true,
      revealedToday: revealedIds.has(pet.id),
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
    const allowance = readAllowance();
    return {
      pet: normalizePetSummaryColors({
        ...pet,
        isMine: Boolean(owned),
        ownerPinned: Boolean(owned),
        approvalStatus: pet.approvalStatus ?? 'approved',
        shareable: true,
        revealedToday: readPreviewRevealedPetIds(allowance.date).has(pet.id),
      }),
      allowance,
    };
  }
  const result = await invokePetApi<SharedPetResult>({ action: 'shared', petId });
  return { ...result, pet: normalizePetSummaryColors(result.pet) };
}

export async function fetchMyPets(): Promise<OwnedPetSummary[]> {
  if (isPreviewRuntime) return readPreviewMyPets().map(normalizePetSummaryColors);
  const data = await invokePetApi<{ pets: OwnedPetSummary[] }>({ action: 'mine' });
  return data.pets.map(normalizePetSummaryColors);
}

export async function revealPet(pet: PetSummary, method: UnlockMethod, adSessionId?: string): Promise<RevealResult> {
  if (isPreviewRuntime) {
    const current = readAllowance();
    const viewerKey = await getUserHash();
    const photoUrl = selectPetPhotoUrl(pet, current.date, viewerKey);
    if (!photoUrl) throw new Error('이 친구의 사진을 불러오지 못했어요.');
    const allowance = consumeAllowance(current, method);
    saveAllowance(allowance);
    markPreviewPetRevealed(pet.id, allowance.date);
    return { photoUrl, signedUrlExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), allowance };
  }
  return invokePetApi<RevealResult>({ action: 'reveal', petId: pet.id, unlockMethod: method, adSessionId });
}

/** 오늘 이미 공개한 같은 사진을 이용권 차감 없이 다시 연다. */
export async function reopenPet(pet: PetSummary): Promise<RevealResult> {
  if (isPreviewRuntime) {
    const allowance = readAllowance();
    if (!readPreviewRevealedPetIds(allowance.date).has(pet.id)) {
      throw new Error('오늘 만난 사진만 다시 볼 수 있어요.');
    }
    const viewerKey = await getUserHash();
    const photoUrl = selectPetPhotoUrl(pet, allowance.date, viewerKey);
    if (!photoUrl) throw new Error('이 친구의 사진을 불러오지 못했어요.');
    return {
      photoUrl,
      signedUrlExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      allowance,
    };
  }
  return invokePetApi<RevealResult>({ action: 'reveal', petId: pet.id, revisit: true });
}

export async function submitPet(input: { submissionId: string; dataUri: string; name?: string; traits: PetTraitsV1 }): Promise<SubmitPetResult> {
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
