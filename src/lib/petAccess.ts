import type { DailyAllowance, PetSummary, UnlockMethod } from '../types';
import { nextUnlockMethod } from './allowance';

export type PetAccessDecision =
  | { kind: 'reveal'; method: UnlockMethod }
  | { kind: 'ownerPhoto' }
  | { kind: 'revisit' }
  | { kind: 'characterOnly'; reason: 'pending' }
  | { kind: 'unavailable' }
  | { kind: 'exhausted' };

/** 시간 기반 권한을 우선하고, 만료 시각이 없는 구버전 응답만 당일 표시로 호환한다. */
export function isPetRevisitActive(
  pet: Pick<PetSummary, 'revisitUntil' | 'revealedToday'>,
  now = new Date(),
): boolean {
  if (pet.revisitUntil !== undefined) {
    const revisitUntil = new Date(pet.revisitUntil).getTime();
    return Number.isFinite(revisitUntil) && revisitUntil > now.getTime();
  }
  return Boolean(pet.revealedToday);
}

/**
 * 캐릭터와 노는 권한과 실제 사진을 여는 권한을 분리한다.
 * pending 사진은 서버가 소유권을 확인해 ownerPhotoAvailable을 준 업로더에게만 공개한다.
 */
export function resolvePetAccess(
  pet: PetSummary,
  allowance: DailyAllowance,
  rewardedAdsEnabled = true,
  now = new Date(),
): PetAccessDecision {
  if (pet.approvalStatus && ['rejected', 'paused', 'deleted'].includes(pet.approvalStatus)) {
    return { kind: 'unavailable' };
  }
  if (
    pet.isMine
    && pet.ownerPhotoAvailable
    && (!pet.approvalStatus || ['pending', 'approved'].includes(pet.approvalStatus))
  ) return { kind: 'ownerPhoto' };
  // 구버전 서버에서 ownerPhotoAvailable을 아직 내려주지 않는 등록 직후만
  // 기존 1회 업로드 공개권으로 안전하게 호환한다.
  const canUseUploadBonus = Boolean(
    pet.isMine
    && allowance.uploadCredit
    && !allowance.uploadUsed
    && allowance.uploadRewardPetId === pet.id,
  );
  if (canUseUploadBonus) return { kind: 'reveal', method: 'UPLOAD' };
  if (isPetRevisitActive(pet, now)) return { kind: 'revisit' };
  if (pet.approvalStatus === 'pending') return { kind: 'characterOnly', reason: 'pending' };

  const method = nextUnlockMethod(allowance, pet.id, rewardedAdsEnabled, now);
  return method ? { kind: 'reveal', method } : { kind: 'exhausted' };
}
