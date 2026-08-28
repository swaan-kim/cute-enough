import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error.ts';
import { requireAction, requirePetTraits } from './validation.ts';

function traits(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    earShape: 'floppy',
    headShape: 'round',
    baseColor: 'white',
    secondaryColor: 'caramel',
    markingPattern: 'blaze',
    muzzle: 'short',
    confidence: 1,
    ...overrides,
  };
}

describe('pet-api trait color validation', () => {
  it('rejects matching base and point colors when a marking is visible', () => {
    let thrown: unknown;

    try {
      requirePetTraits(traits({ baseColor: 'white', secondaryColor: 'white' }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ code: 'INVALID_TRAIT_COLOR_CONTRAST', status: 400 });
  });

  it('accepts matching colors for an unmarked single-color dog', () => {
    const singleColor = traits({ baseColor: 'black', secondaryColor: 'black', markingPattern: 'none' });

    expect(requirePetTraits(singleColor)).toBe(singleColor);
  });

  it('accepts a distinct submitted point color unchanged', () => {
    const submitted = traits({ baseColor: 'cream', secondaryColor: 'gray', markingPattern: 'spots' });

    expect(requirePetTraits(submitted)).toBe(submitted);
  });
});

describe('pet-api action validation', () => {
  it('accepts the owner-scoped submission status action', () => {
    expect(requireAction('submissionStatus')).toBe('submissionStatus');
  });

  it('accepts the owner-only photo action', () => {
    expect(requireAction('ownerPhoto')).toBe('ownerPhoto');
  });
});
