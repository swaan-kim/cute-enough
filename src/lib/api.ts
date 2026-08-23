import { createClient } from '@supabase/supabase-js';
import { SAMPLE_PETS } from '../data/samplePets';
import type { PetSummary, PetTraitsV1, RevealResult, UnlockMethod } from '../types';
import { consumeAllowance, readAllowance, saveAllowance } from './allowance';
import { getUserHash } from './toss';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = url && key ? createClient(url, key) : null;

function shuffled<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

export async function fetchHouse(): Promise<PetSummary[]> {
  if (!supabase) return shuffled(SAMPLE_PETS).slice(0, 5);
  const userHash = await getUserHash();
  const { data, error } = await supabase.functions.invoke('pet-api', { body: { action: 'house', userHash } });
  if (error) throw error;
  return data.pets as PetSummary[];
}

export async function revealPet(pet: PetSummary, method: UnlockMethod, adSessionId?: string): Promise<RevealResult> {
  if (!supabase) {
    const allowance = consumeAllowance(readAllowance(), method);
    saveAllowance(allowance);
    return { photoUrl: pet.photoUrl!, signedUrlExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), allowance };
  }
  const userHash = await getUserHash();
  const { data, error } = await supabase.functions.invoke('pet-api', {
    body: { action: 'reveal', userHash, petId: pet.id, unlockMethod: method, adSessionId },
  });
  if (error) throw error;
  return data as RevealResult;
}

export async function analyzePet(dataUri: string): Promise<{ traits: PetTraitsV1; analysisToken: string }> {
  if (!supabase) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'caramel', secondaryColor: 'cream', markingPattern: 'brow', muzzle: 'short', confidence: 0.87 },
      analysisToken: 'local-preview',
    };
  }
  const userHash = await getUserHash();
  const { data, error } = await supabase.functions.invoke('analyze-pet', { body: { userHash, dataUri } });
  if (error) throw error;
  return data as { traits: PetTraitsV1; analysisToken: string };
}

export async function submitPet(input: { dataUri: string; name?: string; traits: PetTraitsV1; analysisToken: string }): Promise<void> {
  if (!supabase) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return;
  }
  const userHash = await getUserHash();
  const { error } = await supabase.functions.invoke('pet-api', { body: { action: 'submit', userHash, ...input } });
  if (error) throw error;
}

export async function reportPet(petId: string, reason = 'inappropriate'): Promise<void> {
  if (!supabase) return;
  const userHash = await getUserHash();
  const { error } = await supabase.functions.invoke('pet-api', { body: { action: 'report', userHash, petId, reason } });
  if (error) throw error;
}
