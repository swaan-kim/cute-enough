import { describe, expect, it } from 'vitest';
import {
  canRevealStoredPetPhoto,
  isRevisitActive,
  isShareablePetStatus,
  isSharedCharacterStatus,
  wasPetRevealedToday,
} from './pet-visibility.ts';

describe('pending pet visibility boundaries', () => {
  it('lets anyone open the pending character landing without exposing its photo', () => {
    expect(isSharedCharacterStatus('pending')).toBe(true);
    expect(canRevealStoredPetPhoto({ status: 'pending', isOwner: false, allowPendingOwner: true })).toBe(false);
    expect(canRevealStoredPetPhoto({ status: 'pending', isOwner: true, allowPendingOwner: false })).toBe(false);
  });

  it('lets only the owner reveal a pending photo when the server explicitly grants the exception', () => {
    expect(canRevealStoredPetPhoto({ status: 'pending', isOwner: true, allowPendingOwner: true })).toBe(true);
  });

  it('makes approved pets shareable and revealable to other viewers', () => {
    expect(isShareablePetStatus('approved')).toBe(true);
    expect(canRevealStoredPetPhoto({ status: 'approved', isOwner: false, allowPendingOwner: false })).toBe(true);
  });

  it.each(['rejected', 'paused', 'deleted', undefined])('keeps %s pets out of shared and photo flows', (status) => {
    expect(isSharedCharacterStatus(status)).toBe(false);
    expect(isShareablePetStatus(status)).toBe(false);
    expect(canRevealStoredPetPhoto({ status, isOwner: true, allowPendingOwner: true })).toBe(false);
  });

  it('preserves the same-day revisit marker used by the owner list', () => {
    const revealed = new Set(['seen-pet']);
    expect(wasPetRevealedToday('seen-pet', revealed)).toBe(true);
    expect(wasPetRevealedToday('new-pet', revealed)).toBe(false);
  });

  it('uses the server expiry timestamp instead of KST midnight for revisits', () => {
    const now = new Date('2026-08-28T14:59:00.000Z').getTime();
    expect(isRevisitActive('2026-08-28T15:30:00.000Z', now)).toBe(true);
    expect(isRevisitActive('2026-08-28T14:30:00.000Z', now)).toBe(false);
    expect(isRevisitActive(undefined, now)).toBe(false);
    expect(isRevisitActive('not-a-date', now)).toBe(false);
  });
});
