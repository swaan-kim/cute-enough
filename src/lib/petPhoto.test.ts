import { describe, expect, it } from 'vitest';
import type { PetSummary } from '../types';
import { getPetPhotoUrls, hasPetPhoto, selectPetPhotoUrl } from './petPhoto';

const pet: PetSummary = {
  id: 'sample-gureumi',
  name: '구르미',
  photoUrl: '/gureumi-01.jpg',
  photoUrls: ['/gureumi-01.jpg', '/gureumi-02.jpg', '/gureumi-03.jpg', '/gureumi-01.jpg'],
  traits: {
    schemaVersion: 1,
    earShape: 'floppy',
    headShape: 'round',
    baseColor: 'white',
    secondaryColor: 'cream',
    markingPattern: 'none',
    muzzle: 'medium',
    confidence: 1,
  },
};

describe('pet photo selection', () => {
  it('deduplicates the gallery and falls back to the primary photo', () => {
    expect(getPetPhotoUrls(pet)).toEqual(['/gureumi-01.jpg', '/gureumi-02.jpg', '/gureumi-03.jpg']);
    expect(getPetPhotoUrls({ ...pet, photoUrls: undefined })).toEqual(['/gureumi-01.jpg']);
  });

  it('recognizes direct preview photos and server-confirmed private photos', () => {
    expect(hasPetPhoto(pet)).toBe(true);
    expect(hasPetPhoto({ ...pet, photoUrl: undefined, photoUrls: ['/alternate.jpg'] })).toBe(true);
    expect(hasPetPhoto({ ...pet, photoUrl: undefined, photoUrls: [], photoAvailable: true })).toBe(true);
    expect(hasPetPhoto({ ...pet, photoUrl: '  ', photoUrls: ['', '  '], photoAvailable: false })).toBe(false);
  });

  it('keeps retries stable for the same viewer and date', () => {
    const first = selectPetPhotoUrl(pet, '2026-08-25', 'viewer-a');
    expect(selectPetPhotoUrl(pet, '2026-08-25', 'viewer-a')).toBe(first);
  });

  it('can distribute all curated photos across viewers', () => {
    const selected = new Set(Array.from({ length: 80 }, (_, index) => (
      selectPetPhotoUrl(pet, '2026-08-25', `viewer-${index}`)
    )));
    expect(selected).toEqual(new Set(['/gureumi-01.jpg', '/gureumi-02.jpg', '/gureumi-03.jpg']));
  });
});
