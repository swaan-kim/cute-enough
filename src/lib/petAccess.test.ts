import { describe, expect, it } from 'vitest';
import type { DailyAllowance, PetSummary } from '../types';
import { isPetRevisitActive, resolvePetAccess } from './petAccess';

const allowance: DailyAllowance = {
  date: '2026-08-25', freeUsed: 0, rewardedUsed: 0,
  uploadCredit: true, uploadUsed: false, uploadRewardPetId: 'mine-pending',
};
const pet = (overrides: Partial<PetSummary>): PetSummary => ({
  id: 'pet',
  traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 },
  ...overrides,
});

describe('resolvePetAccess', () => {
  it('allows the owner pending photo only with its active upload bonus', () => {
    expect(resolvePetAccess(pet({ id: 'mine-pending', approvalStatus: 'pending', isMine: true }), allowance))
      .toEqual({ kind: 'reveal', method: 'UPLOAD' });
  });

  it('keeps pending pets character-only without consuming free or ad access', () => {
    expect(resolvePetAccess(pet({ id: 'someone-else', approvalStatus: 'pending' }), allowance))
      .toEqual({ kind: 'characterOnly', reason: 'pending' });
    expect(resolvePetAccess(pet({ id: 'mine-pending', approvalStatus: 'pending', isMine: true }), { ...allowance, uploadUsed: true }))
      .toEqual({ kind: 'characterOnly', reason: 'pending' });
  });

  it('uses the normal daily allowance for approved pets', () => {
    expect(resolvePetAccess(pet({ approvalStatus: 'approved' }), allowance))
      .toEqual({ kind: 'reveal', method: 'FREE' });
    expect(resolvePetAccess(pet({ approvalStatus: 'approved' }), { ...allowance, freeUsed: 1 }))
      .toEqual({ kind: 'reveal', method: 'FREE' });
    expect(resolvePetAccess(pet({ approvalStatus: 'approved' }), { ...allowance, freeUsed: 2 }))
      .toEqual({ kind: 'reveal', method: 'REWARDED' });
  });

  it('does not charge again before the server-authored revisit boundary', () => {
    const now = new Date('2026-08-25T01:00:00.000Z');
    expect(resolvePetAccess(pet({
      approvalStatus: 'approved',
      revisitUntil: '2026-08-25T02:00:00.000Z',
    }), allowance, true, now))
      .toEqual({ kind: 'revisit' });
  });

  it('stops revisiting at the boundary even if the legacy flag is still true', () => {
    const now = new Date('2026-08-25T02:00:00.000Z');
    const expired = pet({
      approvalStatus: 'approved',
      revisitUntil: '2026-08-25T02:00:00.000Z',
      revealedToday: true,
    });

    expect(isPetRevisitActive(expired, now)).toBe(false);
    expect(resolvePetAccess(expired, allowance, true, now))
      .toEqual({ kind: 'reveal', method: 'FREE' });
  });

  it('uses revealedToday only when a timestamp is absent for legacy responses', () => {
    expect(isPetRevisitActive(pet({ revealedToday: true }), new Date('2026-08-25T02:00:00.000Z'))).toBe(true);
    expect(isPetRevisitActive(pet({ revisitUntil: 'not-a-date', revealedToday: true }))).toBe(false);
  });

  it('rejects non-public statuses', () => {
    for (const approvalStatus of ['rejected', 'paused', 'deleted'] as const) {
      expect(resolvePetAccess(pet({ approvalStatus }), allowance)).toEqual({ kind: 'unavailable' });
    }
  });
});
