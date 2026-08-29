import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReviewApp from './ReviewApp';
import type { ReviewApi, ReviewQueueItem } from './types';

const item: ReviewQueueItem = {
  petId: '11111111-1111-4111-8111-111111111111',
  name: '테스트견',
  createdAt: '2026-08-29T02:15:00.000Z',
  photoPresent: true,
  photoUrls: ['/api/review-photo/opaque-test-token'],
  traits: {
    schemaVersion: 1,
    earShape: 'floppy',
    headShape: 'round',
    baseColor: 'cream',
    secondaryColor: 'caramel',
    markingPattern: 'blaze',
    muzzle: 'short',
    confidence: 0.95,
  },
};

function makeApi(overrides: Partial<ReviewApi> = {}): ReviewApi {
  return {
    getQueue: vi.fn().mockResolvedValue([item]),
    review: vi.fn().mockImplementation(async ({ petId, decision }) => ({ petId, status: decision })),
    ...overrides,
  };
}

describe('ReviewApp', () => {
  it('shows loading, then renders the photo, character, name, time, and photo status', async () => {
    let resolveQueue: ((items: ReviewQueueItem[]) => void) | undefined;
    const api = makeApi({
      getQueue: vi.fn().mockImplementation(() => new Promise<ReviewQueueItem[]>((resolve) => {
        resolveQueue = resolve;
      })),
    });

    render(<ReviewApp api={api} />);

    expect(screen.getByText('검수 목록을 불러오고 있어요')).toBeInTheDocument();
    resolveQueue?.([item]);

    expect(await screen.findByRole('heading', { name: '테스트견' })).toBeInTheDocument();
    const photo = screen.getByRole('img', { name: '테스트견 실사 사진 1' });
    expect(photo).toHaveAttribute('src', item.photoUrls[0]);
    expect(screen.getByRole('button', { name: '테스트견 승인' })).toBeDisabled();
    fireEvent.load(photo);
    expect(screen.getByRole('button', { name: '테스트견 승인' })).toBeEnabled();
    expect(screen.getByText('사진 있음')).toBeInTheDocument();
    expect(screen.getByLabelText('테스트견 강아지')).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('asks for confirmation, approves, removes the card, and shows a completion toast', async () => {
    const api = makeApi();
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });
    fireEvent.load(screen.getByRole('img', { name: '테스트견 실사 사진 1' }));

    fireEvent.click(screen.getByRole('button', { name: '테스트견 승인' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('테스트견 등록을 승인할까요?');

    fireEvent.click(screen.getByRole('button', { name: '승인 확정' }));

    await waitFor(() => {
      expect(api.review).toHaveBeenCalledWith({
        petId: item.petId,
        decision: 'approved',
      });
    });
    expect(await screen.findByText('검수할 강아지가 없어요')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('테스트견 등록을 승인했어요.');
  });

  it('requires a reason before rejecting and sends the trimmed reason', async () => {
    const api = makeApi();
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });

    fireEvent.click(screen.getByRole('button', { name: '테스트견 반려' }));
    const confirm = screen.getByRole('button', { name: '반려 확정' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: /반려 사유/ }), {
      target: { value: '  얼굴이 잘 보이는 사진이 필요해요.  ' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(api.review).toHaveBeenCalledWith({
        petId: item.petId,
        decision: 'rejected',
        reason: '얼굴이 잘 보이는 사진이 필요해요.',
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent('테스트견 등록을 반려했어요.');
  });

  it('disables approval when the photo is missing', async () => {
    const api = makeApi({
      getQueue: vi.fn().mockResolvedValue([{ ...item, photoPresent: false, photoUrls: [] }]),
    });
    render(<ReviewApp api={api} />);

    expect(await screen.findByRole('button', { name: '테스트견 승인' })).toBeDisabled();
    expect(screen.getByText('사진이 없어 승인할 수 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '테스트견 실사 사진 없음' })).toBeInTheDocument();
  });

  it('uses a safe label when the registered name is empty', async () => {
    const api = makeApi({
      getQueue: vi.fn().mockResolvedValue([{ ...item, name: null }]),
    });
    render(<ReviewApp api={api} />);

    expect(await screen.findByRole('heading', { name: '이름 없는 강아지' })).toBeInTheDocument();
    fireEvent.load(screen.getByRole('img', { name: '이름 없는 강아지 실사 사진 1' }));
    expect(screen.getByRole('button', { name: '이름 없는 강아지 승인' })).toBeEnabled();
    expect(screen.getByRole('img', { name: '이름 없는 강아지 실사 사진 1' })).toBeInTheDocument();
  });

  it('shows an error state and retries the queue request', async () => {
    const getQueue = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([]);
    const api = makeApi({ getQueue });
    render(<ReviewApp api={api} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('목록을 불러오지 못했어요');
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));

    expect(await screen.findByText('검수할 강아지가 없어요')).toBeInTheDocument();
    expect(getQueue).toHaveBeenCalledTimes(2);
  });
});
