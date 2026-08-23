export const MAX_PET_NAME_LENGTH = 4;

const UNSAFE_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;
const ALLOWED_NAME = /^[\p{L}\p{N} ]*$/u;
const BLOCKED_NAMES = [
  '관리자', '운영자', '토스',
  '시발', '씨발', '병신', '개새끼',
  'fuck', 'sex',
];

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(value)].map((part) => part.segment);
  }
  return Array.from(value);
}

export function sanitizePetName(value: string) {
  return value
    .normalize('NFC')
    .replace(UNSAFE_CHARACTERS, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function petNameLength(value: string) {
  return graphemes(sanitizePetName(value)).length;
}

export function limitPetName(value: string) {
  return graphemes(sanitizePetName(value)).slice(0, MAX_PET_NAME_LENGTH).join('');
}

export function preparePetName(value: string) {
  return limitPetName(value);
}

export function getPetNameError(value: string): string | undefined {
  const normalized = sanitizePetName(value);
  if (!normalized) return undefined;
  if (petNameLength(normalized) > MAX_PET_NAME_LENGTH) return '강아지 이름은 네 글자까지 입력해 주세요.';
  if (!ALLOWED_NAME.test(normalized)) return '이름에는 한글, 영문, 숫자만 사용할 수 있어요.';
  const comparable = normalized.toLocaleLowerCase('ko').replaceAll(' ', '');
  if (BLOCKED_NAMES.some((blocked) => comparable.includes(blocked))) return '다른 이름을 입력해 주세요.';
  return undefined;
}
