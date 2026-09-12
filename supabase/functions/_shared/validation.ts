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
const ACCESSORY_KINDS = ['ribbon', 'scarf', 'vest', 'ball'] as const;
const ACCESSORY_COLORS = ['pink', 'sky', 'yellow', 'mint'] as const;
const COAT_MODES = ['solid', 'point'] as const;
const FUR_STYLES = ['neat', 'fluffy', 'cloud'] as const;
const BROW_STYLES = ['none', 'soft', 'caterpillar', 'angled'] as const;
const TONGUE_SHAPES = ['drop', 'round', 'wide', 'side'] as const;

export type ValidPetAccessory = {
  kind: typeof ACCESSORY_KINDS[number];
  color: typeof ACCESSORY_COLORS[number];
  assetKey?: string;
};

export type ValidPetStyle = {
  schemaVersion: 1;
  coatMode: typeof COAT_MODES[number];
  furStyle: typeof FUR_STYLES[number];
  expression?: {
    browStyle: typeof BROW_STYLES[number];
    tongueShape: typeof TONGUE_SHAPES[number];
  };
};

export const PET_API_ACTIONS = [
  'house', 'shared', 'mine', 'artwork', 'design', 'reveal', 'ownerPhoto', 'photoPrepare', 'album', 'albumPhoto', 'setFavorite', 'submit', 'submitPhoto', 'submissionStatus', 'report',
  'photoAdditionStatus', 'photoAdditionUpload', 'photoAdditionSubmit',
  'rewardStart', 'rewardComplete', 'rewardCancel', 'rewardStatus', 'rewardRebind',
  'shareStart', 'shareReward', 'shareClose', 'notificationSettings', 'setNotificationSettings',
] as const;
export type PetApiAction = typeof PET_API_ACTIONS[number];

/** Owner registration never accepts reviewer-controlled publication inputs. */
export function rejectCreatorDesignFields(body: Record<string, unknown>): void {
  const reserved = ['publishedDesign', 'publishedDesignId', 'published_design_id', 'publishedAccessory', 'publishedStyle',
    'designVersion', 'expectedDraftRevision', 'draftDesign', 'sha256',
    'document', 'editorState', 'designDraft', 'draftRevision', 'expectedDesignVersion', 'reviewedArtwork',
    'reviewed_artwork', 'artwork', 'illustrationUrl', 'finalTraits', 'finalStyle'];
  if (reserved.some((key) => Object.hasOwn(body, key))) {
    throw new ApiError('CREATOR_DESIGN_FIELDS_FORBIDDEN', 400, '검수 디자인은 제작자만 저장할 수 있어요.');
  }
}

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

/** New submissions require a visible name; legacy unnamed records remain readable. */
export function requirePetName(value: unknown): string {
  if (value === undefined || value === null
    || (typeof value === 'string' && !value.replace(UNSAFE_NAME, '').replace(/\p{Default_Ignorable_Code_Point}/gu, '').trim())) {
    throw new ApiError('PET_NAME_REQUIRED', 400, '강아지 이름을 입력해 주세요.');
  }
  return normalizePetName(value);
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

export function requirePetStyle(value: unknown, traitsValue: Record<string, unknown>): ValidPetStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('INVALID_PET_STYLE', 400, '털 윤곽과 털색 방식을 다시 확인해 주세요.');
  }
  const style = value as Record<string, unknown>;
  if (Object.keys(style).some((key) => !['schemaVersion', 'coatMode', 'furStyle', 'expression'].includes(key))
    || style.schemaVersion !== 1
    || !COAT_MODES.includes(style.coatMode as never)
    || !FUR_STYLES.includes(style.furStyle as never)) {
    throw new ApiError('INVALID_PET_STYLE', 400, '털 윤곽과 털색 방식을 다시 확인해 주세요.');
  }

  let expression: ValidPetStyle['expression'];
  if (style.expression !== undefined) {
    if (!style.expression || typeof style.expression !== 'object' || Array.isArray(style.expression)) {
      throw new ApiError('INVALID_PET_EXPRESSION', 400, '강아지 표정을 다시 확인해 주세요.');
    }
    const candidate = style.expression as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => !['browStyle', 'tongueShape'].includes(key))
      || !BROW_STYLES.includes(candidate.browStyle as never)
      || !TONGUE_SHAPES.includes(candidate.tongueShape as never)) {
      throw new ApiError('INVALID_PET_EXPRESSION', 400, '강아지 표정을 다시 확인해 주세요.');
    }
    expression = {
      browStyle: candidate.browStyle as NonNullable<ValidPetStyle['expression']>['browStyle'],
      tongueShape: candidate.tongueShape as NonNullable<ValidPetStyle['expression']>['tongueShape'],
    };
  }

  const sameColor = traitsValue.baseColor === traitsValue.secondaryColor;
  const noMarking = traitsValue.markingPattern === 'none';
  if (style.coatMode === 'solid' && (!sameColor || !noMarking)) {
    throw new ApiError('INVALID_SOLID_COAT', 400, '한 가지 털색은 무늬 없이 같은 색으로 등록해 주세요.');
  }
  if (style.coatMode === 'point' && sameColor) {
    throw new ApiError('INVALID_POINT_COAT', 400, '포인트 털색은 기본 털색과 다르게 골라 주세요.');
  }

  return {
    schemaVersion: 1,
    coatMode: style.coatMode as ValidPetStyle['coatMode'],
    furStyle: style.furStyle as ValidPetStyle['furStyle'],
    ...(expression ? { expression } : {}),
  };
}

export function requirePetAccessory(value: unknown): ValidPetAccessory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('INVALID_PET_ACCESSORY', 400, '강아지 소품을 다시 골라 주세요.');
  }
  const accessory = value as Record<string, unknown>;
  const keys = Object.keys(accessory);
  if (keys.some((key) => !['kind', 'color', 'assetKey'].includes(key))
    || !ACCESSORY_KINDS.includes(accessory.kind as never)
    || !ACCESSORY_COLORS.includes(accessory.color as never)) {
    throw new ApiError('INVALID_PET_ACCESSORY', 400, '강아지 소품을 다시 골라 주세요.');
  }
  const expectedAssetKey = `builtin:${String(accessory.kind)}`;
  if (accessory.assetKey !== expectedAssetKey) {
    throw new ApiError('INVALID_ACCESSORY_ASSET', 400, '사용할 수 없는 강아지 소품이에요.');
  }
  return {
    kind: accessory.kind as ValidPetAccessory['kind'],
    color: accessory.color as ValidPetAccessory['color'],
    assetKey: expectedAssetKey,
  };
}

export function requireAccessorySubmission(modeValue: unknown, accessoryValue: unknown): {
  mode: 'owner' | 'reviewer';
  requestedAccessory: ValidPetAccessory | null;
} {
  if (modeValue !== 'owner' && modeValue !== 'reviewer') {
    throw new ApiError('INVALID_ACCESSORY_SELECTION_MODE', 400, '소품 선택 방식을 다시 확인해 주세요.');
  }
  if (modeValue === 'reviewer') {
    if (accessoryValue !== undefined && accessoryValue !== null) {
      throw new ApiError('REVIEWER_ACCESSORY_MUST_BE_EMPTY', 400, '검수자에게 맡길 때는 소품을 미리 지정하지 않아요.');
    }
    return { mode: 'reviewer', requestedAccessory: null };
  }
  return { mode: 'owner', requestedAccessory: requirePetAccessory(accessoryValue) };
}
