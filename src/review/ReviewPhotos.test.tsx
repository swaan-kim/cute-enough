import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewPhotoGallery, ReviewPhotoManager, ReviewPhotoReference, reviewPhotoCaptionError } from './ReviewPhotos';
import type { ReviewApi, ReviewPhotoSet } from './types';

const snapshot: ReviewPhotoSet = {
  petId: 'pet-1', revision: 'a'.repeat(64), photos: [
    { photoId: 'first', url: '/photo1.jpg', caption: null, sortOrder: 0, available: true, isActive: true },
    { photoId: 'second', url: '/photo2.jpg', caption: '산책', sortOrder: 1, available: true, isActive: true },
    { photoId: 'third', url: '/photo3.jpg', caption: null, sortOrder: 2, available: true, isActive: true },
    { photoId: 'excluded', url: '/photo4.jpg', caption: '잠', sortOrder: null, available: true, isActive: false },
  ],
};
function apiForPhotos(overrides: Partial<ReviewApi> = {}): ReviewApi {
  return { getQueue: vi.fn(), getCatalog: vi.fn(), review: vi.fn(), manage: vi.fn(), saveDraft: vi.fn(),
    getPhotos: vi.fn().mockResolvedValue(snapshot), savePhotos: vi.fn().mockImplementation(async (request) => ({
      ...snapshot, revision: 'b'.repeat(64), photos: snapshot.photos.map((photo) => ({ ...photo,
        isActive: request.photos.some((next: { photoId: string }) => next.photoId === photo.photoId),
        sortOrder: request.photos.findIndex((next: { photoId: string }) => next.photoId === photo.photoId),
        caption: request.photos.find((next: { photoId: string }) => next.photoId === photo.photoId)?.caption ?? photo.caption,
      })),
    })), ...overrides };
}
const common = { petId: 'pet-1', name: '구르미', status: 'pending' as const, onClose: vi.fn(), onSaved: vi.fn(), onDownload: vi.fn() };

describe('creator photo management', () => {
  it('keeps navigation and load/failure state on photo IDs after reordering', () => {
    const onLoad = vi.fn();
    const photos = snapshot.photos.slice(0, 3);
    const { rerender } = render(<ReviewPhotoGallery name="구르미" photos={photos} onPhotoLoaded={onLoad} />);
    const oldMain = screen.getByRole('img', { name: '구르미 실사 사진 1' });
    fireEvent.click(screen.getByRole('button', { name: '다음 사진' }));
    fireEvent.load(oldMain);
    expect(onLoad).not.toHaveBeenCalled();
    fireEvent.load(screen.getByRole('img', { name: '구르미 실사 사진 2' }));
    expect(onLoad).toHaveBeenCalledWith('/photo2.jpg');
    rerender(<ReviewPhotoGallery name="구르미" photos={[photos[1], photos[0], photos[2]]} onPhotoLoaded={onLoad} />);
    expect(screen.getByRole('img', { name: '구르미 실사 사진 1' })).toHaveAttribute('src', '/photo2.jpg');
    fireEvent.error(screen.getByRole('img', { name: '구르미 실사 사진 1' }));
    fireEvent.click(screen.getByRole('button', { name: '다음 사진' }));
    expect(screen.getByRole('img', { name: '구르미 실사 사진 2' })).toHaveAttribute('src', '/photo1.jpg');
  });

  it('lets the creator reorder, caption, exclude and save only an ordered kept list', async () => {
    const api = apiForPhotos(); const onSaved = vi.fn();
    render(<ReviewPhotoManager {...common} api={api} onSaved={onSaved} />);
    await screen.findByLabelText(/사진 문구/);
    expect(screen.getByText(/사진을 저장해도 승인 대기는 유지/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음 사진' }));
    fireEvent.click(screen.getByRole('button', { name: '앞으로' }));
    expect(screen.getByRole('img', { name: '구르미 실사 사진 1' })).toHaveAttribute('src', '/photo2.jpg');
    fireEvent.change(screen.getByLabelText(/사진 문구/), { target: { value: '  산책을 좋아해요  ' } });
    fireEvent.click(screen.getByRole('button', { name: '다음 사진' }));
    fireEvent.click(screen.getByRole('button', { name: '사진 제외' }));
    expect(api.savePhotos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '사진 변경 저장' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.savePhotos).toHaveBeenCalledWith({ petId: 'pet-1', expectedRevision: 'a'.repeat(64), photos: [
      { photoId: 'second', caption: '산책을 좋아해요' }, { photoId: 'third', caption: null },
    ] });
    expect(api.review).not.toHaveBeenCalled(); expect(api.manage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '사진 변경 저장' })).toBeDisabled();
  });

  it('restores an excluded photo and its unsaved caption without deleting an original', async () => {
    const api = apiForPhotos();
    render(<ReviewPhotoManager {...common} api={api} />);
    await screen.findByLabelText(/사진 문구/);
    fireEvent.change(screen.getByLabelText(/사진 문구/), { target: { value: '새 문구' } });
    fireEvent.click(screen.getByRole('button', { name: '사진 제외' }));
    fireEvent.click(screen.getByText('제외한 사진 2장'));
    fireEvent.click(screen.getByRole('button', { name: '제외한 사진 다시 포함' }));
    expect(screen.getByLabelText(/사진 문구/)).toHaveValue('새 문구');
    expect(screen.getByText(/원본과 수집 기록은 보관/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '변경 버리고 닫기' }));
    expect(api.savePhotos).not.toHaveBeenCalled();
  });

  it('retains dirty edits on a stale revision conflict and offers an explicit reload', async () => {
    const api = apiForPhotos({ savePhotos: vi.fn().mockRejectedValue(new Error('다른 화면에서 사진이 변경됐어요.')) });
    render(<ReviewPhotoManager {...common} api={api} />);
    await screen.findByLabelText(/사진 문구/);
    fireEvent.change(screen.getByLabelText(/사진 문구/), { target: { value: '내 문구' } });
    fireEvent.click(screen.getByRole('button', { name: '사진 변경 저장' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/사진 문구/)).toHaveValue('내 문구');
    expect(api.getPhotos).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '변경 버리고 최신 사진 불러오기' }));
    await waitFor(() => expect(screen.getByLabelText(/사진 문구/)).toHaveValue(''));
    expect(api.getPhotos).toHaveBeenCalledTimes(2);
  });

  it('displays legacy photos read-only when the migration/API is unavailable', async () => {
    const api = apiForPhotos({ getPhotos: vi.fn().mockRejectedValue(new Error('사진 관리 연결 준비가 필요해요.')) });
    render(<ReviewPhotoManager {...common} api={api} fallbackUrls={['/legacy.jpg']} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('img', { name: '구르미 실사 사진 1' })).toHaveAttribute('src', '/legacy.jpg');
    expect(screen.queryByRole('button', { name: '사진 변경 저장' })).not.toBeInTheDocument();
    expect(api.savePhotos).not.toHaveBeenCalled();
  });

  it('fetches all originals only when a reference editor mounts, and supports browsing', async () => {
    const api = apiForPhotos();
    render(<ReviewPhotoReference api={api} petId="pet-1" name="구르미" />);
    await screen.findByRole('img', { name: '구르미 검수 실사' });
    fireEvent.click(screen.getByRole('button', { name: '다음 사진' }));
    expect(screen.getByRole('img', { name: '구르미 검수 실사' })).toHaveAttribute('src', '/photo2.jpg');
    expect(screen.queryByLabelText(/사진 문구/)).not.toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('counts Unicode code points and rejects unsafe/multiline captions', () => {
    expect(reviewPhotoCaptionError('🐕'.repeat(30))).toBe('');
    expect(reviewPhotoCaptionError('🐕'.repeat(31))).toContain('30자');
    for (const caption of ['<img>', '앞\n뒤', '\u202e숨김', '\u200b숨김', '\ufeff숨김', '앞\u2028뒤']) expect(reviewPhotoCaptionError(caption)).not.toBe('');
  });
});
