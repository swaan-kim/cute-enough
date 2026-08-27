import type { DailyAllowance, PetSummary, UnlockMethod } from '../types';
import { nextUnlockMethod } from './allowance';

export type PetAccessDecision =
  | { kind: 'reveal'; method: UnlockMethod }
  | { kind: 'revisit' }
  | { kind: 'characterOnly'; reason: 'pending' }
  | { kind: 'unavailable' }
  | { kind: 'exhausted' };

/**
 * 캐릭터와 노는 권한과 실제 사진을 여는 권한을 분리한다.
 * pending 사진은 정확히 해당 소유자의 미사용 업로드 보너스로만 공개한다.
 */
export function resolvePetAccess(
  pet: PetSummary,
  allowance: DailyAllowance,
  rewardedAdsEnabled = true,
): PetAccessDecision {
  if (pet.approvalStatus && ['rejected', 'paused', 'deleted'].includes(pet.approvalStatus)) {
    return { kind: 'unavailable' };
  }
  if (pet.revealedToday) return { kind: 'revisit' };
  if (pet.approvalStatus === 'pending') {
    const canUseUploadBonus = Boolean(
      pet.isMine
      && allowance.uploadCredit
      && !allowance.uploadUsed
      && allowance.uploadRewardPetId === pet.id,
    );
    return canUseUploadBonus
      ? { kind: 'reveal', method: 'UPLOAD' }
      : { kind: 'characterOnly', reason: 'pending' };
  }

  const method = nextUnlockMethod(allowance, pet.id, rewardedAdsEnabled);
  return method ? { kind: 'reveal', method } : { kind: 'exhausted' };
}
