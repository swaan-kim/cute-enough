import { describe, expect, it } from 'vitest';
import type { SubmitPetResult } from '../types';
import { findPreviewSubmission, markPreviewPetRevealed, readPreviewMyPets, readPreviewRevealedPetIds, resetPreviewReveals, savePreviewSubmission } from './previewPetStore';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
const traits = { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 } as const;
const result = (id: string): SubmitPetResult => ({ pet: { id, traits, approvalStatus: 'pending', isMine: true }, rewardGranted: id === 'one', uploadRewardPetId: id === 'one' ? id : undefined });

describe('preview pet persistence', () => {
  it('accumulates different submissions and makes retries idempotent', () => {
    const storage = memoryStorage();
    savePreviewSubmission('submission-one', result('one'), storage);
    savePreviewSubmission('submission-two', result('two'), storage);
    savePreviewSubmission('submission-one', result('one'), storage);
    expect(readPreviewMyPets(storage).map(({ id }) => id)).toEqual(['one', 'two']);
    expect(findPreviewSubmission('submission-one', storage)?.pet.id).toBe('one');
  });

  it('tracks revealed pets by date without deleting the upload', () => {
    const storage = memoryStorage();
    savePreviewSubmission('submission-one', result('one'), storage);
    markPreviewPetRevealed('one', '2026-08-25', storage);
    expect(readPreviewRevealedPetIds('2026-08-25', storage)).toEqual(new Set(['one']));
    expect(readPreviewMyPets(storage)).toHaveLength(1);
    expect(readPreviewRevealedPetIds('2026-08-26', storage)).toEqual(new Set());
    resetPreviewReveals(storage);
    expect(readPreviewRevealedPetIds('2026-08-25', storage)).toEqual(new Set());
  });
});
