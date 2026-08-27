import type { DailyAllowance, UnlockMethod } from '../types';

export const DAILY_FREE_PETS = 2;
export const FREE_ALLOWANCE_CAPACITY = DAILY_FREE_PETS;
export const FREE_RECHARGE_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const MAX_REWARDED_PER_DAY = 2;
const STORAGE_KEY = 'cute-enough:allowance';

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

export function getKstDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  return `${datePart(parts, 'year')}-${datePart(parts, 'month')}-${datePart(parts, 'day')}`;
}

export function millisecondsUntilNextKstDay(now = new Date()): number {
  const kstOffset = 9 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + kstOffset);
  const nextMidnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  ) - kstOffset;
  return Math.max(0, nextMidnightUtc - now.getTime());
}

export function isAllowanceForToday(allowance: DailyAllowance, now = new Date()): boolean {
  return allowance.date === getKstDate(now);
}

export function emptyAllowance(now = new Date()): DailyAllowance {
  return {
    date: getKstDate(now),
    freeUsed: 0,
    remaining: FREE_ALLOWANCE_CAPACITY,
    rewardedUsed: 0,
    uploadCredit: false,
    uploadUsed: false,
  };
}

function normalizeFreeUsed(value: unknown): number {
  // 구버전은 boolean으로 저장했으므로 같은 날 업데이트해도 사용 내역을 잃지 않는다.
  if (typeof value === 'boolean') return value ? 1 : 0;
  return Math.max(0, Math.min(DAILY_FREE_PETS, Number(value) || 0));
}

function storedFreeRemaining(allowance: Pick<DailyAllowance, 'freeUsed' | 'remaining'>): number {
  if (typeof allowance.remaining === 'number' && Number.isFinite(allowance.remaining)) {
    return Math.max(0, Math.min(FREE_ALLOWANCE_CAPACITY, Math.floor(allowance.remaining)));
  }
  return FREE_ALLOWANCE_CAPACITY - normalizeFreeUsed(allowance.freeUsed);
}

/** 저장된 토큰 버킷을 현재 시각까지 당겨 온다. 운영에서는 서버가 같은 계산을 권위 있게 수행한다. */
export function refreshAllowance(allowance: DailyAllowance, now = new Date()): DailyAllowance {
  let freeRemaining = storedFreeRemaining(allowance);
  let nextChargeAt = allowance.nextChargeAt;

  if (freeRemaining >= FREE_ALLOWANCE_CAPACITY) {
    freeRemaining = FREE_ALLOWANCE_CAPACITY;
    nextChargeAt = undefined;
  } else {
    const parsedNext = nextChargeAt ? new Date(nextChargeAt).getTime() : Number.NaN;
    if (!Number.isFinite(parsedNext)) {
      nextChargeAt = new Date(now.getTime() + FREE_RECHARGE_INTERVAL_MS).toISOString();
    } else if (now.getTime() >= parsedNext) {
      const gained = 1 + Math.floor((now.getTime() - parsedNext) / FREE_RECHARGE_INTERVAL_MS);
      freeRemaining = Math.min(FREE_ALLOWANCE_CAPACITY, freeRemaining + gained);
      nextChargeAt = freeRemaining >= FREE_ALLOWANCE_CAPACITY
        ? undefined
        : new Date(parsedNext + gained * FREE_RECHARGE_INTERVAL_MS).toISOString();
    }
  }

  const today = getKstDate(now);
  const newKstDay = allowance.date !== today;
  return {
    ...allowance,
    date: today,
    freeUsed: FREE_ALLOWANCE_CAPACITY - freeRemaining,
    remaining: freeRemaining,
    nextChargeAt,
    rewardedUsed: newKstDay ? 0 : Math.max(0, Math.min(MAX_REWARDED_PER_DAY, Number(allowance.rewardedUsed) || 0)),
    uploadCredit: newKstDay ? false : Boolean(allowance.uploadCredit),
    uploadUsed: newKstDay ? false : Boolean(allowance.uploadUsed),
    uploadRewardPetId: newKstDay ? undefined : allowance.uploadRewardPetId,
  };
}

export function readAllowance(storage: Pick<Storage, 'getItem'> = localStorage, now = new Date()): DailyAllowance {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as DailyAllowance | null;
    if (stored?.date) {
      return refreshAllowance({
        date: stored.date,
        freeUsed: normalizeFreeUsed(stored.freeUsed),
        remaining: storedFreeRemaining(stored),
        nextChargeAt: typeof stored.nextChargeAt === 'string' ? stored.nextChargeAt : undefined,
        rewardedUsed: Math.max(0, Math.min(MAX_REWARDED_PER_DAY, Number(stored.rewardedUsed) || 0)),
        uploadCredit: Boolean(stored.uploadCredit),
        uploadUsed: Boolean(stored.uploadUsed),
        uploadRewardPetId: typeof stored.uploadRewardPetId === 'string' ? stored.uploadRewardPetId : undefined,
      }, now);
    }
  } catch { /* corrupted local demo state resets safely */ }
  return emptyAllowance(now);
}

export function nextUnlockMethod(
  allowance: DailyAllowance,
  petId?: string,
  rewardedAdsEnabled = true,
  now = new Date(),
): UnlockMethod | null {
  if (allowance.uploadCredit && !allowance.uploadUsed && allowance.uploadRewardPetId === petId) return 'UPLOAD';
  if (regularRemainingCount(allowance, now) > 0) return 'FREE';
  if (rewardedAdsEnabled && allowance.rewardedUsed < MAX_REWARDED_PER_DAY) return 'REWARDED';
  return null;
}

export function consumeAllowance(
  allowance: DailyAllowance,
  method: UnlockMethod,
  now = new Date(),
): DailyAllowance {
  if (method === 'FREE') {
    const current = refreshAllowance(allowance, now);
    const remaining = storedFreeRemaining(current);
    if (remaining <= 0) throw new Error('이용권은 3시간마다 한 마리씩 충전돼요.');
    const freeRemaining = remaining - 1;
    return {
      ...current,
      freeUsed: FREE_ALLOWANCE_CAPACITY - freeRemaining,
      remaining: freeRemaining,
      nextChargeAt: current.nextChargeAt ?? new Date(now.getTime() + FREE_RECHARGE_INTERVAL_MS).toISOString(),
    };
  }
  if (method === 'UPLOAD') {
    if (!allowance.uploadCredit || allowance.uploadUsed) throw new Error('사진 등록으로 받은 만남을 이미 사용했어요.');
    return { ...allowance, uploadUsed: true };
  }
  if (allowance.rewardedUsed >= MAX_REWARDED_PER_DAY) {
    throw new Error('오늘의 귀여움은 여기까지예요.');
  }
  return { ...allowance, rewardedUsed: allowance.rewardedUsed + 1 };
}

export function saveAllowance(allowance: DailyAllowance, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(allowance));
}

export function resetStoredAllowance(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}

export function grantUploadCredit(allowance: DailyAllowance, petId: string): DailyAllowance {
  return { ...allowance, uploadCredit: true, uploadUsed: false, uploadRewardPetId: petId };
}

/** 홈에 표시할 기본 무료 잔여 횟수. 광고·업로드 보너스는 충전량에 합산하지 않는다. */
export function regularRemainingCount(allowance: DailyAllowance, now = new Date()): number {
  return storedFreeRemaining(refreshAllowance(allowance, now));
}

export function millisecondsUntilNextFreeRecharge(allowance: DailyAllowance, now = new Date()): number | null {
  const current = refreshAllowance(allowance, now);
  if (storedFreeRemaining(current) >= FREE_ALLOWANCE_CAPACITY || !current.nextChargeAt) return null;
  return Math.max(0, new Date(current.nextChargeAt).getTime() - now.getTime());
}

export function hasUploadBonus(allowance: DailyAllowance): boolean {
  return Boolean(allowance.uploadCredit && !allowance.uploadUsed && allowance.uploadRewardPetId);
}

/** 지금 바로 쓸 수 있는 기본 무료 횟수와 업로드 전용 보너스의 합. 광고 기회는 포함하지 않는다. */
export function remainingCount(allowance: DailyAllowance, now = new Date()): number {
  return regularRemainingCount(allowance, now) + (hasUploadBonus(allowance) ? 1 : 0);
}
