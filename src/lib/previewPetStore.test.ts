import { describe, expect, it } from 'vitest';
import type { SubmitPetResult } from '../types';
import {
  findActivePreviewReveal,
  findPreviewSubmission,
  markPreviewPetRevealed,
  readActivePreviewReveals,
  readPreviewMyPets,
  readPreviewRevealedPetIds,
  resetPreviewReveals,
  savePreviewSubmission,
} from './previewPetStore';

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

  it('tracks revisit expiry and the original photo date without deleting the upload', () => {
    const storage = memoryStorage();
    savePreviewSubmission('submission-one', result('one'), storage);
    markPreviewPetRevealed('one', '2026-08-25T18:00:00.000Z', '2026-08-25', storage);

    const beforeBoundary = new Date('2026-08-25T17:59:59.999Z');
    expect(findActivePreviewReveal('one', '2026-08-26', beforeBoundary, storage)).toEqual({
      petId: 'one',
      revisitUntil: '2026-08-25T18:00:00.000Z',
      photoDate: '2026-08-25',
    });
    expect(readPreviewRevealedPetIds('2026-08-26', storage, beforeBoundary)).toEqual(new Set(['one']));
    expect(readPreviewMyPets(storage)).toHaveLength(1);

    const atBoundary = new Date('2026-08-25T18:00:00.000Z');
    expect(readActivePreviewReveals('2026-08-26', atBoundary, storage)).toEqual([]);
    resetPreviewReveals(storage);
    expect(readPreviewRevealedPetIds('2026-08-25', storage, beforeBoundary)).toEqual(new Set());
  });

  it('reads legacy date records only when no timestamp is available', () => {
    const storage = memoryStorage();
    storage.setItem('cute-enough:preview-reveals', JSON.stringify({
      date: '2026-08-25',
      petIds: ['legacy'],
    }));

    expect(readPreviewRevealedPetIds('2026-08-25', storage)).toEqual(new Set(['legacy']));
    expect(readPreviewRevealedPetIds('2026-08-26', storage)).toEqual(new Set());
  });
});
