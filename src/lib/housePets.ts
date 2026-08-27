import type { OwnedPetSummary, PetSummary } from '../types';
import { hasPetPhoto } from './petPhoto';

export const HOUSE_PET_LIMIT = 5;
export const OWNER_HOUSE_LIMIT = 1;

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

/** 최신 내 강아지 한 마리를 먼저 보여주고, 고정된 일일 순서의 공개 친구로 총 다섯 자리를 채운다. */
export function composeHousePets(
  ownedPets: OwnedPetSummary[],
  publicPets: PetSummary[],
  limit = HOUSE_PET_LIMIT,
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
  const occupiedIds = new Set(result.map((pet) => pet.id));
  const publicSlots = Math.max(0, limit - result.length);
  const dailyPublicPets = eligiblePublicPets
    .filter((pet) => !occupiedIds.has(pet.id))
    .slice(0, publicSlots);

  return [...result, ...dailyPublicPets];
}
