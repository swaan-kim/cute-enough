import { ApiError } from './api-error.ts';
import {
  isPetTraitColorContrastValid,
  PET_COAT_COLORS,
  type PetTraitColorFields,
} from './pet-trait-colors.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSAFE_NAME = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;
const ALLOWED_NAME = /^[\p{L}\p{N} ]*$/u;
const BLOCKED_NAMES = ['관리자', '운영자', '토스', '시발', '씨발', '병신', '개새끼', 'fuck', 'sex'];
const TRAIT_ENUMS = {
  earShape: ['floppy', 'upright', 'semi', 'rounded'],
  headShape: ['round', 'oval', 'long'],
  baseColor: PET_COAT_COLORS,
  secondaryColor: PET_COAT_COLORS,
  markingPattern: ['none', 'brow', 'mask', 'blaze', 'spots'],
  muzzle: ['short', 'medium', 'long'],
} as const;

export const PET_API_ACTIONS = ['house', 'shared', 'mine', 'reveal', 'submit', 'report'] as const;
export type PetApiAction = typeof PET_API_ACTIONS[number];

function graphemeLength(value: string): number {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(value)].length;
  }
  return Array.from(value).length;
}

export function requireAction(value: unknown): PetApiAction {
  if (typeof value !== 'string' || !PET_API_ACTIONS.includes(value as PetApiAction)) {
    throw new ApiError('INVALID_ACTION', 404, '알 수 없는 요청이에요.');
  }
  return value as PetApiAction;
}

export function requireAnonymousKey(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\u0000-\u001F]/u.test(value)) {
    throw new ApiError('INVALID_USER_KEY', 400, '사용자 식별값이 필요해요.');
  }
  return value;
}

export function requireUuid(value: unknown, message = '요청한 강아지 정보를 확인해 주세요.'): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ApiError('INVALID_ID', 400, message);
  return value;
}

export function normalizePetName(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new ApiError('INVALID_PET_NAME', 400, '강아지 이름을 다시 확인해 주세요.');
  const normalized = value.normalize('NFC').replace(UNSAFE_NAME, '').replace(/\s+/gu, ' ').trim();
  if (graphemeLength(normalized) > 4) throw new ApiError('PET_NAME_TOO_LONG', 400, '강아지 이름은 네 글자까지 입력해 주세요.');
  if (!ALLOWED_NAME.test(normalized)) throw new ApiError('INVALID_PET_NAME', 400, '이름에는 한글, 영문, 숫자만 사용할 수 있어요.');
  const comparable = normalized.toLocaleLowerCase('ko').replaceAll(' ', '');
  if (BLOCKED_NAMES.some((blocked) => comparable.includes(blocked))) throw new ApiError('BLOCKED_PET_NAME', 400, '다른 이름을 입력해 주세요.');
  return normalized;
}

export function requirePetTraits(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_TRAITS', 400, '캐릭터 특징을 다시 확인해 주세요.');
  const traits = value as Record<string, unknown>;
  const expectedKeys = new Set(['schemaVersion', ...Object.keys(TRAIT_ENUMS), 'confidence']);
  if (Object.keys(traits).some((key) => !expectedKeys.has(key)) || traits.schemaVersion !== 1) {
    throw new ApiError('INVALID_TRAITS', 400, '캐릭터 특징을 다시 확인해 주세요.');
  }
  for (const [key, allowed] of Object.entries(TRAIT_ENUMS)) {
    if (!allowed.includes(traits[key] as never)) throw new ApiError('INVALID_TRAITS', 400, '캐릭터 특징을 다시 확인해 주세요.');
  }
  if (typeof traits.confidence !== 'number' || !Number.isFinite(traits.confidence) || traits.confidence < 0 || traits.confidence > 1) {
    throw new ApiError('INVALID_TRAITS', 400, '캐릭터 특징을 다시 확인해 주세요.');
  }
  if (!isPetTraitColorContrastValid(traits as unknown as PetTraitColorFields)) {
    throw new ApiError('INVALID_TRAIT_COLOR_CONTRAST', 400, '얼굴 무늬와 다른 포인트 털색을 골라 주세요.');
  }
  return traits;
}
