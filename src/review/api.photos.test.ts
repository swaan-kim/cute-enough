import { describe, expect, it, vi } from 'vitest';
import { createReviewApi } from './api';
import type { ReviewPhotoSet, SaveReviewPhotosRequest } from './types';

const set: ReviewPhotoSet = { petId: 'pet-1', revision: 'a'.repeat(64), photos: [
  { photoId: 'photo-1', url: '/api/review-photo/one', caption: '첫 사진', sortOrder: 0, isActive: true, available: true },
  { photoId: 'photo-2', url: null, caption: null, sortOrder: null, isActive: false, available: false },
] };
const request: SaveReviewPhotosRequest = { petId: set.petId, expectedRevision: 'b'.repeat(64), photos: [{ photoId: 'photo-1', caption: '첫 사진' }] };
describe('review photo API', () => {
  it('validates the lazy snapshot with inactive and temporarily unavailable photos', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(set)));
    expect(await createReviewApi(fetcher).getPhotos!(set.petId)).toEqual(set);
    expect(fetcher.mock.calls[0][0]).toBe('/api/review-photos?petId=pet-1');
  });
  it('sends an explicit ordered revision request and checks its saved result', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(set)));
    expect(await createReviewApi(fetcher).savePhotos!(request)).toEqual(set);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(request);
    expect(fetcher.mock.calls[0][0]).toBe('/api/review-photos');
  });
  it('rejects a saved caption differing from the intended edit', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...set, photos: [{ ...set.photos[0], caption: '다른 문구' }] })));
    await expect(createReviewApi(fetcher).savePhotos!(request)).rejects.toThrow('순서·문구');
  });
  it('preserves stale-save errors without retrying or publishing', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: '사진이 바뀌었어요.' }), { status: 409 }));
    await expect(createReviewApi(fetcher).savePhotos!(request)).rejects.toThrow('사진이 바뀌었어요');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects duplicated identities, invalid revisions, unsafe URLs and captions', async () => {
    const invalid = [ { ...set, revision: 'old' }, { ...set, photos: [set.photos[0], set.photos[0]] },
      { ...set, photos: [{ ...set.photos[0], url: 'javascript:alert(1)' }] },
      ...['<img>', '\u200b숨김', '\ufeff숨김', '앞\u2028뒤'].map((caption) => ({ ...set, photos: [{ ...set.photos[0], caption }] })) ];
    for (const payload of invalid) {
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
      await expect(createReviewApi(fetcher).getPhotos!(set.petId)).rejects.toThrow('응답 형식');
    }
  });
});
