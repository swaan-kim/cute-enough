import { describe, expect, it } from 'vitest';
import { withSubjectParticle } from './koreanCopy';

describe('withSubjectParticle', () => {
  it('uses 이 after a final consonant and 가 otherwise', () => {
    expect(withSubjectParticle('하늘')).toBe('하늘이');
    expect(withSubjectParticle('몽실')).toBe('몽실이');
    expect(withSubjectParticle('구르미')).toBe('구르미가');
    expect(withSubjectParticle('별이')).toBe('별이가');
  });
});
