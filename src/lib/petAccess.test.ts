import { describe, expect, it } from 'vitest';
import type { DailyAllowance, PetSummary } from '../types';
import { isPetRevisitActive, resolvePetAccess, resolvePetEncounter } from './petAccess';

const allowance: DailyAllowance = {
  date: '2026-08-25', freeUsed: 0, rewardedUsed: 0,
  uploadCredit: true, uploadUsed: false, uploadRewardPetId: 'mine-pending',
};
const pet = (overrides: Partial<PetSummary>): PetSummary => ({
  id: 'pet',
  traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 },
  ...overrides,
});

describe('house daily collection intent', () => {
  const now = new Date('2026-08-25T02:00:00Z');
  const current = { ...allowance, remaining: 2 };
  const returning = pet({ approvalStatus: 'approved', unlockedPhotoCount: 1, albumPhotoId: 'old',
    collection: { collectedCount: 1, totalCount: 3, collectedToday: false, canCollectToday: true } });
  it('collects a new photo after play only when the assigned friend can collect today', () => {
    expect(resolvePetEncounter(returning, current, { now })).toEqual({ kind: 'reveal', method: 'FREE' });
  });
  it('replays today’s photo despite natural recharge and never collects through a returning share link', () => {
    expect(resolvePetEncounter({ ...returning, collection: { ...returning.collection!, collectedToday: true, canCollectToday: false } }, current, { now })).toEqual({ kind: 'revisit' });
    expect(resolvePetEncounter(returning, current, { now, source: 'shared' })).toEqual({ kind: 'revisit' });
  });
  it('replays collected photos without forcing an advertisement when tickets are empty', () => {
    expect(resolvePetEncounter(returning, { ...current, remaining: 0, freeUsed: 2 }, { now, adsEnabled: true })).toEqual({ kind: 'revisit' });
  });
  it('keeps full collections free and uses an earned ad credit before a free ticket for new collection', () => {
    expect(resolvePetEncounter({ ...returning, collection: { collectedCount: 3, totalCount: 3, collectedToday: false, canCollectToday: false } }, current, { now, hasAdCredit: true })).toEqual({ kind: 'revisit' });
    expect(resolvePetEncounter(returning, current, { now, hasAdCredit: true })).toEqual({ kind: 'reveal', method: 'REWARDED' });
  });
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

  it('opens an owner photo immediately without spending the legacy upload bonus', () => {
    const ownedPending = pet({
      id: 'mine-pending',
      approvalStatus: 'pending',
      isMine: true,
      ownerPhotoAvailable: true,
    });

    expect(resolvePetAccess(ownedPending, allowance))
      .toEqual({ kind: 'ownerPhoto' });
    expect(resolvePetAccess(ownedPending, { ...allowance, uploadUsed: true }))
      .toEqual({ kind: 'ownerPhoto' });
  });

  it('requires the server-authored owner photo permission instead of trusting isMine alone', () => {
    expect(resolvePetAccess(pet({
      id: 'mine-pending', approvalStatus: 'pending', isMine: true,
    }), { ...allowance, uploadUsed: true }))
      .toEqual({ kind: 'characterOnly', reason: 'pending' });
    expect(resolvePetAccess(pet({
      approvalStatus: 'approved', isMine: true, ownerPhotoAvailable: true,
    }), { ...allowance, uploadUsed: true }))
      .toEqual({ kind: 'ownerPhoto' });
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

  it('uses the ticket that recharges at the exact revisit boundary', () => {
    const boundary = new Date('2026-08-25T04:00:00.000Z');
    const exhaustedUntilBoundary: DailyAllowance = {
      date: '2026-08-25',
      freeUsed: 2,
      remaining: 0,
      nextChargeAt: boundary.toISOString(),
      rewardedUsed: 2,
      uploadCredit: false,
      uploadUsed: false,
    };

    expect(resolvePetAccess(pet({
      approvalStatus: 'approved',
      revisitUntil: boundary.toISOString(),
      revealedToday: true,
    }), exhaustedUntilBoundary, true, boundary))
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
