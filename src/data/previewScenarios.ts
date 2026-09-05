import type { DailyAllowance, OwnedPetSummary, PetSummary } from '../types';
import { FREE_RECHARGE_INTERVAL_MS } from '../lib/allowance';

export type PreviewScenario = 'first-user' | 'four' | 'five' | 'owner' | 'complete' | 'ads-off';

// `five`는 이전에 공유한 미리보기 주소를 깨뜨리지 않기 위한 별칭이다.
const PREVIEW_SCENARIOS = new Set<PreviewScenario>(['first-user', 'four', 'five', 'owner', 'complete', 'ads-off']);

/**
 * URL 시나리오는 웹 미리보기에서만 읽는다. 운영 런타임은 이 모듈을 호출하지 않으므로
 * 아래 fixture가 Supabase나 Apps in Toss 응답을 대신할 수 없다.
 */
export function getPreviewScenario(search = typeof window === 'undefined' ? '' : window.location.search): PreviewScenario | undefined {
  const candidate = new URLSearchParams(search).get('scenario') as PreviewScenario | null;
  return candidate && PREVIEW_SCENARIOS.has(candidate) ? candidate : undefined;
}

export const PREVIEW_SCENARIO_PETS: PetSummary[] = [
  {
    id: 'preview-fixture-1', name: '샘플1', houseSlot: 1,
    photoUrl: '/sample-pets/haneul-01.jpg',
    photoUrls: ['/sample-pets/haneul-01.jpg', '/sample-pets/haneul-02.jpg'],
    traits: { schemaVersion: 1, earShape: 'upright', headShape: 'oval', baseColor: 'cream', secondaryColor: 'white', markingPattern: 'blaze', muzzle: 'short', confidence: 1 },
  },
  {
    id: 'preview-fixture-2', name: '샘플2', houseSlot: 2,
    photoUrl: '/sample-pets/gureumi-01.jpg',
    photoUrls: ['/sample-pets/gureumi-01.jpg', '/sample-pets/gureumi-02.jpg'],
    traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'medium', confidence: 1 },
  },
  {
    id: 'preview-fixture-3', name: '샘플3', houseSlot: 3,
    photoUrl: '/sample-pets/byeori.jpg',
    traits: { schemaVersion: 1, earShape: 'semi', headShape: 'round', baseColor: 'caramel', secondaryColor: 'white', markingPattern: 'spots', muzzle: 'short', confidence: 1 },
    publishedStyle: { schemaVersion: 1, coatMode: 'point', furStyle: 'fluffy' },
  },
  {
    id: 'preview-fixture-4', name: '샘플4', houseSlot: 4,
    photoUrl: '/sample-pets/mongsil.jpg',
    traits: { schemaVersion: 1, earShape: 'rounded', headShape: 'oval', baseColor: 'gray', secondaryColor: 'white', markingPattern: 'mask', muzzle: 'medium', confidence: 1 },
    publishedStyle: { schemaVersion: 1, coatMode: 'point', furStyle: 'cloud' },
  },
  {
    id: 'preview-fixture-5', name: '샘플5', houseSlot: 5,
    photoUrl: '/sample-pets/gureumi-03.jpg',
    traits: { schemaVersion: 1, earShape: 'upright', headShape: 'long', baseColor: 'chocolate', secondaryColor: 'cream', markingPattern: 'brow', muzzle: 'long', confidence: 1 },
    publishedStyle: { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' },
  },
];

/** 첫 방문 화면 검수용: 실제 사진 자산과 이름을 짝지어 `샘플` 표기를 노출하지 않는다. */
export const PREVIEW_FIRST_USER_PETS: PetSummary[] = [
  { ...PREVIEW_SCENARIO_PETS[0], name: '하늘' },
  { ...PREVIEW_SCENARIO_PETS[1], name: '구르미' },
  { ...PREVIEW_SCENARIO_PETS[2], name: '별이' },
  { ...PREVIEW_SCENARIO_PETS[3], name: '몽실' },
];

export const PREVIEW_SCENARIO_OWNER_PET: OwnedPetSummary = {
  id: 'preview-fixture-owner', name: '내 샘플',
  photoUrl: '/sample-pets/gureumi.jpg',
  traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 },
  publishedStyle: { schemaVersion: 1, coatMode: 'solid', furStyle: 'fluffy' },
  isMine: true,
  ownerPhotoAvailable: true,
  ownerPinned: true,
  approvalStatus: 'pending',
  shareable: true,
  createdAt: '2026-09-04T00:00:00.000Z',
};

export function getScenarioPublicPets(scenario: PreviewScenario | undefined): PetSummary[] | undefined {
  if (scenario === 'first-user') return PREVIEW_FIRST_USER_PETS;
  return scenario ? PREVIEW_SCENARIO_PETS : undefined;
}

export function getScenarioOwnerPet(scenario: PreviewScenario | undefined): OwnedPetSummary | undefined {
  return scenario === 'owner' ? PREVIEW_SCENARIO_OWNER_PET : undefined;
}

export function getCompleteScenarioRevisitUntil(scenario: PreviewScenario | undefined, now: Date): string | undefined {
  return scenario === 'complete'
    ? new Date(now.getTime() + FREE_RECHARGE_INTERVAL_MS).toISOString()
    : undefined;
}

export function applyScenarioAllowance(
  scenario: PreviewScenario | undefined,
  allowance: DailyAllowance,
  now: Date,
): DailyAllowance {
  if (scenario !== 'ads-off' && scenario !== 'complete') return allowance;
  return {
    ...allowance,
    freeUsed: 2,
    remaining: 0,
    nextChargeAt: new Date(now.getTime() + FREE_RECHARGE_INTERVAL_MS).toISOString(),
    rewardedUsed: scenario === 'complete' ? 2 : 0,
    rewardedLimit: scenario === 'ads-off' ? 0 : 2,
    rewardedRemaining: 0,
  };
}

type ScenarioStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 시나리오 조작이 평소 웹 데모의 이용권·업로드·재열람 기록을 건드리지 않게 한다. */
export function getScenarioStorage(
  scenario: PreviewScenario | undefined,
  storage: ScenarioStorage = localStorage,
): ScenarioStorage {
  if (!scenario) return storage;
  const prefix = `cute-enough:preview-scenario:${scenario}:`;
  return {
    getItem: (key) => storage.getItem(`${prefix}${key}`),
    setItem: (key, value) => storage.setItem(`${prefix}${key}`, value),
    removeItem: (key) => storage.removeItem(`${prefix}${key}`),
  };
}
