import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/pet-api/index.ts', 'utf8');
const ownerPhotoBlock = source.slice(
  source.indexOf("if (action === 'ownerPhoto')"),
  source.indexOf("if (action === 'reveal')"),
);
const houseBlock = source.slice(
  source.indexOf("if (action === 'house')"),
  source.indexOf("if (action === 'shared')"),
);
const sharedBlock = source.slice(
  source.indexOf("if (action === 'shared')"),
  source.indexOf("if (action === 'mine')"),
);

describe('owner photo API boundary', () => {
  it('checks ownership, publishable status, and a real Storage-backed photo', () => {
    expect(ownerPhotoBlock).toContain('pet.owner_hash !== ownerHash');
    expect(ownerPhotoBlock).toContain('getExistingPetPhotos([petId])');
    expect(ownerPhotoBlock).toContain('canOpenOwnerPhoto');
    expect(ownerPhotoBlock).toContain('OWNER_PHOTO_FORBIDDEN');
  });

  it('returns only the owner photo without reading or consuming allowance state', () => {
    expect(ownerPhotoBlock).not.toContain('record_pet_reveal');
    expect(ownerPhotoBlock).not.toContain("unlockMethod: 'FREE'");
    expect(ownerPhotoBlock).not.toContain('allowancePayload');
    expect(ownerPhotoBlock).not.toContain("from('daily_reveals')");
    expect(ownerPhotoBlock).not.toContain("from('upload_rewards')");
    expect(ownerPhotoBlock).not.toContain('getFreeAllowance');
    expect(ownerPhotoBlock).toContain("from('daily_pet_views').upsert");
  });

  it('fills empty house slots with same-day approvals after stable candidates', () => {
    const stableCandidates = houseBlock.indexOf('orderDailyPets(candidateSummaries');
    const sameDayBackfill = houseBlock.indexOf('orderDailyPets(sameDayCandidateSummaries');
    expect(stableCandidates).toBeGreaterThan(-1);
    expect(sameDayBackfill).toBeGreaterThan(stableCandidates);
    expect(houseBlock).toContain('totalCount: pool.length');
  });

  it('uses the transactionally locked snapshot for the complete house state', () => {
    expect(houseBlock).toContain("rpc('get_pet_house_snapshot'");
    expect(houseBlock).not.toContain("from('daily_reveals')");
    expect(houseBlock).not.toContain("from('upload_rewards')");
  });

  it('uses the same locked snapshot for shared-link allowance and revisit state', () => {
    expect(sharedBlock).toContain("rpc('get_pet_house_snapshot'");
    expect(sharedBlock).not.toContain("from('daily_reveals')");
    expect(sharedBlock).not.toContain("from('upload_rewards')");
    expect(sharedBlock).not.toContain('getFreeAllowance');
  });
});
