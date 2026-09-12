import { describe, expect, it, vi } from 'vitest';
import { albumRpcError, createAlbumApi, type AlbumClient } from './album-api.ts';
import { rewardRpcRequest } from '../_shared/reward-api.ts';

const petId = '10000000-0000-4000-8000-000000000001';
const photoId = '20000000-0000-4000-8000-000000000001';
const requestId = '30000000-0000-4000-8000-000000000001';
const authorized = { petId, photoId, storagePath: 'private-owner/photo.jpg' };
const state = [{ petId, isFavorite: false, unlockedPhotoCount: 1, hasUnseenPhotos: true, albumPhotoId: photoId, favoriteCount: 0 }];
const dailyProgress = { date: '2026-09-05', metPetIds: [petId], metCount: 1, totalCount: 4, completed: false };

function fixture(overrides: Record<string, unknown> = {}) {
  const order: string[] = [];
  const replies: Record<string, unknown> = {
    prepare_pet_photo_unlock: authorized,
    record_pet_photo_unlock: { photoId, dailyProgress, alreadyRevealed: false, reusedRequest: false },
    prepare_pet_photo_replay: authorized,
    record_pet_photo_replay: { photoId, dailyProgress, alreadyRevealed: true, reusedRequest: false },
    authorize_pet_album_photo: authorized,
    mark_daily_house_pet_met: dailyProgress,
    get_pet_album_state: state,
    set_pet_favorite: { petId, isFavorite: true, favoriteCount: 1 },
    ...overrides,
  };
  const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
    order.push(name);
    const data = replies[name];
    if (data instanceof Error) return { data: null, error: { message: data.message } };
    return { data, error: null };
  });
  const sign = vi.fn(async (_path: string, _expiresIn: number) => {
    order.push('sign');
    return { data: { signedUrl: 'https://example.invalid/signed-photo' }, error: null as { message: string } | null };
  });
  const client: AlbumClient = { rpc, storage: { from: () => ({ createSignedUrl: sign }) } };
  return { api: createAlbumApi(client), rpc, sign, replies, order };
}

describe('album photo authorization and reveal transaction boundary', () => {
  it('authorizes exact photo using verified identity before signing or marking progress', async () => {
    const { api, rpc, sign, order } = fixture();
    const result = await api.photo('verified-user', photoId, '2026-09-05');
    expect(rpc).toHaveBeenNthCalledWith(1, 'authorize_pet_album_photo', {
      p_owner_hash: 'verified-user', p_photo_id: photoId,
    });
    expect(order.slice(0, 3)).toEqual(['authorize_pet_album_photo', 'sign', 'mark_daily_house_pet_met']);
    expect(sign).toHaveBeenCalledWith('private-owner/photo.jpg', 600);
    expect(result).toMatchObject({ photoId, petId, dailyProgress, unlockedPhotoCount: 1 });
    expect(JSON.stringify(result)).not.toContain('private-owner');
    expect(rpc.mock.calls.some(([name]) => name.includes('record_pet'))).toBe(false);
  });

  it.each(['ALBUM_PHOTO_FORBIDDEN', 'ALBUM_PHOTO_UNAVAILABLE', 'PHOTO_NOT_REVEALABLE', 'PET_NOT_AVAILABLE'])(
    'does not sign unauthorized, pending, paused or missing photos (%s)', async (code) => {
      const { api, rpc, sign } = fixture({ authorize_pet_album_photo: new Error(code) });
      await expect(api.photo('other-user', photoId, '2026-09-05')).rejects.toMatchObject({ code });
      expect(sign).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it('presigns a stable photo before the charge and passes that exact photo to the atomic RPC', async () => {
    const { api, rpc, order } = fixture();
    const result = await api.reveal('verified-user', { petId, requestId, unlockMethod: 'FREE', userHash: 'forged' }, '2026-09-05');
    expect(order.slice(0, 3)).toEqual(['prepare_pet_photo_unlock', 'sign', 'record_pet_photo_unlock']);
    expect(rpc).toHaveBeenCalledWith('record_pet_photo_unlock', {
      p_owner_hash: 'verified-user', p_pet_id: petId, p_photo_id: photoId, p_request_id: requestId,
      p_reveal_date: '2026-09-05', p_unlock_method: 'FREE', p_ad_session_id: null,
    });
    expect(result).toMatchObject({ photoId, unlockedPhotoCount: 1 });
    expect(JSON.stringify(result)).not.toContain('storagePath');
  });

  it('does not charge a ticket or mark progress when signing fails', async () => {
    const { api, rpc, sign } = fixture();
    sign.mockResolvedValueOnce({ data: { signedUrl: '' }, error: { message: 'unavailable' } });
    await expect(api.reveal('verified-user', { petId, requestId, unlockMethod: 'FREE' }, '2026-09-05'))
      .rejects.toMatchObject({ code: 'PHOTO_SIGNING_FAILED' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['prepare_pet_photo_unlock']);
  });

  it('reuses the same request and photo after a lost response instead of substituting another photo', async () => {
    const { api, rpc, replies } = fixture();
    await api.reveal('verified-user', { petId, requestId, unlockMethod: 'FREE' }, '2026-09-05');
    replies.prepare_pet_photo_unlock = { ...authorized, alreadyRevealed: true, reusedRequest: true };
    replies.record_pet_photo_unlock = { photoId, dailyProgress, alreadyRevealed: true, reusedRequest: true };
    const result = await api.reveal('verified-user', { petId, requestId, unlockMethod: 'FREE' }, '2026-09-05');
    const records = rpc.mock.calls.filter(([name]) => name === 'record_pet_photo_unlock');
    expect(records[0][1]).toEqual(records[1][1]);
    expect(result).toMatchObject({ photoId, alreadyRevealed: true, reusedRequest: true });
  });

  it('reauthorizes and resigns the committed request photo when concurrent preparations selected different photos', async () => {
    const { api, sign, rpc, order } = fixture({
      record_pet_photo_unlock: { photoId: requestId, dailyProgress, reusedRequest: true },
      authorize_pet_album_photo: { petId, photoId: requestId, storagePath: 'private-owner/pinned-original.jpg' },
    });
    sign.mockImplementationOnce(async () => {
      order.push('sign');
      return { data: { signedUrl: 'https://example.invalid/candidate' }, error: null };
    });
    sign.mockImplementationOnce(async () => {
      order.push('sign');
      return { data: { signedUrl: 'https://example.invalid/pinned-original' }, error: null };
    });
    const result = await api.reveal('verified-user', { petId, requestId, unlockMethod: 'FREE' }, '2026-09-05');
    expect(order.slice(0, 5)).toEqual([
      'prepare_pet_photo_unlock', 'sign', 'record_pet_photo_unlock', 'authorize_pet_album_photo', 'sign',
    ]);
    expect(rpc).toHaveBeenCalledWith('authorize_pet_album_photo', { p_owner_hash: 'verified-user', p_photo_id: requestId });
    expect(sign).toHaveBeenLastCalledWith('private-owner/pinned-original.jpg', 600);
    expect(result).toMatchObject({ photoId: requestId, photoUrl: 'https://example.invalid/pinned-original', reusedRequest: true });
    expect(rpc.mock.calls.filter(([name]) => name === 'record_pet_photo_unlock')).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('/candidate');
  });

  it('does not return the candidate URL if the committed photo was withdrawn during a concurrent retry', async () => {
    const { api, sign } = fixture({
      record_pet_photo_unlock: { photoId: requestId, dailyProgress, reusedRequest: true },
      authorize_pet_album_photo: new Error('ALBUM_PHOTO_UNAVAILABLE'),
    });
    await expect(api.reveal('verified-user', { petId, requestId, unlockMethod: 'FREE' }, '2026-09-05'))
      .rejects.toMatchObject({ code: 'ALBUM_PHOTO_UNAVAILABLE' });
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('fails closed if committed photo authorization returns a different pet or ID', async () => {
    const { api, sign } = fixture({
      record_pet_photo_unlock: { photoId: requestId, dailyProgress },
      authorize_pet_album_photo: { petId: photoId, photoId: requestId, storagePath: 'another-pet/photo.jpg' },
    });
    await expect(api.reveal('verified-user', { petId, requestId, unlockMethod: 'FREE' }, '2026-09-05'))
      .rejects.toMatchObject({ code: 'PHOTO_SELECTION_CHANGED' });
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('rechecks today\'s progress when retrying a successful request after KST midnight', async () => {
    const { api, rpc } = fixture({ record_pet_photo_unlock: {
      photoId, dailyProgress, revealDate: '2026-09-04', reusedRequest: true,
    } });
    await api.reveal('verified-user', { petId, requestId, unlockMethod: 'FREE' }, '2026-09-05');
    expect(rpc).toHaveBeenCalledWith('mark_daily_house_pet_met', {
      p_owner_hash: 'verified-user', p_date: '2026-09-05', p_pet_id: petId,
    });
  });

  it('opens a permanent grant for legacy-style revisit requests without a new reveal transaction', async () => {
    const { api, rpc } = fixture();
    await api.reveal('verified-user', { petId, revisit: true }, '2026-09-07');
    expect(rpc).toHaveBeenCalledWith('authorize_pet_album_photo', { p_owner_hash: 'verified-user', p_photo_id: photoId });
    expect(rpc.mock.calls.some(([name]) => name === 'record_pet_photo_unlock')).toBe(false);
  });

  it('rejects additional photos outside today\'s assignment before signing', async () => {
    const { api, sign } = fixture({ prepare_pet_photo_unlock: new Error('ALBUM_PET_NOT_TODAY') });
    await expect(api.reveal('verified-user', { petId, requestId, unlockMethod: 'FREE' }, '2026-09-05'))
      .rejects.toMatchObject({ code: 'ALBUM_PET_NOT_TODAY', status: 409 });
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('collection v2 photo intent, free replay and exact captions', () => {
  it.each([undefined, 'next', '', null])('rejects v2 missing/unknown intent before any request: %j', async (photoIntent) => {
    const { api, rpc } = fixture();
    await expect(api.reveal('verified-user', { petId, requestId, albumVersion: 2, photoIntent, unlockMethod: 'FREE' }, '2026-09-05'))
      .rejects.toMatchObject({ code: 'INVALID_PHOTO_INTENT' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('explicit replay cannot invoke paid collect even with stale reward fields and canCollectToday=true', async () => {
    const { api, rpc, order } = fixture({ get_pet_album_state: [{ ...state[0], collection: {
      collectedCount: 1, totalCount: 3, collectedToday: false, canCollectToday: true, todayPhotoId: null,
    } }] });
    const result = await api.reveal('verified-user', {
      petId, requestId, albumVersion: 2, photoIntent: 'replay', unlockMethod: 'REWARDED', adSessionId: 'not-a-valid-session',
    }, '2026-09-05');
    expect(order.slice(0, 3)).toEqual(['prepare_pet_photo_replay', 'sign', 'record_pet_photo_replay']);
    expect(rpc.mock.calls.some(([name]) => name === 'record_pet_photo_unlock')).toBe(false);
    expect(rpc).toHaveBeenCalledWith('record_pet_photo_replay', {
      p_owner_hash: 'verified-user', p_pet_id: petId, p_request_id: requestId, p_photo_id: photoId,
    });
    expect(result).toMatchObject({ alreadyRevealed: true, collection: { collectedCount: 1, canCollectToday: true } });
  });

  it('v2 collect uses the daily-capped legacy RPC name and preserves its already-collected response', async () => {
    const { api, rpc } = fixture({ record_pet_photo_unlock: { photoId, dailyProgress, alreadyRevealed: true } });
    const result = await api.reveal('verified-user', { petId, requestId, albumVersion: 2, photoIntent: 'collect', unlockMethod: 'FREE' }, '2026-09-05');
    expect(result).toMatchObject({ photoId, alreadyRevealed: true });
    expect(rpc.mock.calls.filter(([name]) => name === 'record_pet_photo_unlock')).toHaveLength(1);
  });

  it('free replay signing failure writes neither replay receipt nor progress', async () => {
    const { api, rpc, sign } = fixture();
    sign.mockResolvedValueOnce({ data: { signedUrl: '' }, error: { message: 'offline' } });
    await expect(api.reveal('verified-user', { petId, requestId, albumVersion: 2, photoIntent: 'replay' }, '2026-09-05'))
      .rejects.toMatchObject({ code: 'PHOTO_SIGNING_FAILED' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['prepare_pet_photo_replay']);
  });

  it('different replay preparation resolves the committed request photo and its caption', async () => {
    const { api, sign } = fixture({
      prepare_pet_photo_replay: { ...authorized, photoCaption: '준비한 사진' },
      record_pet_photo_replay: { photoId: requestId, dailyProgress, reusedRequest: true },
      authorize_pet_album_photo: { petId, photoId: requestId, storagePath: 'private-owner/pinned.jpg', photoCaption: '다시 만난 순간' },
    });
    const result = await api.reveal('verified-user', { petId, requestId, albumVersion: 2, photoIntent: 'replay' }, '2026-09-05');
    expect(result).toMatchObject({ photoId: requestId, photoCaption: '다시 만난 순간', reusedRequest: true });
    expect(sign).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('준비한 사진');
  });

  it('photo and collect caption are exact-photo metadata while absent caption is omitted', async () => {
    const { api } = fixture({ authorize_pet_album_photo: { ...authorized, photoCaption: '낮잠 자는 중' },
      prepare_pet_photo_unlock: { ...authorized, photoCaption: '산책이 좋아요' } });
    expect(await api.photo('verified-user', photoId, '2026-09-05')).toMatchObject({ photoCaption: '낮잠 자는 중' });
    expect(await api.reveal('verified-user', { petId, requestId, albumVersion: 2, photoIntent: 'collect', unlockMethod: 'FREE' }, '2026-09-05'))
      .toMatchObject({ photoCaption: '산책이 좋아요' });
    expect(await fixture().api.photo('verified-user', photoId, '2026-09-05')).not.toHaveProperty('photoCaption');
  });

  it('maps daily collection limit to a Korean no-extra-ad guidance', () => {
    expect(albumRpcError({ message: 'DAILY_PHOTO_ALREADY_COLLECTED' })).toMatchObject({ status: 409, code: 'DAILY_PHOTO_ALREADY_COLLECTED' });
  });
});

describe('album listing and favorites', () => {
  it('returns grouped public metadata and an opaque keyset cursor, without signing thumbnails', async () => {
    const { api, rpc, sign } = fixture({ get_pet_album: {
      items: [{ pet: { id: petId, name: '구르미', designVersion: 3 },
        unlockedPhotos: [{ photoId, unlockedAt: '2026-09-05T00:00:00Z', source: 'legacy_gift' }],
        lastUnlockedAt: '2026-09-05T00:00:00Z', unlockedPhotoCount: 1, isFavorite: false }],
      nextCursor: { at: '2026-09-05T00:00:00Z', id: petId }, legacyGiftCount: 1,
    } });
    const page = await api.album('verified-user', { favoritesOnly: true });
    expect(page.pets[0]).toMatchObject({ id: petId, designVersion: 3, unlockedPhotos: [{ photoId, source: 'legacy_gift' }] });
    expect(page.legacyGiftCount).toBe(1);
    expect(sign).not.toHaveBeenCalled();
    await api.album('verified-user', { cursor: page.nextCursor });
    expect(rpc).toHaveBeenCalledWith('get_pet_album', {
      p_owner_hash: 'verified-user', p_before_unlocked_at: '2026-09-05T00:00:00Z',
      p_before_pet_id: petId, p_limit: 20, p_favorites_only: false,
    });
  });

  it.each([{ limit: 0 }, { limit: 51 }, { favoritesOnly: 'true' }, { cursor: 'malformed' }])(
    'rejects invalid pagination before contacting the database: %j', async (body) => {
      const { api, rpc } = fixture();
      await expect(api.album('verified-user', body)).rejects.toMatchObject({ status: 400 });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('sends explicit desired favorite state under the verified identity, making repeated requests idempotent', async () => {
    const { api, rpc } = fixture();
    await api.favorite('verified-user', { petId, isFavorite: true });
    await api.favorite('verified-user', { petId, isFavorite: true });
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc).toHaveBeenCalledWith('set_pet_favorite', { p_owner_hash: 'verified-user', p_pet_id: petId, p_is_favorite: true });
  });

  it('allows an explicit cancellation to reach the RPC even if the old pet is now paused', async () => {
    const { api, rpc } = fixture({ set_pet_favorite: { petId, isFavorite: false, favoriteCount: 0 } });
    expect(await api.favorite('verified-user', { petId, isFavorite: false })).toMatchObject({ isFavorite: false });
    expect(rpc).toHaveBeenCalledWith('set_pet_favorite', { p_owner_hash: 'verified-user', p_pet_id: petId, p_is_favorite: false });
  });

  it('maps owner and missing photo favorite rejections to user-readable 403 errors', () => {
    expect(albumRpcError({ message: 'SELF_FAVORITE_FORBIDDEN' })).toMatchObject({ status: 403 });
    expect(albumRpcError({ message: 'FAVORITE_REQUIRES_PHOTO' })).toMatchObject({ status: 403 });
  });

  it('opts in new-photo ad eligibility only when the client advertises album support', () => {
    expect(rewardRpcRequest('rewardStart', { petId, requestId }, 'verified-user').name).toBe('start_pet_ad_reward');
    expect(rewardRpcRequest('rewardStart', { petId, requestId, albumVersion: 1 }, 'verified-user').name)
      .toBe('start_pet_album_ad_reward');
    expect(rewardRpcRequest('rewardRebind', { petId, sessionId: requestId, albumVersion: 1 }, 'verified-user').name)
      .toBe('rebind_pet_album_ad_reward');
  });
});
