import { describe, expect, it } from 'vitest';
import { getPetEarVariant, getPetSignature } from './petSignature';

describe('getPetSignature', () => {
  it('keeps the same signature for preview and seeded identities', () => {
    expect(getPetSignature('sample-gureumi')).toBe('sky-bandana');
    expect(getPetSignature('d5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001')).toBe('sky-bandana');
    expect(getPetSignature('sample-haneul')).toBe('peach-hairpin');
    expect(getPetSignature('d5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf003')).toBe('peach-hairpin');
  });

  it('does not decorate ordinary uploads or trait-only previews', () => {
    expect(getPetSignature('7daff31d-881d-46ed-bfa5-26a8fa93e6b3')).toBeUndefined();
    expect(getPetSignature()).toBeUndefined();
  });

  it('keeps the curated ear shape for preview and seeded identities', () => {
    expect(getPetEarVariant('sample-gureumi')).toBe('high-floppy');
    expect(getPetEarVariant('d5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001')).toBe('high-floppy');
    expect(getPetEarVariant('sample-haneul')).toBe('soft-upright');
    expect(getPetEarVariant('d5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf003')).toBe('soft-upright');
    expect(getPetEarVariant('uploaded-dog')).toBeUndefined();
  });
});
