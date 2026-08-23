import type { DailyAllowance, UnlockMethod } from '../types';

export const MAX_REWARDED_PER_DAY = 2;
export const MAX_REGULAR_PETS_PER_DAY = 1 + MAX_REWARDED_PER_DAY;
const STORAGE_KEY = 'cute-enough:allowance';

export function getKstDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function emptyAllowance(now = new Date()): DailyAllowance {
  return { date: getKstDate(now), freeUsed: false, rewardedUsed: 0, uploadCredit: false, uploadUsed: false };
}

export function readAllowance(storage: Pick<Storage, 'getItem'> = localStorage, now = new Date()): DailyAllowance {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as DailyAllowance | null;
    if (stored?.date === getKstDate(now)) {
      return {
        date: stored.date,
        freeUsed: Boolean(stored.freeUsed),
        rewardedUsed: Math.max(0, Math.min(MAX_REWARDED_PER_DAY, Number(stored.rewardedUsed) || 0)),
        uploadCredit: Boolean(stored.uploadCredit),
        uploadUsed: Boolean(stored.uploadUsed),
        uploadRewardPetId: typeof stored.uploadRewardPetId === 'string' ? stored.uploadRewardPetId : undefined,
      };
    }
  } catch { /* corrupted local demo state resets safely */ }
  return emptyAllowance(now);
}

export function nextUnlockMethod(
  allowance: DailyAllowance,
  petId?: string,
  rewardedAdsEnabled = true,
): UnlockMethod | null {
  if (allowance.uploadCredit && !allowance.uploadUsed && allowance.uploadRewardPetId === petId) return 'UPLOAD';
  if (!allowance.freeUsed) return 'FREE';
  if (rewardedAdsEnabled && allowance.rewardedUsed < MAX_REWARDED_PER_DAY) return 'REWARDED';
  return null;
}

export function consumeAllowance(
  allowance: DailyAllowance,
  method: UnlockMethod,
): DailyAllowance {
  if (method === 'FREE') {
    if (allowance.freeUsed) throw new Error('오늘의 무료 사진을 이미 봤어요.');
    return { ...allowance, freeUsed: true };
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

export function grantUploadCredit(allowance: DailyAllowance, petId: string): DailyAllowance {
  return { ...allowance, uploadCredit: true, uploadUsed: false, uploadRewardPetId: petId };
}

/** 홈의 일반 잔여 횟수. 업로드 보너스는 별도 배지로 보여준다. */
export function regularRemainingCount(allowance: DailyAllowance, rewardedAdsEnabled = true): number {
  return (allowance.freeUsed ? 0 : 1)
    + (rewardedAdsEnabled ? Math.max(0, MAX_REWARDED_PER_DAY - allowance.rewardedUsed) : 0);
}

export function hasUploadBonus(allowance: DailyAllowance): boolean {
  return Boolean(allowance.uploadCredit && !allowance.uploadUsed && allowance.uploadRewardPetId);
}

/** 실제로 입장 가능한 전체 횟수. 홈 표기에는 regularRemainingCount를 사용한다. */
export function remainingCount(allowance: DailyAllowance): number {
  return regularRemainingCount(allowance) + (hasUploadBonus(allowance) ? 1 : 0);
}
