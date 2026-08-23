import { createClient } from '@supabase/supabase-js';
import { SAMPLE_PETS } from '../data/samplePets';
import type { HouseResult, OwnedPetSummary, PetSummary, PetTraitsV1, RevealResult, SharedPetResult, SubmitPetResult, UnlockMethod } from '../types';
import { consumeAllowance, readAllowance, saveAllowance } from './allowance';
import { isPreviewRuntime } from './runtime';
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

function shuffled<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

const PREVIEW_UPLOAD_KEY = 'cute-enough:preview-upload';
const PREVIEW_MY_PETS_KEY = 'cute-enough:preview-my-pets';

function readPreviewUpload(): PetSummary | undefined {
  try { return JSON.parse(localStorage.getItem(PREVIEW_UPLOAD_KEY) ?? 'null') as PetSummary | undefined; }
  catch { return undefined; }
}

function readPreviewMyPets(): OwnedPetSummary[] {
  try { return JSON.parse(localStorage.getItem(PREVIEW_MY_PETS_KEY) ?? '[]') as OwnedPetSummary[]; }
  catch { return []; }
}

export async function fetchHouse(): Promise<HouseResult> {
  if (isPreviewRuntime) {
    const allowance = readAllowance();
    const savedPet = readPreviewUpload();
    const rewardPet = allowance.uploadCredit && !allowance.uploadUsed && allowance.uploadRewardPetId === savedPet?.id ? savedPet : undefined;
    const pool: PetSummary[] = shuffled(SAMPLE_PETS).slice(0, rewardPet ? 4 : 5).map((pet) => ({ ...pet, approvalStatus: 'approved', shareable: true }));
    if (rewardPet) pool.splice(2, 0, rewardPet);
    return { pets: pool, allowance };
  }
  return invokePetApi<HouseResult>({ action: 'house' });
}

export async function fetchSharedPet(petId: string): Promise<SharedPetResult> {
  if (isPreviewRuntime) {
    const pet = SAMPLE_PETS.find((item) => item.id === petId) ?? readPreviewMyPets().find((item) => item.id === petId);
    if (!pet) throw new Error('이 친구는 지금 만날 수 없어요.');
    return { pet: { ...pet, approvalStatus: pet.approvalStatus ?? 'approved', shareable: true }, allowance: readAllowance() };
  }
  return invokePetApi<SharedPetResult>({ action: 'shared', petId });
}

export async function fetchMyPets(): Promise<OwnedPetSummary[]> {
  if (isPreviewRuntime) return readPreviewMyPets();
  const data = await invokePetApi<{ pets: OwnedPetSummary[] }>({ action: 'mine' });
  return data.pets;
}

export async function revealPet(pet: PetSummary, method: UnlockMethod, adSessionId?: string): Promise<RevealResult> {
  if (isPreviewRuntime) {
    const allowance = consumeAllowance(readAllowance(), method);
    saveAllowance(allowance);
    if (method === 'UPLOAD') localStorage.removeItem(PREVIEW_UPLOAD_KEY);
    return { photoUrl: pet.photoUrl!, signedUrlExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), allowance };
  }
  return invokePetApi<RevealResult>({ action: 'reveal', petId: pet.id, unlockMethod: method, adSessionId });
}

export async function submitPet(input: { dataUri: string; name?: string; traits: PetTraitsV1 }): Promise<SubmitPetResult> {
  if (isPreviewRuntime) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const pet: PetSummary = {
      id: crypto.randomUUID(), name: input.name, traits: input.traits, photoUrl: input.dataUri,
      ownerPinned: true, approvalStatus: 'pending', shareable: true,
    };
    const current = readAllowance();
    const rewardGranted = !current.uploadCredit;
    if (rewardGranted) localStorage.setItem(PREVIEW_UPLOAD_KEY, JSON.stringify(pet));
    const mine: OwnedPetSummary = { ...pet, approvalStatus: 'pending', createdAt: new Date().toISOString() };
    localStorage.setItem(PREVIEW_MY_PETS_KEY, JSON.stringify([mine, ...readPreviewMyPets()]));
    return { pet, rewardGranted, uploadRewardPetId: rewardGranted ? pet.id : undefined };
  }
  return invokePetApi<SubmitPetResult>({ action: 'submit', ...input });
}

export async function reportPet(petId: string, reason = 'inappropriate'): Promise<void> {
  if (isPreviewRuntime) return;
  await invokePetApi<{ reported: boolean }>({ action: 'report', petId, reason });
}
