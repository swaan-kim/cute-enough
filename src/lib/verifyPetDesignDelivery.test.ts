import { describe, expect, it } from 'vitest';
import { SAMPLE_PETS } from '../data/samplePets';
import { verifyPetDesignDelivery } from './verifyPetDesignDelivery';
import { canonicalPetDesign } from '../../supabase/functions/_shared/pet-design';

const pet = SAMPLE_PETS[0];
describe('app SVG delivery integrity', () => {
  it('verifies the same normalized document on home, owner bonus, mine, album, shared and recovery payloads', async () => {
    const payload = { pets: [pet], dailyPets: [pet], ownerBonusPet: { ...pet, isMine: true }, pet,
      found: true, result: { pet }, allowance: { remaining: 2 } };
    const result = await verifyPetDesignDelivery(payload);
    for (const item of [result.pet, result.ownerBonusPet, ...result.pets, ...result.dailyPets, result.result.pet]) {
      expect(item.publishedDesign?.sha256).toBe(pet.publishedDesign?.sha256);
      expect(canonicalPetDesign(item.publishedDesign?.document)).toBe(canonicalPetDesign(pet.publishedDesign?.document));
    }
    expect(result.allowance).toBe(payload.allowance);
  });

  it.each(['hash', 'geometry', 'schema', 'motion', 'version'])('isolates %s corruption without losing photos or a successful ticket charge', async (kind) => {
    const broken = structuredClone(pet);
    const design = broken.publishedDesign!;
    if (kind === 'hash') design.sha256 = '0'.repeat(64);
    if (kind === 'geometry') design.document.viewBox[2] += 1;
    if (kind === 'schema') Object.assign(design.document, { schemaVersion: 2 });
    if (kind === 'motion') Object.assign(design.document, { motionVersion: 2 });
    if (kind === 'version') broken.designVersion = design.designVersion + 1;
    const result = await verifyPetDesignDelivery({ pets: [broken, pet], pet: broken, photoUrl: '/already-granted.jpg', allowance: { remaining: 1 } });
    expect(result.pets[0]).toMatchObject({ designStatus: 'unavailable', publishedDesign: undefined });
    expect(result.pets[1].publishedDesign).toEqual(pet.publishedDesign);
    expect(result.photoUrl).toBe('/already-granted.jpg');
    expect(result.allowance.remaining).toBe(1);
  });

  it('drops private fields attached to the published envelope', async () => {
    const result = await verifyPetDesignDelivery({ pet: { ...pet, publishedDesign: { ...pet.publishedDesign!, editorState: { secret: 'draft' } } } });
    expect(result.pet.publishedDesign).not.toHaveProperty('editorState');
  });

  it.each(['pending', 'rejected', 'paused', 'deleted'])('does not expose a stale published document for %s', async (approvalStatus) => {
    const result = await verifyPetDesignDelivery({ pet: { ...pet, approvalStatus } });
    expect(result.pet.publishedDesign).toBeUndefined();
  });
});
