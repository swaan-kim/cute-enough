import type { PetSummary } from '../types';

function hashText(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function getPetPhotoUrls(pet: PetSummary): string[] {
  const candidates = pet.photoUrls?.filter((url) => typeof url === 'string' && url.trim().length > 0) ?? [];
  const urls = candidates.length > 0
    ? candidates
    : typeof pet.photoUrl === 'string' && pet.photoUrl.trim().length > 0 ? [pet.photoUrl] : [];
  return [...new Set(urls)];
}

/** 미리보기의 직접 URL 또는 운영 서버가 확인한 비공개 사진이 있어야 집에 노출해요. */
export function hasPetPhoto(pet: PetSummary): boolean {
  return pet.photoAvailable === true || getPetPhotoUrls(pet).length > 0;
}

/** 같은 사용자·강아지·날짜에는 같은 실사가 보여 재시도 중 사진이 바뀌지 않아요. */
export function selectPetPhotoUrl(pet: PetSummary, date: string, viewerKey: string): string | undefined {
  const urls = getPetPhotoUrls(pet);
  if (urls.length <= 1) return urls[0];
  return urls[hashText(`photo-v1:${pet.id}:${viewerKey}:${date}`) % urls.length];
}
