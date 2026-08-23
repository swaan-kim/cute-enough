import { describe, expect, it } from 'vitest';
import { limitPetName, petNameLength, preparePetName } from './petName';

describe('pet name helpers', () => {
  it('limits Korean names to four characters', () => {
    expect(limitPetName('김보리공주님')).toBe('김보리공');
    expect(petNameLength(limitPetName('김보리공주님'))).toBe(4);
  });

  it('normalizes and trims the submitted name', () => {
    expect(preparePetName('  보리  ')).toBe('보리');
  });

  it('supports an empty optional name', () => {
    expect(preparePetName('   ')).toBe('');
  });
});
