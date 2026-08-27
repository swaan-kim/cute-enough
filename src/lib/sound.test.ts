import { describe, expect, it } from 'vitest';
import { getPetSoundVariant } from './sound';

describe('getPetSoundVariant', () => {
  it('keeps the same voice for the same dog', () => {
    expect(getPetSoundVariant('sample-haneul')).toBe(getPetSoundVariant('sample-haneul'));
  });

  it('gives Gureumi the higher voice and preserves voices for seeded identities', () => {
    expect(getPetSoundVariant('sample-haneul')).toBe(1);
    expect(getPetSoundVariant('sample-gureumi')).toBe(2);
    expect(getPetSoundVariant('d5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf003')).toBe(1);
    expect(getPetSoundVariant('d5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001')).toBe(2);
  });

  it('keeps generated voices inside the supported range', () => {
    expect([0, 1, 2]).toContain(getPetSoundVariant('uploaded-pet-id'));
  });
});
