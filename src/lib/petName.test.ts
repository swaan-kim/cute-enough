import { describe, expect, it } from 'vitest';
import { getPetNameError, limitPetName, petNameLength, preparePetName, sanitizePetName } from './petName';

describe('pet name helpers', () => {
  it('limits Korean names to four characters', () => {
    expect(limitPetName('김보리공주님')).toBe('김보리공');
    expect(petNameLength(limitPetName('김보리공주님'))).toBe(4);
  });

  it('normalizes and trims the submitted name', () => {
    expect(preparePetName('  보리  ')).toBe('보리');
  });

  it.each(['', '   ', '\t\n', '\u200B\uFEFF'])('requires a visible name: %j', (value) => {
    expect(preparePetName(value)).toBe('');
    expect(getPetNameError(value)).toBe('강아지 이름을 입력해 주세요.');
  });

  it.each(['콩', '보리', 'Bori', '보리12'])('accepts a one-to-four-character name: %s', (value) => {
    expect(getPetNameError(value)).toBeUndefined();
  });

  it.each(['\u3164\uFFA0', '\u115F\u1160\u00AD'])('rejects invisible filler-only names: %j', (value) => {
    expect(getPetNameError(value)).toBe('강아지 이름을 입력해 주세요.');
  });

  it('counts user-visible graphemes instead of UTF-16 units', () => {
    expect(petNameLength('가나다라')).toBe(4);
    expect(petNameLength('e\u0301')).toBe(1);
  });

  it('removes control and zero-width characters', () => {
    expect(sanitizePetName('보\u200B리\u0000')).toBe('보리');
  });

  it('rejects unsupported symbols and basic blocked names', () => {
    expect(getPetNameError('보리♥')).toContain('한글');
    expect(getPetNameError('관리자')).toBe('다른 이름을 입력해 주세요.');
    expect(getPetNameError('보리')).toBeUndefined();
  });
});
