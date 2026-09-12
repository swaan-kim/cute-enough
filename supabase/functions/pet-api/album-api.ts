import { ApiError } from '../_shared/api-error.ts';
import { rewardRpcError } from '../_shared/reward-api.ts';
import { requireUuid } from '../_shared/validation.ts';

type RpcError = { message?: string; code?: string };
type RpcResult = { data: unknown; error: RpcError | null };
export interface AlbumClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  storage: { from(bucket: string): {
    createSignedUrl(path: string, expiresIn: number): PromiseLike<{
      data: { signedUrl: string } | null; error: RpcError | null;
    }>;
  } };
}

export type AlbumState = {
  petId: string;
  isFavorite: boolean;
  unlockedPhotoCount: number;
  hasUnseenPhotos: boolean;
  albumPhotoId?: string;
  favoriteCount: number;
  collection?: {
    collectedCount: number; totalCount: number; collectedToday: boolean;
    canCollectToday: boolean; todayPhotoId?: string | null;
  };
};
type AlbumCursor = { at: string; id: string };
type AuthorizedPhoto = { petId: string; photoId: string; storagePath: string; photoCaption?: string | null };
type AlbumItem = {
  pet: Record<string, unknown> & { id: string };
  unlockedPhotos: Array<{ photoId: string; unlockedAt: string; source: 'reveal' | 'legacy_gift' }>;
  unlockedPhotoCount: number;
  lastUnlockedAt: string;
  isFavorite: boolean;
};

export function albumRpcError(error: RpcError): ApiError {
  const known: Array<[string, number, string]> = [
    ['ALBUM_PHOTO_UNAVAILABLE', 404, '지금은 이 사진을 볼 수 없어요.'],
    ['ALBUM_PET_NOT_TODAY', 409, '오늘 집에서 만난 친구의 다른 사진을 볼 수 있어요.'],
    ['ALBUM_ALL_PHOTOS_UNLOCKED', 409, '이 친구의 사진을 모두 모았어요.'],
    ['FAVORITE_PHOTO_REQUIRED', 403, '사진을 만난 친구만 마음에 담을 수 있어요.'],
    ['DAILY_PHOTO_ALREADY_COLLECTED', 409, '오늘의 사진을 이미 모았어요. 내일 새로운 모습을 만나보세요.'],
    ['INVALID_ALBUM_INPUT', 400, '앨범 요청을 다시 확인해 주세요.'],
    ['ALBUM_PHOTO_FORBIDDEN', 403, '아직 만나지 않은 사진이에요.'],
    ['PHOTO_NOT_UNLOCKED', 403, '아직 만나지 않은 사진이에요.'],
    ['PHOTO_NOT_AVAILABLE', 404, '지금은 이 사진을 볼 수 없어요.'],
    ['PHOTO_NOT_REVEALABLE', 404, '지금은 이 사진을 볼 수 없어요.'],
    ['PET_NOT_IN_TODAY_HOUSE', 409, '오늘 집에서 만난 친구의 다른 사진을 볼 수 있어요.'],
    ['PET_NOT_ASSIGNED_TODAY', 409, '오늘 집에서 만난 친구의 다른 사진을 볼 수 있어요.'],
    ['ALL_PHOTOS_UNLOCKED', 409, '이 친구의 사진을 모두 모았어요.'],
    ['FAVORITE_NOT_ALLOWED', 403, '사진을 만난 친구만 마음에 담을 수 있어요.'],
    ['FAVORITE_REQUIRES_PHOTO', 403, '먼저 이 친구의 사진을 만나보세요.'],
    ['SELF_FAVORITE_FORBIDDEN', 403, '내 강아지에게는 하트를 보낼 수 없어요.'],
    ['OWNER_PHOTO_FREE', 409, '내 강아지는 티켓 없이 바로 볼 수 있어요.'],
    ['PHOTO_SELECTION_CHANGED', 409, '사진 정보가 바뀌었어요. 다시 선택해 주세요.'],
  ];
  for (const [code, status, message] of known) {
    if (error.message?.includes(code)) return new ApiError(code, status, message);
  }
  return rewardRpcError(error);
}

function cursorInput(value: unknown): AlbumCursor | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/'))) as AlbumCursor;
    const id = requireUuid(parsed.id);
    if (typeof parsed.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.at)
      || !Number.isFinite(Date.parse(parsed.at))) throw new Error();
    return { at: parsed.at, id };
  } catch {
    throw new ApiError('INVALID_ALBUM_CURSOR', 400, '앨범을 처음부터 다시 불러와 주세요.');
  }
}

function cursorOutput(cursor?: AlbumCursor | null): string | undefined {
  return cursor ? btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') : undefined;
}

export function albumSummaryFields(state?: AlbumState) {
  return {
    isFavorite: state?.isFavorite ?? false,
    unlockedPhotoCount: state?.unlockedPhotoCount ?? 0,
    hasUnseenPhotos: state?.hasUnseenPhotos ?? false,
    albumPhotoId: state?.albumPhotoId ?? undefined,
    ...(state?.collection ? { collection: { ...state.collection,
      todayPhotoId: state.collection.todayPhotoId ?? undefined } } : {}),
  };
}

export function createAlbumApi(client: AlbumClient) {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw albumRpcError(error);
    if (data === null || data === undefined) throw new ApiError('ALBUM_UNAVAILABLE', 503, '앨범을 불러오지 못했어요. 다시 시도해 주세요.');
    return data as T;
  }

  async function sign(photo: AuthorizedPhoto) {
    // No photo path crosses the API boundary. Signing precedes any charge or progress.
    const { data, error } = await client.storage.from('pet-photos').createSignedUrl(photo.storagePath, 600);
    if (error || !data?.signedUrl) throw new ApiError('PHOTO_SIGNING_FAILED', 503, '사진을 불러오지 못했어요. 다시 시도해 주세요.');
    return { photoId: photo.photoId, petId: photo.petId, photoUrl: data.signedUrl,
      ...(typeof photo.photoCaption === 'string' && photo.photoCaption ? { photoCaption: photo.photoCaption } : {}),
      signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString() };
  }

  async function states(ownerHash: string, petIds: string[]): Promise<Map<string, AlbumState>> {
    if (!petIds.length) return new Map();
    const all: AlbumState[] = [];
    for (let start = 0; start < petIds.length; start += 100) {
      const rows = await rpc<AlbumState[]>('get_pet_album_state', {
        p_owner_hash: ownerHash, p_pet_ids: petIds.slice(start, start + 100),
      });
      all.push(...rows);
    }
    return new Map(all.map((row) => [row.petId, row]));
  }

  async function album(ownerHash: string, body: Record<string, unknown>) {
    const cursor = cursorInput(body.cursor);
    const limit = body.limit === undefined ? 20 : body.limit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50
      || (body.favoritesOnly !== undefined && typeof body.favoritesOnly !== 'boolean')) {
      throw new ApiError('INVALID_ALBUM_INPUT', 400, '앨범 조회 설정을 확인해 주세요.');
    }
    const page = await rpc<{ items: AlbumItem[]; nextCursor?: AlbumCursor | null; legacyGiftCount: number }>('get_pet_album', {
      p_owner_hash: ownerHash, p_before_unlocked_at: cursor?.at ?? null, p_before_pet_id: cursor?.id ?? null,
      p_limit: limit, p_favorites_only: body.favoritesOnly === true,
    });
    const state = await states(ownerHash, page.items.map((item) => item.pet.id));
    return {
      pets: page.items.map(({ pet, unlockedPhotos, lastUnlockedAt }) => ({
        id: pet.id, name: pet.name, traits: pet.traits,
        publishedAccessory: pet.publishedAccessory, publishedStyle: pet.publishedStyle,
        designVersion: pet.designVersion ?? 1, approvalStatus: 'approved',
        photoAvailable: true, ownerPhotoAvailable: false, isMine: false, shareable: true,
        ...albumSummaryFields(state.get(pet.id)), unlockedPhotos, lastUnlockedAt,
      })),
      nextCursor: cursorOutput(page.nextCursor),
      legacyGiftCount: Math.max(0, Number(page.legacyGiftCount) || 0),
    };
  }

  async function photo(ownerHash: string, photoId: string, date: string) {
    const authorized = await rpc<AuthorizedPhoto>('authorize_pet_album_photo', {
      p_owner_hash: ownerHash, p_photo_id: photoId,
    });
    const signed = await sign(authorized);
    const dailyProgress = await rpc<unknown>('mark_daily_house_pet_met', {
      p_owner_hash: ownerHash, p_date: date, p_pet_id: authorized.petId,
    });
    const state = (await states(ownerHash, [authorized.petId])).get(authorized.petId);
    return { apiVersion: 2, ...signed, ...albumSummaryFields(state), dailyProgress };
  }

  async function reveal(ownerHash: string, body: Record<string, unknown>, date: string) {
    const petId = requireUuid(body.petId);
    if (body.albumVersion === 2) {
      if (body.photoIntent !== 'collect' && body.photoIntent !== 'replay') {
        throw new ApiError('INVALID_PHOTO_INTENT', 400, '사진을 보려는 방법을 다시 확인해 주세요.');
      }
      if (body.photoIntent === 'replay') return replay(ownerHash, petId, requireUuid(body.requestId), date);
    }
    if (body.albumVersion !== 2 && body.revisit === true) {
      const state = (await states(ownerHash, [petId])).get(petId);
      if (!state?.albumPhotoId) throw new ApiError('PHOTO_NOT_UNLOCKED', 403, '먼저 이 친구의 사진을 만나보세요.');
      return photo(ownerHash, state.albumPhotoId, date);
    }
    const requestId = requireUuid(body.requestId, '사진 요청을 다시 확인해 주세요.');
    if (typeof body.unlockMethod !== 'string' || !['FREE', 'SHARE', 'REWARDED'].includes(body.unlockMethod)) {
      throw new ApiError('INVALID_UNLOCK_METHOD', 400, '올바르지 않은 티켓 방식이에요.');
    }
    const args = {
      p_owner_hash: ownerHash, p_pet_id: petId, p_request_id: requestId,
      p_unlock_method: body.unlockMethod,
      p_ad_session_id: body.adSessionId === undefined ? null : requireUuid(body.adSessionId),
    };
    const prepared = await rpc<AuthorizedPhoto>('prepare_pet_photo_unlock', args);
    let signed = await sign(prepared);
    const result = await rpc<{ photoId: string; dailyProgress: unknown; [key: string]: unknown }>('record_pet_photo_unlock', {
      ...args, p_reveal_date: date, p_photo_id: prepared.photoId,
    });
    if (result.photoId !== prepared.photoId) {
      // Two preparations for one request can race with another unlock. The
      // committed request, not the later preparation, pins the actual photo.
      const pinned = await rpc<AuthorizedPhoto>('authorize_pet_album_photo', {
        p_owner_hash: ownerHash, p_photo_id: requireUuid(result.photoId),
      });
      if (pinned.petId !== petId || pinned.photoId !== result.photoId) {
        throw new ApiError('PHOTO_SELECTION_CHANGED', 409, '사진 정보가 바뀌었어요. 다시 불러와 주세요.');
      }
      signed = await sign(pinned);
    }
    const state = (await states(ownerHash, [petId])).get(petId);
    const dailyProgress = typeof result.revealDate === 'string' && result.revealDate !== date
      ? await rpc<unknown>('mark_daily_house_pet_met', { p_owner_hash: ownerHash, p_date: date, p_pet_id: petId })
      : result.dailyProgress;
    return {
      apiVersion: 2, ...signed, ...albumSummaryFields(state), dailyProgress,
      revealDate: result.revealDate, unlockMethod: result.unlockMethod, adSessionId: result.adSessionId,
      alreadyRevealed: result.alreadyRevealed, reusedRequest: result.reusedRequest,
    };
  }

  async function replay(ownerHash: string, petId: string, requestId: string, date: string) {
    // A replay never dispatches a paid reveal, regardless of stale/malicious
    // unlockMethod or adSessionId fields included in the HTTP request.
    const args = { p_owner_hash: ownerHash, p_pet_id: petId, p_request_id: requestId };
    const prepared = await rpc<AuthorizedPhoto>('prepare_pet_photo_replay', args);
    let signed = await sign(prepared);
    const result = await rpc<{ photoId: string; dailyProgress: unknown; revealDate?: string;
      alreadyRevealed?: boolean; reusedRequest?: boolean }>('record_pet_photo_replay', {
      ...args, p_photo_id: prepared.photoId,
    });
    if (result.photoId !== prepared.photoId) {
      const pinned = await rpc<AuthorizedPhoto>('authorize_pet_album_photo', {
        p_owner_hash: ownerHash, p_photo_id: requireUuid(result.photoId),
      });
      if (pinned.petId !== petId || pinned.photoId !== result.photoId) {
        throw new ApiError('PHOTO_SELECTION_CHANGED', 409, '사진 정보가 바뀌었어요. 다시 불러와 주세요.');
      }
      signed = await sign(pinned);
    }
    const dailyProgress = result.revealDate && result.revealDate !== date
      ? await rpc<unknown>('mark_daily_house_pet_met', { p_owner_hash: ownerHash, p_date: date, p_pet_id: petId })
      : result.dailyProgress;
    const state = (await states(ownerHash, [petId])).get(petId);
    return { apiVersion: 2, ...signed, ...albumSummaryFields(state), dailyProgress,
      revealDate: result.revealDate, alreadyRevealed: true, reusedRequest: result.reusedRequest };
  }

  async function favorite(ownerHash: string, body: Record<string, unknown>) {
    const petId = requireUuid(body.petId);
    if (typeof body.isFavorite !== 'boolean') throw new ApiError('INVALID_FAVORITE_INPUT', 400, '마음에 담기 설정을 확인해 주세요.');
    return rpc<{ petId: string; isFavorite: boolean; favoriteCount: number }>('set_pet_favorite', {
      p_owner_hash: ownerHash, p_pet_id: petId, p_is_favorite: body.isFavorite,
    });
  }

  return { states, album, photo, reveal, favorite };
}
