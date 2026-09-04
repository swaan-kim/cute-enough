import { describe, expect, it } from 'vitest';
import { getCuratedReviewDraft } from './curatedDrafts';

const baseItem = {
  name: null,
  submittedTraits: {
    schemaVersion: 1 as const,
    baseColor: 'gray' as const,
    secondaryColor: 'white' as const,
    markingPattern: 'brow' as const,
    earShape: 'floppy' as const,
    headShape: 'round' as const,
    muzzle: 'short' as const,
    confidence: 0.43,
  },
};

describe('getCuratedReviewDraft', () => {
  it('turns the unnamed gray dog into Titi without inventing a white point coat', () => {
    const draft = getCuratedReviewDraft({ ...baseItem, petId: '36d0b0eb-32b6-48d7-b505-31a58d4bf4f7' });
    expect(draft?.displayName).toBe('티티');
    expect(draft?.traits.secondaryColor).toBe('gray');
    expect(draft?.traits.markingPattern).toBe('none');
    expect(draft?.style).toMatchObject({ coatMode: 'solid', furStyle: 'fluffy' });
  });

  it('keeps Baechu white and removes the artificial face spots', () => {
    const draft = getCuratedReviewDraft({ ...baseItem, petId: 'fb1bca0b-3fbb-4b51-a392-c99866f6195d', name: '배추' });
    expect(draft?.traits).toMatchObject({ baseColor: 'white', secondaryColor: 'white', markingPattern: 'none' });
    expect(draft?.style).toMatchObject({ coatMode: 'solid', furStyle: 'cloud' });
  });
});
