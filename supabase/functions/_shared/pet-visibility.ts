export const OWNER_VISIBLE_PET_STATUSES = ['pending', 'approved'] as const;
export const SHARED_CHARACTER_PET_STATUSES = ['pending', 'approved'] as const;

type VisiblePetStatus = typeof SHARED_CHARACTER_PET_STATUSES[number];

export function isSharedCharacterStatus(status: unknown): status is VisiblePetStatus {
  return status === 'pending' || status === 'approved';
}

export function isShareablePetStatus(status: unknown): status is VisiblePetStatus {
  return isSharedCharacterStatus(status);
}

/**
 * 실제 사진 공개는 승인 상태가 기본이다.
 * pending 예외는 서버가 소유자를 확인했고 업로드 보너스/충전 전 재열람처럼
 * 명시적으로 allowPendingOwner를 넘긴 경우에만 허용한다.
 */
export function canRevealStoredPetPhoto({
  status,
  isOwner,
  allowPendingOwner,
}: {
  status: unknown;
  isOwner: boolean;
  allowPendingOwner: boolean;
}): boolean {
  return status === 'approved' || (status === 'pending' && isOwner && allowPendingOwner);
}

export function wasPetRevealedToday(petId: string, revealedPetIds: ReadonlySet<string>): boolean {
  return revealedPetIds.has(petId);
}

/** 서버가 발급한 다시보기 만료 시각만 신뢰해 현재 사진 재열람 가능 여부를 판단한다. */
export function isRevisitActive(revisitUntil: unknown, now = Date.now()): boolean {
  if (typeof revisitUntil !== 'string') return false;
  const expiresAt = new Date(revisitUntil).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}
