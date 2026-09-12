import { beforeAll, describe, expect, it, vi } from 'vitest';
import { withPublishedDesign, assertLegacyDesignCompatible } from './published-design';
import { hashPetDesign, validatePetDesign } from './pet-design';
import { rejectCreatorDesignFields, requireAccessorySubmission } from './validation';
import { refreshDesign } from '../pet-api/design-api';

const id = '11111111-1111-4111-8111-111111111111';
const designId = '22222222-2222-4222-8222-222222222222';
const document = validatePetDesign({ schemaVersion: 1, motionVersion: 1, viewBox: [0,0,180,156], nodes: [
  { tag: 'g', motion: 'tongue', children: [{ tag: 'path', attrs: { d: 'M0 0L2 4', fill: '#fff', 'data-new-prop': 'triangle-cheese' } }] },
] });
let sha256: string;
beforeAll(async () => { sha256 = await hashPetDesign(document); });

function fixture(options: { pets?: unknown[]; versions?: unknown[]; petError?: boolean; versionError?: boolean } = {}) {
  const pets = { in: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({
    data: options.pets ?? [{ id, design_version: 3, published_design_id: designId }], error: options.petError,
  }) };
  const versions = { in: vi.fn().mockResolvedValue({ data: options.versions ?? [{ id: designId, pet_id: id, design_version: 3, sha256, document,
    editor_state: { secret: true }, created_by: 'operator-private' }], error: options.versionError }) };
  const selectPet = vi.fn(() => pets);
  const selectVersion = vi.fn(() => versions);
  const client = { from: vi.fn((table: string) => ({ select: table === 'pets' ? selectPet : selectVersion })) };
  return { client: client as unknown as Parameters<typeof withPublishedDesign>[0], pets, versions, selectPet, selectVersion };
}

describe('portable published design API', () => {
  it('requires old clients to restart only when their response contains a converted approved dog',async()=>{
    const converted=fixture();
    await expect(assertLegacyDesignCompatible(converted.client,{dailyPets:[{id}]})).rejects.toMatchObject({code:'CLIENT_RESTART_REQUIRED',status:426});
    const historical=fixture({pets:[{id,published_design_id:null}]});
    await expect(assertLegacyDesignCompatible(historical.client,{pet:{id}})).resolves.toBeUndefined();
    await expect(assertLegacyDesignCompatible(converted.client,{pet:{id,approvalStatus:'pending'}})).resolves.toBeUndefined();
    const failed=fixture({petError:true});
    await expect(assertLegacyDesignCompatible(failed.client,{pet:{id}})).rejects.toMatchObject({code:'PET_DESIGN_UNAVAILABLE'});
  });
  it('delivers exactly the same current document/hash across cached house, shared, mine and album summaries', async () => {
    const { client, pets, selectVersion } = fixture();
    const pet = { id, designVersion: 1, name: '치즈', traits: { unchanged: true }, illustrationUrl: 'old.png', reviewedArtwork: { path: 'private' } };
    const result = await withPublishedDesign(client, { pet, pets: [pet], dailyPets: [pet], ownerBonusPet: pet, allowance: { remaining: 2 } }) as Record<string, any>;
    const expected = { id, name: '치즈', traits: { unchanged: true }, designVersion: 3, designStatus: 'ready', publishedDesign: { id: designId, designVersion: 3, sha256, document } };
    expect(result.pet).toEqual(expected); expect(result.pets).toEqual([expected]); expect(result.dailyPets).toEqual([expected]); expect(result.ownerBonusPet).toEqual(expected);
    expect(result.allowance).toEqual({ remaining: 2 });
    expect(pets.in).toHaveBeenCalledWith('id', [id]);
    expect(selectVersion).toHaveBeenCalledWith('id,pet_id,design_version,sha256,document');
    expect(JSON.stringify(result)).not.toMatch(/secret|operator-private|private|old.png/);
  });

  it('marks historical missing designs explicitly while preserving pending upload previews', async () => {
    const { client, selectVersion } = fixture({ pets: [{ id, design_version: 2, published_design_id: null }] });
    const pending = { id: designId, approvalStatus: 'pending' };
    expect(await withPublishedDesign(client, { pets: [{ id }, pending] })).toEqual({ pets: [{ id, designStatus: 'missing', publishedDesign: undefined }, pending] });
    expect(selectVersion).not.toHaveBeenCalled();
  });

  it('delivers the approved document when submission recovery nests the pet under result', async () => {
    const { client, pets } = fixture();
    const pet = { id, approvalStatus: 'approved', designVersion: 1, illustrationUrl: 'old.png' };
    const payload = { found: true, result: { pet, rewardGranted: true, uploadRewardPetId: id } };
    const result = await withPublishedDesign(client, payload);
    expect(result).toEqual({ found: true, result: {
      pet: { id, approvalStatus: 'approved', designVersion: 3, designStatus: 'ready',
        publishedDesign: { id: designId, designVersion: 3, sha256, document } },
      rewardGranted: true, uploadRewardPetId: id,
    } });
    expect(pets.in).toHaveBeenCalledWith('id', [id]);
    expect(payload.result.pet).toBe(pet);
    expect(pet.designVersion).toBe(1);
  });

  it('guards nested submission recovery for legacy clients and leaves pending submissions private', async () => {
    const converted = fixture();
    await expect(assertLegacyDesignCompatible(converted.client, {
      found: true, result: { pet: { id, approvalStatus: 'approved' } },
    })).rejects.toMatchObject({ code: 'CLIENT_RESTART_REQUIRED', status: 426 });
    const historical = fixture({ pets: [{ id, published_design_id: null }] });
    await expect(assertLegacyDesignCompatible(historical.client, {
      found: true, result: { pet: { id, approvalStatus: 'approved' } },
    })).resolves.toBeUndefined();

    for (const status of [{ approvalStatus: 'pending' }, { status: 'pending' }]) {
      const pending = fixture();
      const payload = { found: true, result: { pet: { id, ...status }, rewardGranted: false } };
      await expect(assertLegacyDesignCompatible(pending.client, payload)).resolves.toBeUndefined();
      expect(await withPublishedDesign(pending.client, payload)).toBe(payload);
      expect(pending.client.from).not.toHaveBeenCalled();

      // A separate approved summary with the same ID must not decorate a pending recovery result.
      const mixed = await withPublishedDesign(converted.client, { ...payload, pet: { id, approvalStatus: 'approved' } }) as typeof payload;
      expect(mixed.result.pet).toBe(payload.result.pet);
      expect(mixed.result.pet).not.toHaveProperty('publishedDesign');
    }
  });

  it('marks failed nested submission delivery retryable without changing recovery or reward fields', async () => {
    const { client } = fixture({ versionError: true });
    const payload = { found: true, result: { pet: { id, approvalStatus: 'approved' }, rewardGranted: false } };
    expect(await withPublishedDesign(client, payload)).toEqual({ found: true, result: {
      pet: { id, approvalStatus: 'approved', designStatus: 'unavailable', publishedDesign: undefined }, rewardGranted: false,
    } });
  });

  it('never regenerates a different dog or breaks allowance data when queries fail', async () => {
    for (const options of [{ petError: true }, { versionError: true }]) {
      const { client } = fixture(options);
      expect(await withPublishedDesign(client, { pet: { id, publishedDesign: { stale: true } }, remaining: 1 })).toEqual({
        pet: { id, designStatus: 'unavailable', publishedDesign: undefined }, remaining: 1,
      });
    }
  });

  it('rejects corrupt hashes, unsupported documents, crossed dogs and stale versions', async () => {
    for (const override of [{ sha256: '0'.repeat(64) }, { document: { schemaVersion: 2 } }, { pet_id: designId }, { design_version: 2 }]) {
      const { client } = fixture({ versions: [{ id: designId, pet_id: id, design_version: 3, sha256, document, ...override }] });
      expect(await withPublishedDesign(client, { pet: { id } })).toMatchObject({ pet: { designStatus: 'unavailable' } });
    }
  });

  it('does no database work for non-character responses or a pending-only response', async () => {
    const { client } = fixture();
    const pending = { pets: [{ id, approvalStatus: 'pending' }] };
    expect(await withPublishedDesign(client, pending)).toBe(pending);
    expect(await withPublishedDesign(client, { ticket: 'unchanged' })).toEqual({ ticket: 'unchanged' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('refresh refuses unavailable dogs without exposing editor state or touching photo access', async () => {
    const query = { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) };
    const client = { from: vi.fn(() => ({ select: vi.fn(() => query) })) };
    await expect(refreshDesign(client as never, id)).rejects.toMatchObject({ code: 'PET_NOT_AVAILABLE' });
    expect(client.from).toHaveBeenCalledTimes(1); expect(query.eq).toHaveBeenCalledWith('status','approved');
  });

  it('rejects creator publication fields in public submission without adding owner accessory choices', () => {
    for (const key of ['publishedDesign','document','editorState','publishedAccessory','artwork','reviewed_artwork','published_design_id']) {
      expect(() => rejectCreatorDesignFields({ action: 'submit', [key]: {} })).toThrow('검수 디자인');
    }
    expect(() => rejectCreatorDesignFields({ action: 'submit', designFormat: 'svg-scene-v1', traits: {} })).not.toThrow();
    expect(() => requireAccessorySubmission('owner', { kind: 'triangle-cheese', color: 'yellow' })).toThrow();
  });
});
