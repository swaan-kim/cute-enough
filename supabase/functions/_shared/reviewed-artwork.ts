import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const ARTWORK_URL_TTL_SECONDS = 6 * 60 * 60;

/** Enrich only pet summaries that the authorized action has already selected. */
export async function withReviewedArtwork(client: SupabaseClient, payload: unknown): Promise<unknown> {
  if (!record(payload)) return payload;
  const candidates = [payload.pet, payload.ownerBonusPet,
    ...(Array.isArray(payload.pets) ? payload.pets : []),
    ...(Array.isArray(payload.dailyPets) ? payload.dailyPets : []),
  ].filter(record).filter((pet) => pet.approvalStatus !== 'pending');
  const ids = [...new Set(candidates.map((pet) => pet.id).filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return payload;
  const deliveries = new Map<string, RecordValue>();
  const unavailable = { illustrationStatus: 'unavailable', illustrationUrl: undefined, illustrationExpiresAt: undefined };
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    try {
      const { data, error } = await client.from('pets').select('id,reviewed_artwork,design_version')
        .in('id', batch).eq('status', 'approved');
      if (error) throw error;
      for (const pet of data ?? []) deliveries.set(pet.id, { illustrationStatus: 'none' });
      const snapshots = (data ?? []).filter((pet) => typeof pet.reviewed_artwork?.path === 'string');
      if (!snapshots.length) continue;
      for (const pet of snapshots) {
        const saved = pet.reviewed_artwork;
        deliveries.set(pet.id, { ...unavailable, reviewedArtwork: {
          sha256: saved.sha256, width: saved.width, height: saved.height, designVersion: saved.designVersion,
        } });
      }
      // A failed image must not turn a successful house/photo/ticket response into a 503.
      const matching = snapshots.filter((pet) => pet.reviewed_artwork.designVersion === pet.design_version);
      if (!matching.length) continue;
      const { data: signed, error: signingError } = await client.storage.from('pet-artwork')
        .createSignedUrls(matching.map((pet) => pet.reviewed_artwork.path), ARTWORK_URL_TTL_SECONDS);
      if (signingError) continue;
      const byPath = new Map((signed ?? []).filter((item) => !item.error && item.signedUrl).map((item) => [item.path, item.signedUrl]));
      const expiresAt = new Date(Date.now() + ARTWORK_URL_TTL_SECONDS * 1000).toISOString();
      for (const pet of matching) {
        const url = byPath.get(pet.reviewed_artwork.path);
        if (url) deliveries.set(pet.id, { ...deliveries.get(pet.id), illustrationUrl: url,
          illustrationStatus: 'ready', illustrationExpiresAt: expiresAt, designVersion: pet.design_version });
      }
    } catch {
      // Unknown artwork is not permission to redraw a potentially custom dog.
      for (const id of batch) {
        if (deliveries.get(id)?.illustrationStatus !== 'none') {
          deliveries.set(id, { ...deliveries.get(id), ...unavailable });
        }
      }
    }
  }
  const decorate = (pet: unknown) => record(pet) && typeof pet.id === 'string' && deliveries.has(pet.id)
    ? { ...pet, ...deliveries.get(pet.id) } : pet;
  return { ...payload,
    ...(payload.pet ? { pet: decorate(payload.pet) } : {}),
    ...(payload.ownerBonusPet ? { ownerBonusPet: decorate(payload.ownerBonusPet) } : {}),
    ...(Array.isArray(payload.pets) ? { pets: payload.pets.map(decorate) } : {}),
    ...(Array.isArray(payload.dailyPets) ? { dailyPets: payload.dailyPets.map(decorate) } : {}),
  };
}
