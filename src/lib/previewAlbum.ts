import type { AlbumPetSummary, PetPhotoCollection, PetSummary, PhotoIntent } from '../types';
import { getKstDate } from './allowance';
import { getPetPhotoUrls } from './petPhoto';

const KEY = 'cute-enough:preview-album:v1';
type Grant = { petId: string; photoId: string; unlockedAt: string; source: 'reveal' | 'legacy_gift' };
type State = {
  grants: Grant[]; favorites: string[]; requests: Record<string, string>;
  requestIntents: Record<string, PhotoIntent>; lastReplays: Record<string, string>;
};
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function read(storage: Store): State {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? 'null') as State | null;
    if (value && Array.isArray(value.grants) && Array.isArray(value.favorites)) {
      return { ...value, requests: value.requests ?? {}, requestIntents: value.requestIntents ?? {}, lastReplays: value.lastReplays ?? {} };
    }
  } catch { /* A malformed preview cache must not break the screen. */ }
  return { grants: [], favorites: [], requests: {}, requestIntents: {}, lastReplays: {} };
}

export function previewPhotos(pet: PetSummary) {
  return getPetPhotoUrls(pet).map((url) => {
    let hash = 2166136261;
    for (const char of url) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return { photoId: `${pet.id}:${hash.toString(16)}`, url, photoCaption: undefined as string | undefined };
  });
}

function publicPet(pet: PetSummary) {
  return !pet.isMine && (!pet.approvalStatus || pet.approvalStatus === 'approved');
}

export function grantPreviewPhoto(pet: PetSummary, photoId: string, storage: Store, requestId?: string, source: Grant['source'] = 'reveal') {
  if (!publicPet(pet) || !previewPhotos(pet).some((photo) => photo.photoId === photoId)) throw new Error('이 사진은 지금 만날 수 없어요.');
  const state = read(storage);
  if (requestId && state.requests[requestId] && state.requests[requestId] !== photoId) throw new Error('이 요청은 이미 다른 사진으로 완료됐어요.');
  if (!state.grants.some((grant) => grant.photoId === photoId)) {
    state.grants.push({ petId: pet.id, photoId, unlockedAt: new Date().toISOString(), source });
  }
  if (requestId) state.requests[requestId] = photoId;
  if (requestId) state.requestIntents[requestId] = 'collect';
  if (source === 'reveal') state.lastReplays[pet.id] = photoId;
  storage.setItem(KEY, JSON.stringify(state));
}

/** 이전 미리보기의 강아지별 기록도 대표 사진 선물로 한 번만 이어 준다. */
export function importPreviewAlbumGifts(pets: PetSummary[], storage: Store) {
  let petIds: string[] = [];
  try {
    const legacy = JSON.parse(storage.getItem('cute-enough:preview-reveals') ?? '[]');
    petIds = Array.isArray(legacy) ? legacy.map((item: { petId: string }) => item.petId) : legacy.petIds ?? [];
  } catch { return; }
  const existing = read(storage);
  for (const pet of pets) {
    if (!publicPet(pet) || !petIds.includes(pet.id) || existing.grants.some((grant) => grant.petId === pet.id)) continue;
    const photo = previewPhotos(pet)[0];
    if (photo) grantPreviewPhoto(pet, photo.photoId, storage, undefined, 'legacy_gift');
  }
}

export function previewPhotoCollection(pet: PetSummary, storage: Store, isInTodayHouse = false, now = new Date()): PetPhotoCollection {
  const state = read(storage);
  const available = publicPet(pet) ? new Set(previewPhotos(pet).map((photo) => photo.photoId)) : new Set<string>();
  const owned = state.grants.filter((grant) => grant.petId === pet.id);
  const collected = owned.filter((grant) => available.has(grant.photoId));
  // A withdrawn photo still used today's collection slot. Gifts never use it.
  const today = owned.filter((grant) => grant.source === 'reveal' && getKstDate(new Date(grant.unlockedAt)) === getKstDate(now))
    .sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt) || b.photoId.localeCompare(a.photoId))[0];
  return {
    collectedCount: collected.length, totalCount: available.size, collectedToday: publicPet(pet) && Boolean(today),
    canCollectToday: publicPet(pet) && !today && available.size > collected.length && (owned.length === 0 || isInTodayHouse),
    todayPhotoId: today && available.has(today.photoId) ? today.photoId : undefined,
  };
}

export function previewAlbumEntries(pets: PetSummary[], storage: Store, todayPetIds: ReadonlySet<string> = new Set(), adoptLegacy = true): AlbumPetSummary[] {
  if (adoptLegacy) importPreviewAlbumGifts(pets, storage);
  const state = read(storage);
  return pets.filter(publicPet).flatMap((pet) => {
    const available = new Set(previewPhotos(pet).map((photo) => photo.photoId));
    const unlockedPhotos = state.grants.filter((grant) => grant.petId === pet.id && available.has(grant.photoId))
      .sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt) || b.photoId.localeCompare(a.photoId));
    return unlockedPhotos.length ? [{ ...pet, approvalStatus: 'approved' as const, shareable: true, photoAvailable: true, isFavorite: state.favorites.includes(pet.id),
      unlockedPhotoCount: unlockedPhotos.length, hasUnseenPhotos: available.size > unlockedPhotos.length,
      albumPhotoId: unlockedPhotos[0].photoId, collection: previewPhotoCollection(pet, storage, todayPetIds.has(pet.id)), unlockedPhotos }] : [];
  }).sort((a, b) => b.unlockedPhotos[0].unlockedAt.localeCompare(a.unlockedPhotos[0].unlockedAt) || a.id.localeCompare(b.id));
}

export function decoratePreviewAlbumPet<T extends PetSummary>(pet: T, storage: Store, isInTodayHouse = false): T {
  const entry = previewAlbumEntries([pet], storage)[0];
  return { ...pet, isFavorite: entry?.isFavorite ?? false, unlockedPhotoCount: entry?.unlockedPhotoCount ?? 0,
    hasUnseenPhotos: publicPet(pet) && (entry?.hasUnseenPhotos ?? previewPhotos(pet).length > 0), albumPhotoId: entry?.albumPhotoId,
    collection: previewPhotoCollection(pet, storage, isInTodayHouse) };
}

/** Choose before consuming a ticket. Replays never create a new grant. */
export function selectPreviewPhoto(pet: PetSummary, intent: PhotoIntent, storage: Store, isInTodayHouse: boolean, requestId: string) {
  const entry = previewAlbumEntries([pet], storage)[0];
  const state = read(storage);
  const previousRequest = state.requests[requestId];
  if (previousRequest) {
    if (state.requestIntents[requestId] && state.requestIntents[requestId] !== intent) throw new Error('이전 사진 요청과 다른 내용이에요.');
    const { photo } = getPreviewAlbumPhoto(pet, previousRequest, storage);
    return { photo, needsTicket: false };
  }
  if (!publicPet(pet)) throw new Error('이 사진은 지금 만날 수 없어요.');
  const collection = previewPhotoCollection(pet, storage, isInTodayHouse);
  const photos = previewPhotos(pet);
  const owned = photos.filter((photo) => entry?.unlockedPhotos.some((grant) => grant.photoId === photo.photoId));
  if (collection.collectedToday) {
    const photo = photos.find((item) => item.photoId === collection.todayPhotoId) ?? owned.find((item) => item.photoId === entry?.albumPhotoId);
    if (!photo) throw new Error('지금은 이 사진을 볼 수 없어요.');
    return { photo, needsTicket: false };
  }
  if (intent === 'collect') {
    if (state.grants.some((grant) => grant.petId === pet.id) && !isInTodayHouse) throw new Error('다른 사진은 오늘 집에 온 날 만날 수 있어요.');
    const photo = photos.find((item) => !entry?.unlockedPhotos.some((grant) => grant.photoId === item.photoId));
    if (!photo) throw new Error('이 친구의 사진을 모두 모았어요.');
    return { photo, needsTicket: true };
  }
  if (!owned.length) throw new Error('아직 만나지 않은 사진이에요.');
  if (collection.collectedCount < collection.totalCount) {
    return { photo: owned.find((item) => item.photoId === entry?.albumPhotoId) ?? owned[0], needsTicket: false };
  }
  const last = state.lastReplays[pet.id];
  const index = owned.findIndex((photo) => photo.photoId === last);
  return { photo: owned[(index + 1) % owned.length], needsTicket: false };
}

export function rememberPreviewPhotoRequest(pet: PetSummary, photoId: string, intent: PhotoIntent, requestId: string, storage: Store) {
  getPreviewAlbumPhoto(pet, photoId, storage);
  const state = read(storage);
  if (state.requests[requestId]) {
    if (state.requests[requestId] !== photoId || (state.requestIntents[requestId] && state.requestIntents[requestId] !== intent)) {
      throw new Error('이전 사진 요청과 다른 내용이에요.');
    }
    return;
  }
  state.requests[requestId] = photoId;
  state.requestIntents[requestId] = intent;
  state.lastReplays[pet.id] = photoId;
  storage.setItem(KEY, JSON.stringify(state));
}

export function previewPhotoForRequest(requestId: string | undefined, storage: Store): string | undefined {
  return requestId ? read(storage).requests[requestId] : undefined;
}

export function getPreviewAlbumPhoto(pet: PetSummary, photoId: string, storage: Store) {
  const entry = previewAlbumEntries([pet], storage)[0];
  if (!entry?.unlockedPhotos.some((photo) => photo.photoId === photoId)) throw new Error('아직 만나지 않은 사진이에요.');
  const photo = previewPhotos(pet).find((item) => item.photoId === photoId);
  if (!photo) throw new Error('이 사진은 지금 쉬고 있어요.');
  return { photo, entry };
}

export function setPreviewFavorite(pet: PetSummary, isFavorite: boolean, storage: Store) {
  if (isFavorite && !previewAlbumEntries([pet], storage)[0]) throw new Error('사진을 만난 뒤 마음에 담을 수 있어요.');
  const state = read(storage);
  state.favorites = state.favorites.filter((id) => id !== pet.id);
  if (isFavorite) state.favorites.push(pet.id);
  storage.setItem(KEY, JSON.stringify(state));
  return { petId: pet.id, isFavorite, favoriteCount: Number(isFavorite) };
}
