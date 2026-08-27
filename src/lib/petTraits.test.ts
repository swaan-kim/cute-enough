import { describe, expect, it } from 'vitest';
import type { CoatColor, PetTraitsV1 } from '../types';
import {
  getContrastingCoatColor,
  isPetTraitColorContrastValid,
  normalizePetTraitColors,
} from './petTraits';

const traits = (overrides: Partial<PetTraitsV1> = {}): PetTraitsV1 => ({
  schemaVersion: 1,
  earShape: 'floppy',
  headShape: 'round',
  baseColor: 'white',
  secondaryColor: 'caramel',
  markingPattern: 'blaze',
  muzzle: 'short',
  confidence: 1,
  ...overrides,
});

describe('pet trait point-color contrast', () => {
  it.each<[CoatColor, CoatColor]>([
    ['white', 'caramel'],
    ['cream', 'caramel'],
    ['caramel', 'cream'],
    ['chocolate', 'cream'],
    ['black', 'cream'],
    ['gray', 'white'],
  ])('maps %s coats to a %s point color', (baseColor, expected) => {
    expect(getContrastingCoatColor(baseColor)).toBe(expected);
  });

  it('preserves a distinct point color extracted from the photo', () => {
    const extracted = traits({ baseColor: 'cream', secondaryColor: 'black' });

    expect(normalizePetTraitColors(extracted)).toBe(extracted);
  });

  it('allows a single-color dog when no face marking is selected', () => {
    const singleColor = traits({ baseColor: 'gray', secondaryColor: 'gray', markingPattern: 'none' });

    expect(isPetTraitColorContrastValid(singleColor)).toBe(true);
    expect(normalizePetTraitColors(singleColor)).toBe(singleColor);
  });

  it('repairs legacy markings that disappeared into the base coat', () => {
    const legacy = traits({ baseColor: 'chocolate', secondaryColor: 'chocolate', markingPattern: 'brow' });

    expect(isPetTraitColorContrastValid(legacy)).toBe(false);
    expect(normalizePetTraitColors(legacy)).toEqual({ ...legacy, secondaryColor: 'cream' });
  });
});
