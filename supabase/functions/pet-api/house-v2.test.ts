import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/pet-api/index.ts', 'utf8');
const houseBlock = source.slice(
  source.indexOf("if (action === 'house')"),
  source.indexOf("if (action === 'shared')"),
);
const revealBlock = source.slice(
  source.indexOf("if (action === 'reveal')"),
  source.indexOf("if (action === 'submit')", source.indexOf("if (action === 'reveal')")),
);

describe('pet API v2 house contract', () => {
  it('uses the additive snapshot only for explicit v2 callers', () => {
    expect(source).toContain('const apiVersion = body.apiVersion === 2 ? 2 : 1');
    expect(houseBlock).toContain('if (apiVersion === 2)');
    expect(houseBlock).toContain("rpc('get_pet_house_snapshot_v2'");
    expect(houseBlock).toContain("rpc('get_pet_house_snapshot'");
  });

  it('returns five public slots and the latest owner pet as separate fields', () => {
    expect(houseBlock).toContain('apiVersion: 2');
    expect(houseBlock).toContain('dailyPets');
    expect(houseBlock).toContain('ownerBonusPet');
    expect(houseBlock).toContain('dailyProgress: snapshot.dailyProgress');
    expect(houseBlock).toContain('houseSlot: slot');
  });

  it('does not let daily completion keep an expired revisit open', () => {
    expect(houseBlock).toContain('revealedToday: activeReveals.has(pet.id)');
    expect(houseBlock).not.toContain('revealedToday: metIds.has(pet.id)');
    expect(houseBlock).toContain('dailyProgress: snapshot.dailyProgress');
  });

  it('exposes rewarded usage, limit, and remaining allowance in v2', () => {
    expect(source).toContain('rewardedLimit: MAX_REWARDED_PER_DAY');
    expect(source).toContain('rewardedRemaining: Math.max(0, MAX_REWARDED_PER_DAY - rewardedUsed)');
    expect(houseBlock).toContain('allowancePayloadV2');
  });

  it('marks daily progress only after successful reveal or reopen flows', () => {
    expect(revealBlock).toContain('apiVersion === 2');
    expect(revealBlock).toContain('await markDailyHousePetMet(ownerHash, date, petId)');
    expect(revealBlock).toContain('...(dailyProgress ? { dailyProgress } : {})');
    expect(source.indexOf('createPetPhotoSignedUrl', source.indexOf("if (action === 'reveal')")))
      .toBeLessThan(source.indexOf('markDailyHousePetMet', source.indexOf("if (action === 'reveal')")));
  });

  it('records a new v2 reveal and its fixed-house progress in one RPC', () => {
    expect(revealBlock).toContain("apiVersion === 2\n        ? await supabase.rpc('record_pet_reveal_v3', recordArgs)");
    expect(revealBlock).toContain(": await supabase.rpc('record_pet_reveal_v2', recordArgs)");
    expect(revealBlock).toContain('const dailyProgress = apiVersion === 2 ? atomicResult?.dailyProgress : undefined');
  });

  it('rejects rewarded unlocks when a server-authoritative free ticket is available', () => {
    expect(revealBlock).toContain("unlockMethod === 'REWARDED' && freeAllowance.remaining > 0");
    expect(revealBlock).toContain("code: 'FREE_ALLOWANCE_AVAILABLE'");
    expect(revealBlock).toContain("recordError.message.includes('FREE_ALLOWANCE_AVAILABLE')");
  });
});
