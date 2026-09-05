import type { DailyProgress, OwnedPetSummary, PetSummary } from '../types';
import { isPetRevisitActive } from './petAccess';
import { hasPetPhoto } from './petPhoto';

/** 오늘 집에 고정되는 공개 강아지 수. 내 강아지는 이 제한과 별도다. */
export const HOUSE_PET_LIMIT = 4;
export const OWNER_HOUSE_LIMIT = 1;
export const HOUSE_VISIBLE_PET_LIMIT = HOUSE_PET_LIMIT + OWNER_HOUSE_LIMIT;

/** 재열람 기한이 남은 친구는 집의 제한된 자리에서 새 친구보다 먼저 보존한다. */
export function prioritizeRevealedPets<
  T extends Pick<PetSummary, 'revisitUntil' | 'revealedToday'>,
>(pets: T[], now = new Date()): T[] {
  return [
    ...pets.filter((pet) => isPetRevisitActive(pet, now)),
    ...pets.filter((pet) => !isPetRevisitActive(pet, now)),
  ];
}

function stablePoolScore(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 같은 사용자·같은 KST 날짜에는 항상 같은 순서이며 날짜가 바뀔 때만 섞인다. */
export function orderDailyPets<T extends Pick<PetSummary, 'id'>>(
  pets: T[],
  viewerKey: string,
  kstDate: string,
): T[] {
  return [...pets].sort((left, right) => {
    const leftScore = stablePoolScore(`daily-pool-v1:${viewerKey}:${kstDate}:${left.id}`);
    const rightScore = stablePoolScore(`daily-pool-v1:${viewerKey}:${kstDate}:${right.id}`);
    return leftScore - rightScore || left.id.localeCompare(right.id);
  });
}

/** 공개 친구 네 마리와 최신 내 강아지 한 마리를 중복 없이 합친다. */
export function composeHousePets(
  ownedPets: OwnedPetSummary[],
  publicPets: PetSummary[],
  publicLimit = HOUSE_PET_LIMIT,
): PetSummary[] {
  const eligibleOwnedPets = ownedPets
    .filter((pet) => hasPetPhoto(pet) && ['pending', 'approved'].includes(pet.approvalStatus))
    .map((pet, index) => ({
      ...pet,
      isMine: true,
      ownerPinned: index < OWNER_HOUSE_LIMIT,
      shareable: true,
    }));
  const primaryOwnedPet = eligibleOwnedPets[0];
  const eligiblePublicPets = publicPets
    .filter((pet) => hasPetPhoto(pet) && (!pet.approvalStatus || pet.approvalStatus === 'approved'))
    .map((pet) => ({
      ...pet,
      isMine: Boolean(pet.isMine),
      ownerPinned: false,
      approvalStatus: pet.approvalStatus ?? 'approved' as const,
      shareable: true,
    }));

  const result = primaryOwnedPet ? [{ ...primaryOwnedPet, ownerPinned: true }] : [];
  const occupiedIds = new Set(ownedPets.map((pet) => pet.id));
  const dailyPublicPets = prioritizeRevealedPets(
    eligiblePublicPets.filter((pet) => !pet.isMine && !occupiedIds.has(pet.id)),
  )
    .slice(0, Math.max(0, publicLimit));

  return [...result, ...dailyPublicPets];
}

/** 구버전 서버가 5슬롯 진행도를 보내도 현재 보이는 공개 4마리 기준으로 안전하게 정규화한다. */
export function normalizeDailyProgress(
  progress: DailyProgress | undefined,
  dailyPets: ReadonlyArray<Pick<PetSummary, 'id'>>,
  fallbackDate: string,
): DailyProgress {
  const visibleIds = new Set(dailyPets.slice(0, HOUSE_PET_LIMIT).map(({ id }) => id));
  const metPetIds = Array.from(new Set(
    (progress?.metPetIds ?? []).filter((petId) => visibleIds.has(petId)),
  )).slice(0, HOUSE_PET_LIMIT);
  // A viewed slot stays complete if moderation replaces its original dog.
  // Only legacy five-slot responses need their count rebuilt from visible IDs.
  const metCount = progress?.totalCount === HOUSE_PET_LIMIT && Number.isSafeInteger(progress.metCount)
    ? Math.min(HOUSE_PET_LIMIT, Math.max(metPetIds.length, progress.metCount, 0))
    : metPetIds.length;

  return {
    date: progress?.date || fallbackDate,
    metPetIds,
    metCount,
    totalCount: HOUSE_PET_LIMIT,
    completed: metCount >= HOUSE_PET_LIMIT,
  };
}
