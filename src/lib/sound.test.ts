import { describe, expect, it } from 'vitest';
import { getPetSoundVariant } from './sound';

describe('getPetSoundVariant', () => {
  it('keeps the same voice for the same dog', () => {
    expect(getPetSoundVariant('sample-bori')).toBe(getPetSoundVariant('sample-bori'));
  });

  it('assigns normal, low, and high voices across the sample dogs', () => {
    const variants = ['sample-bori', 'sample-mandu', 'sample-kong', 'sample-dubu', 'sample-maru']
      .map(getPetSoundVariant);

    expect(new Set(variants)).toEqual(new Set([0, 1, 2]));
  });
});
