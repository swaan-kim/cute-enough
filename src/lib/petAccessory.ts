import type {
  AccessorySelectionMode,
  PetAccessory,
  PetAccessoryColor,
  PetAccessoryKind,
} from '../types';

export const PET_ACCESSORY_KINDS: readonly PetAccessoryKind[] = ['ribbon', 'scarf', 'vest', 'ball'];
export const PET_ACCESSORY_COLORS: readonly PetAccessoryColor[] = ['pink', 'sky', 'yellow', 'mint'];
export const ACCESSORY_SELECTION_MODES: readonly AccessorySelectionMode[] = ['owner', 'reviewer'];

export const PET_ACCESSORY_KIND_LABELS: Readonly<Record<PetAccessoryKind, string>> = {
  ribbon: '리본핀',
  scarf: '스카프',
  vest: '조끼',
  ball: '애착 공',
};

export const PET_ACCESSORY_COLOR_LABELS: Readonly<Record<PetAccessoryColor, string>> = {
  pink: '분홍',
  sky: '하늘',
  yellow: '노랑',
  mint: '민트',
};

export const PET_ACCESSORY_COLOR_HEX: Readonly<Record<PetAccessoryColor, string>> = {
  pink: '#FF8EAA',
  sky: '#7CC9F2',
  yellow: '#FFD45E',
  mint: '#77D8BE',
};

export function builtinAccessoryAssetKey(kind: PetAccessoryKind): string {
  return `builtin:${kind}`;
}

export function createPetAccessory(kind: PetAccessoryKind, color: PetAccessoryColor): PetAccessory {
  return { kind, color, assetKey: builtinAccessoryAssetKey(kind) };
}

export function isPetAccessory(value: unknown): value is PetAccessory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set(['kind', 'color', 'assetKey']);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return false;
  if (!PET_ACCESSORY_KINDS.includes(candidate.kind as PetAccessoryKind)) return false;
  if (!PET_ACCESSORY_COLORS.includes(candidate.color as PetAccessoryColor)) return false;
  return candidate.assetKey === builtinAccessoryAssetKey(candidate.kind as PetAccessoryKind);
}

export function petAccessoryLabel(accessory?: PetAccessory): string {
  if (!accessory) return '소품 없음';
  return `${PET_ACCESSORY_COLOR_LABELS[accessory.color]} ${PET_ACCESSORY_KIND_LABELS[accessory.kind]}`;
}
