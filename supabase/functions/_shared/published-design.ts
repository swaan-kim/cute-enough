import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { hashPetDesign, validatePetDesign } from './pet-design.ts';
import { ApiError } from './api-error.ts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const PET_DESIGN_FORMAT = 'svg-scene-v1';

function selectedPetIds(payload: unknown): string[] {
  if (!record(payload)) return [];
  const submissionResult = record(payload.result) ? payload.result : undefined;
  return [...new Set([payload.pet, payload.ownerBonusPet, submissionResult?.pet,
    ...(Array.isArray(payload.pets) ? payload.pets : []), ...(Array.isArray(payload.dailyPets) ? payload.dailyPets : []),
  ].filter(record).filter((pet) => pet.approvalStatus !== 'pending' && pet.status !== 'pending')
    .map((pet) => pet.id).filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))];
}

/** Staged rollout: an old client must never redraw a dog whose creator has confirmed SVG. */
export async function assertLegacyDesignCompatible(client: SupabaseClient, payload: unknown): Promise<void> {
  const ids = selectedPetIds(payload);
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await client.from('pets').select('id,published_design_id')
      .in('id', ids.slice(offset, offset + 100)).eq('status','approved');
    if (error) throw new ApiError('PET_DESIGN_UNAVAILABLE',503,'캐릭터를 불러오지 못했어요. 다시 시도해 주세요.');
    if ((data ?? []).some((pet) => pet.published_design_id)) {
      throw new ApiError('CLIENT_RESTART_REQUIRED',426,'새 강아지 디자인을 보려면 앱을 다시 열어 주세요.');
    }
  }
}

/** Only enrich summaries selected by the authenticated action; never fetch photos or editor state. */
export async function withPublishedDesign(client: SupabaseClient, payload: unknown): Promise<unknown> {
  if (!record(payload)) return payload;
  const ids = selectedPetIds(payload);
  if (!ids.length) return payload;
  const deliveries = new Map<string, RecordValue>();
  for (const id of ids) deliveries.set(id, { designStatus: 'unavailable', publishedDesign: undefined });
  for (let offset = 0; offset < ids.length; offset += 100) {
    try {
      // Always resolve the current pointer, including when a house assignment was cached before approval.
      const { data: pets, error } = await client.from('pets').select('id,status,design_version,published_design_id')
        .in('id', ids.slice(offset, offset + 100)).eq('status', 'approved');
      if (error) continue;
      const designIds = [...new Set((pets ?? []).map((pet) => pet.published_design_id).filter(Boolean))];
      for (const pet of pets ?? []) if (!pet.published_design_id) deliveries.set(pet.id, { designStatus: 'missing', publishedDesign: undefined });
      if (!designIds.length) continue;
      const { data: versions, error: versionError } = await client.from('pet_design_versions')
        .select('id,pet_id,design_version,sha256,document').in('id', designIds);
      if (versionError) continue;
      const byId = new Map((versions ?? []).map((version) => [version.id, version]));
      await Promise.all((pets ?? []).map(async (pet) => {
        const version = byId.get(pet.published_design_id);
        if (!version || version.pet_id !== pet.id || version.design_version !== pet.design_version) return;
        try {
          const document = validatePetDesign(version.document);
          if (await hashPetDesign(document) !== version.sha256) return;
          deliveries.set(pet.id, { designStatus: 'ready', designVersion: version.design_version, publishedDesign: {
            id: version.id, designVersion: version.design_version, sha256: version.sha256, document,
          } });
        } catch { /* Unsupported or corrupt versions stay retryable; never regenerate a different dog. */ }
      }));
    } catch { /* One failed query must not break tickets, photos, or healthy batches. */ }
  }
  const decorate = (pet: unknown) => {
    if (!record(pet) || pet.approvalStatus === 'pending' || pet.status === 'pending'
      || typeof pet.id !== 'string' || !deliveries.has(pet.id)) return pet;
    // SVG-aware clients must never accidentally take an old PNG branch.
    const { illustrationUrl: _url, illustrationStatus: _status, illustrationExpiresAt: _expires,
      reviewedArtwork: _artwork, ...summary } = pet;
    return { ...summary, ...deliveries.get(pet.id) };
  };
  return { ...payload,
    ...(payload.pet ? { pet: decorate(payload.pet) } : {}),
    ...(payload.ownerBonusPet ? { ownerBonusPet: decorate(payload.ownerBonusPet) } : {}),
    ...(Array.isArray(payload.pets) ? { pets: payload.pets.map(decorate) } : {}),
    ...(Array.isArray(payload.dailyPets) ? { dailyPets: payload.dailyPets.map(decorate) } : {}),
    ...(record(payload.result) && payload.result.pet
      ? { result: { ...payload.result, pet: decorate(payload.result.pet) } } : {}),
  };
}
