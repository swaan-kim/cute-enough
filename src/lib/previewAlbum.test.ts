import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';
import { decoratePreviewAlbumPet, getPreviewAlbumPhoto, grantPreviewPhoto, importPreviewAlbumGifts, previewAlbumEntries, previewPhotoForRequest, previewPhotos, rememberPreviewPhotoRequest, selectPreviewPhoto, setPreviewFavorite } from './previewAlbum';

const pet: PetSummary = {
  id: 'album-pet', name: '구르미', approvalStatus: 'approved',
  photoUrls: ['/photos/gureumi-standing.jpg', '/photos/gureumi-sleeping.jpg'],
  traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 1 },
};

function makeStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T14:59:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('preview photo album', () => {
  it('counts only a real reveal for the KST collection day and allows the next one after midnight', () => {
    const storage = makeStorage();
    const [first, second] = previewPhotos(pet);
    grantPreviewPhoto(pet, first.photoId, storage, undefined, 'legacy_gift');
    expect(decoratePreviewAlbumPet(pet, storage, true).collection).toMatchObject({ collectedCount: 1, totalCount: 2, collectedToday: false, canCollectToday: true });
    const selected = selectPreviewPhoto(pet, 'collect', storage, true, 'today');
    expect(selected).toMatchObject({ photo: { photoId: second.photoId }, needsTicket: true });
    grantPreviewPhoto(pet, second.photoId, storage, 'today');
    expect(decoratePreviewAlbumPet(pet, storage, true).collection).toMatchObject({ collectedToday: true, todayPhotoId: second.photoId, canCollectToday: false });
    expect(selectPreviewPhoto(pet, 'collect', storage, true, 'duplicate')).toMatchObject({ photo: { photoId: second.photoId }, needsTicket: false });
    vi.setSystemTime(new Date('2026-09-05T15:00:00Z'));
    expect(decoratePreviewAlbumPet(pet, storage, true).collection).toMatchObject({ collectedToday: false, canCollectToday: false });
  });

  it('requires today\'s house for a later collection but lets an unseen shared friend have a first encounter', () => {
    const storage = makeStorage();
    expect(selectPreviewPhoto(pet, 'collect', storage, false, 'shared-first').needsTicket).toBe(true);
    grantPreviewPhoto(pet, previewPhotos(pet)[0].photoId, storage, 'shared-first');
    vi.setSystemTime(new Date('2026-09-06T01:00:00Z'));
    expect(decoratePreviewAlbumPet(pet, storage, false).collection?.canCollectToday).toBe(false);
    expect(() => selectPreviewPhoto(pet, 'collect', storage, false, 'shared-next')).toThrow('오늘 집에 온 날');
    expect(selectPreviewPhoto(pet, 'collect', storage, true, 'house-next').needsTicket).toBe(true);
  });

  it('replays today\'s collected photo for free and fixes it to the same request across days', () => {
    const storage = makeStorage();
    const first = previewPhotos(pet)[0];
    grantPreviewPhoto(pet, first.photoId, storage, 'collect');
    const replay = selectPreviewPhoto(pet, 'replay', storage, true, 'replay');
    expect(replay).toMatchObject({ photo: { photoId: first.photoId }, needsTicket: false });
    rememberPreviewPhotoRequest(pet, first.photoId, 'replay', 'replay', storage);
    vi.setSystemTime(new Date('2026-09-07T01:00:00Z'));
    expect(selectPreviewPhoto(pet, 'replay', storage, true, 'replay').photo.photoId).toBe(first.photoId);
    expect(() => selectPreviewPhoto(pet, 'collect', storage, true, 'replay')).toThrow('이전 사진 요청');
  });

  it('cycles fully collected photos per new visit without repeating the previous photo, but keeps retries stable', () => {
    const storage = makeStorage();
    const photos = previewPhotos(pet);
    grantPreviewPhoto(pet, photos[0].photoId, storage, 'first');
    vi.setSystemTime(new Date('2026-09-06T01:00:00Z'));
    grantPreviewPhoto(pet, photos[1].photoId, storage, 'second');
    vi.setSystemTime(new Date('2026-09-07T01:00:00Z'));
    const firstVisit = selectPreviewPhoto(pet, 'replay', storage, true, 'visit-a');
    expect(firstVisit.photo.photoId).toBe(photos[0].photoId);
    rememberPreviewPhotoRequest(pet, firstVisit.photo.photoId, 'replay', 'visit-a', storage);
    const secondVisit = selectPreviewPhoto(pet, 'replay', storage, true, 'visit-b');
    expect(secondVisit.photo.photoId).toBe(photos[1].photoId);
    rememberPreviewPhotoRequest(pet, secondVisit.photo.photoId, 'replay', 'visit-b', storage);
    expect(selectPreviewPhoto(pet, 'replay', storage, true, 'visit-a').photo.photoId).toBe(photos[0].photoId);
    expect(() => selectPreviewPhoto(pet, 'collect', storage, true, 'new-collect')).toThrow('모두 모았어요');
  });

  it('keeps the latest collected photo during partial-collection replay and does not replace a withdrawn daily photo', () => {
    const storage = makeStorage();
    const extended = { ...pet, photoUrls: [...pet.photoUrls!, '/photos/third.jpg'] };
    const [first, second] = previewPhotos(extended);
    grantPreviewPhoto(extended, first.photoId, storage, 'first');
    vi.setSystemTime(new Date('2026-09-06T01:00:00Z'));
    grantPreviewPhoto(extended, second.photoId, storage, 'second');
    vi.setSystemTime(new Date('2026-09-07T01:00:00Z'));
    expect(selectPreviewPhoto(extended, 'replay', storage, true, 'visit').photo.photoId).toBe(second.photoId);
    vi.setSystemTime(new Date('2026-09-06T03:00:00Z'));
    const withdrawn = { ...extended, photoUrls: [extended.photoUrls[0], extended.photoUrls[2]] };
    expect(decoratePreviewAlbumPet(withdrawn, storage, true).collection).toMatchObject({ collectedToday: true, canCollectToday: false });
    expect(selectPreviewPhoto(withdrawn, 'collect', storage, true, 'withdrawn-day')).toMatchObject({ photo: { photoId: first.photoId }, needsTicket: false });
  });

  it('keeps photo identity across reordering and does not grant a replacement photo', () => {
    const storage = makeStorage();
    const original = previewPhotos(pet);
    grantPreviewPhoto(pet, original[0].photoId, storage);
    const reordered = { ...pet, photoUrls: [...pet.photoUrls!].reverse() };
    expect(previewPhotos(reordered).find((photo) => photo.url === original[0].url)?.photoId).toBe(original[0].photoId);
    expect(getPreviewAlbumPhoto(reordered, original[0].photoId, storage).photo.url).toBe(original[0].url);

    const replaced = { ...pet, photoUrls: ['/photos/gureumi-replacement.jpg', pet.photoUrls![1]] };
    expect(previewPhotos(replaced)[0].photoId).not.toBe(original[0].photoId);
    expect(() => getPreviewAlbumPhoto(replaced, previewPhotos(replaced)[0].photoId, storage)).toThrow();
    expect(previewAlbumEntries([replaced], storage)).toEqual([]);
  });

  it('imports a representative gift once, preserving a previous normal reveal', () => {
    const storage = makeStorage();
    const secondPet = { ...pet, id: 'other-pet', name: '하늘' };
    const secondPhotoId = previewPhotos(secondPet)[1].photoId;
    grantPreviewPhoto(secondPet, secondPhotoId, storage);
    storage.setItem('cute-enough:preview-reveals', JSON.stringify([{ petId: pet.id }, { petId: secondPet.id }, { petId: pet.id }]));
    importPreviewAlbumGifts([pet, secondPet], storage);
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
    importPreviewAlbumGifts([pet, secondPet], storage);
    const entries = previewAlbumEntries([pet, secondPet], storage);
    expect(entries.find((entry) => entry.id === pet.id)?.unlockedPhotos).toHaveLength(1);
    expect(entries.find((entry) => entry.id === pet.id)?.unlockedPhotos[0].source).toBe('legacy_gift');
    expect(entries.find((entry) => entry.id === secondPet.id)?.unlockedPhotos).toEqual([expect.objectContaining({ photoId: secondPhotoId, source: 'reveal' })]);
  });

  it('does not gift private, suspended, self-owned, or missing-photo pets from old records', () => {
    const storage = makeStorage();
    const candidates: PetSummary[] = [
      { ...pet, id: 'pending', approvalStatus: 'pending' }, { ...pet, id: 'paused', approvalStatus: 'paused' },
      { ...pet, id: 'mine', isMine: true }, { ...pet, id: 'empty', photoUrls: [] },
    ];
    storage.setItem('cute-enough:preview-reveals', JSON.stringify({ petIds: candidates.map((item) => item.id) }));
    expect(previewAlbumEntries(candidates, storage)).toEqual([]);
  });

  it('keeps an unlocked photo available beyond recharge and KST date boundaries without another grant', () => {
    const storage = makeStorage();
    const photo = previewPhotos(pet)[0];
    grantPreviewPhoto(pet, photo.photoId, storage, 'first-request');
    const initial = storage.getItem('cute-enough:preview-album:v1');
    vi.setSystemTime(new Date('2026-11-05T16:00:00Z'));
    expect(getPreviewAlbumPhoto(pet, photo.photoId, storage).photo.url).toBe(photo.url);
    expect(decoratePreviewAlbumPet(pet, storage)).toMatchObject({ unlockedPhotoCount: 1, hasUnseenPhotos: true, albumPhotoId: photo.photoId });
    expect(storage.getItem('cute-enough:preview-album:v1')).toBe(initial);
    expect(previewPhotoForRequest('first-request', storage)).toBe(photo.photoId);
  });

  it('sets and removes favorite idempotently without deleting photo rights', () => {
    const storage = makeStorage();
    const photo = previewPhotos(pet)[0];
    grantPreviewPhoto(pet, photo.photoId, storage);
    expect(setPreviewFavorite(pet, true, storage)).toMatchObject({ isFavorite: true, favoriteCount: 1 });
    expect(setPreviewFavorite(pet, true, storage)).toMatchObject({ isFavorite: true, favoriteCount: 1 });
    expect(previewAlbumEntries([pet], storage)[0].isFavorite).toBe(true);
    expect(previewAlbumEntries([pet], storage)[0]).toMatchObject({ shareable: true, photoAvailable: true });
    expect(setPreviewFavorite(pet, false, storage)).toMatchObject({ isFavorite: false, favoriteCount: 0 });
    expect(setPreviewFavorite(pet, false, storage)).toMatchObject({ isFavorite: false, favoriteCount: 0 });
    expect(getPreviewAlbumPhoto(pet, photo.photoId, storage).photo.url).toBe(photo.url);
    expect(setPreviewFavorite(pet, true, storage).favoriteCount).toBe(1);
  });

  it('rejects favorite registration before meeting and for self-owned or pending pets', () => {
    const storage = makeStorage();
    expect(() => setPreviewFavorite(pet, true, storage)).toThrow();
    grantPreviewPhoto(pet, previewPhotos(pet)[0].photoId, storage);
    expect(() => setPreviewFavorite({ ...pet, isMine: true }, true, storage)).toThrow();
    expect(() => setPreviewFavorite({ ...pet, approvalStatus: 'pending' }, true, storage)).toThrow();
    expect(() => grantPreviewPhoto({ ...pet, approvalStatus: 'pending' }, previewPhotos(pet)[0].photoId, storage)).toThrow();
    expect(() => grantPreviewPhoto(pet, 'somebody-elses-photo', storage)).toThrow();
  });

  it('hides suspended photos but permits removing an existing favorite', () => {
    const storage = makeStorage();
    const photo = previewPhotos(pet)[0];
    grantPreviewPhoto(pet, photo.photoId, storage);
    setPreviewFavorite(pet, true, storage);
    const suspended = { ...pet, approvalStatus: 'paused' as const };
    expect(previewAlbumEntries([suspended], storage)).toEqual([]);
    expect(() => getPreviewAlbumPhoto(suspended, photo.photoId, storage)).toThrow();
    expect(setPreviewFavorite(suspended, false, storage).isFavorite).toBe(false);
  });

  it('persists photo IDs and favorite metadata without persisting image URLs', () => {
    const storage = makeStorage();
    const photo = previewPhotos(pet)[0];
    grantPreviewPhoto(pet, photo.photoId, storage, 'request-one');
    grantPreviewPhoto(pet, photo.photoId, storage, 'request-one');
    setPreviewFavorite(pet, true, storage);
    const raw = storage.getItem('cute-enough:preview-album:v1')!;
    expect(raw).toContain(photo.photoId);
    for (const url of pet.photoUrls!) expect(raw).not.toContain(url);
    expect(raw).not.toContain('photoUrl');
    expect(raw).not.toContain('signedUrl');
    expect(JSON.parse(raw).grants).toHaveLength(1);
  });
});
