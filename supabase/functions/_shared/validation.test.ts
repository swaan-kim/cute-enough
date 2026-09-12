import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error.ts';
import { normalizePetName, requireAccessorySubmission, requireAction, requirePetAccessory, requirePetName, requirePetStyle, requirePetTraits } from './validation.ts';

describe('new registration pet name validation', () => {
  it.each([undefined, null, '', '   ', '\t\r\n', '\u200B\u200C\u200D', '\u2060\uFEFF', '\u3164\uFFA0', '\u115F\u1160\u00AD'])
    ('requires a visible name for %j', (name) => {
      expect(() => requirePetName(name)).toThrowError(expect.objectContaining({
        code: 'PET_NAME_REQUIRED', status: 400, message: '강아지 이름을 입력해 주세요.',
      }));
    });

  it.each([
    ['콩', '콩'],
    ['  구르미  ', '구르미'],
    ['구르미', '구르미'],
    ['\u200B구름\uFEFF', '구름'],
    ['Milo', 'Milo'],
    ['1234', '1234'],
    ['하  루', '하 루'],
  ])('accepts a normalized one-to-four-character name: %j', (name, expected) => {
    expect(requirePetName(name)).toBe(expected);
  });

  it('retains existing length, character, and blocked-name restrictions', () => {
    expect(() => requirePetName('구르미강아지')).toThrowError(expect.objectContaining({ code: 'PET_NAME_TOO_LONG', status: 400 }));
    for (const name of [123, {}, '강아지!', '🐶']) {
      expect(() => requirePetName(name)).toThrowError(expect.objectContaining({ code: 'INVALID_PET_NAME', status: 400 }));
    }
    expect(() => requirePetName('관리자')).toThrowError(expect.objectContaining({ code: 'BLOCKED_PET_NAME', status: 400 }));
  });

  it.each([undefined, null, '', '  ', '\u200B\uFEFF'])('preserves optional normalization for legacy unnamed records: %j', (name) => {
    expect(normalizePetName(name)).toBe('');
  });
});

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

describe('pet style validation', () => {
  it('accepts all three fur outlines with a valid point coat', () => {
    for (const furStyle of ['neat', 'fluffy', 'cloud'] as const) {
      expect(requirePetStyle({ schemaVersion: 1, coatMode: 'point', furStyle }, traits())).toMatchObject({ furStyle });
    }
  });

  it('accepts a real single-color coat only when colors match and markings are absent', () => {
    const solidTraits = traits({ baseColor: 'white', secondaryColor: 'white', markingPattern: 'none' });
    expect(requirePetStyle({ schemaVersion: 1, coatMode: 'solid', furStyle: 'cloud' }, solidTraits)).toMatchObject({ coatMode: 'solid' });
    expect(() => requirePetStyle({ schemaVersion: 1, coatMode: 'solid', furStyle: 'cloud' }, traits()))
      .toThrowError(expect.objectContaining({ code: 'INVALID_SOLID_COAT' }));
  });

  it('rejects matching colors in point mode and unknown expressions', () => {
    const sameColor = traits({ baseColor: 'white', secondaryColor: 'white', markingPattern: 'none' });
    expect(() => requirePetStyle({ schemaVersion: 1, coatMode: 'point', furStyle: 'neat' }, sameColor))
      .toThrowError(expect.objectContaining({ code: 'INVALID_POINT_COAT' }));
    expect(() => requirePetStyle({ schemaVersion: 1, coatMode: 'point', furStyle: 'neat', expression: { browStyle: 'laser', tongueShape: 'round' } }, traits()))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PET_EXPRESSION' }));
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

describe('pet accessory validation', () => {
  it('accepts only reviewed built-in kind, color, and matching asset key', () => {
    const accessory = { kind: 'scarf', color: 'mint', assetKey: 'builtin:scarf' } as const;
    expect(requirePetAccessory(accessory)).toEqual(accessory);

    expect(() => requirePetAccessory({ ...accessory, assetKey: 'custom:svg' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ACCESSORY_ASSET' }));
    expect(() => requirePetAccessory({ kind: 'scarf', color: 'mint' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ACCESSORY_ASSET' }));
    expect(() => requirePetAccessory({ ...accessory, html: '<svg />' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PET_ACCESSORY' }));
  });

  it('requires an owner choice and forbids a hidden reviewer choice', () => {
    expect(requireAccessorySubmission('owner', { kind: 'ball', color: 'yellow', assetKey: 'builtin:ball' })).toEqual({
      mode: 'owner',
      requestedAccessory: { kind: 'ball', color: 'yellow', assetKey: 'builtin:ball' },
    });
    expect(requireAccessorySubmission('reviewer', undefined)).toEqual({
      mode: 'reviewer',
      requestedAccessory: null,
    });
    expect(() => requireAccessorySubmission('reviewer', { kind: 'ball', color: 'yellow', assetKey: 'builtin:ball' }))
      .toThrowError(expect.objectContaining({ code: 'REVIEWER_ACCESSORY_MUST_BE_EMPTY' }));
  });
});
