import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReviewApp, { reviewSimilarityScore } from './ReviewApp';
import type { ReviewApi, ReviewQueueItem } from './types';

const item: ReviewQueueItem = {
  petId: '11111111-1111-4111-8111-111111111111',
  name: '테스트견',
  createdAt: '2026-08-29T02:15:00.000Z',
  photoPresent: true,
  photoUrls: ['/api/review-photo/opaque-test-token'],
  accessorySelectionMode: 'reviewer',
  accessoryRequired: true,
  requestedAccessory: null,
  publishedAccessory: null,
  designVersion: 1,
  similarPets: [],
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
  submittedTraits: {
    schemaVersion: 1,
    earShape: 'floppy',
    headShape: 'round',
    baseColor: 'cream',
    secondaryColor: 'caramel',
    markingPattern: 'blaze',
    muzzle: 'short',
    confidence: 0.95,
  },
  submittedStyle: { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' },
  publishedStyle: { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' },
};

function makeApi(overrides: Partial<ReviewApi> = {}): ReviewApi {
  return {
    getQueue: vi.fn().mockResolvedValue([item]),
    saveDraft: vi.fn().mockImplementation(async ({ petId, document, editorState, expectedDraftRevision, expectedDesignVersion }) => ({
      petId, document, editorState, draftRevision: expectedDraftRevision + 1, expectedDesignVersion, sha256: 'a'.repeat(64),
    })),
    review: vi.fn().mockImplementation(async ({ petId, decision }) => ({ petId, status: decision })),
    getCatalog: vi.fn().mockResolvedValue([]),
    manage: vi.fn().mockImplementation(async ({ petId, action }) => ({ petId, status: action === 'pause' ? 'paused' : 'approved' })),
    ...overrides,
  };
}

describe('ReviewApp', () => {
  it('distinguishes a catalog connection failure from an empty search and preserves server errors', async () => {
    const api = makeApi({ getCatalog: vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new Error('검수 권한을 확인해 주세요.'))
      .mockResolvedValueOnce([]) });
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    expect(await screen.findByText('검수 서버에 연결하지 못했어요. 서버 실행 상태를 확인해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('조건에 맞는 승인 강아지가 없어요.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    expect(await screen.findByText('검수 권한을 확인해 주세요.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    expect(await screen.findByText('조건에 맞는 승인 강아지가 없어요.')).toBeInTheDocument();
  });
  it('requires all five full photos to be viewed before opening approval', async () => {
    const photoUrls = Array.from({ length: 5 }, (_, index) => `/api/review-photo/photo-${index}`);
    const api = makeApi({ getQueue: vi.fn().mockResolvedValue([{ ...item, photoUrls, photoCount: 5 }]) });
    render(<ReviewApp api={api} />);
    const approve = await screen.findByRole('button', { name: '테스트견 승인' });
    expect(approve).toBeDisabled();
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: `테스트견 사진 ${index + 1} 보기` }));
      const photo = screen.getByRole('img', { name: `테스트견 실사 사진 ${index + 1}` });
      expect(photo).toHaveAttribute('src', photoUrls[index]);
      expect(approve).toBeDisabled();
      fireEvent.load(photo);
      if (index < 4) expect(approve).toBeDisabled();
    }
    expect(approve).toBeEnabled();
    expect(api.review).not.toHaveBeenCalled();
  });

  it('does not approve a batch when one photo failed to load or sign', async () => {
    const api = makeApi({ getQueue: vi.fn().mockResolvedValue([{ ...item, photoCount: 2 }]) });
    render(<ReviewApp api={api} />);
    const approve = await screen.findByRole('button', { name: '테스트견 승인' });
    fireEvent.load(screen.getByRole('img', { name: '테스트견 실사 사진 1' }));
    expect(approve).toBeDisabled();
    expect(screen.getByText(/일부 사진을 불러오지 못했어요/)).toBeInTheDocument();
    expect(api.review).not.toHaveBeenCalled();
  });

  it('keeps approval disabled if a second full photo fails to load', async () => {
    const api = makeApi({ getQueue: vi.fn().mockResolvedValue([{ ...item, photoUrls: [...item.photoUrls, '/api/review-photo/broken'], photoCount: 2 }]) });
    render(<ReviewApp api={api} />);
    const approve = await screen.findByRole('button', { name: '테스트견 승인' });
    fireEvent.load(screen.getByRole('img', { name: '테스트견 실사 사진 1' }));
    fireEvent.click(screen.getByRole('button', { name: '테스트견 사진 2 보기' }));
    fireEvent.error(screen.getByRole('img', { name: '테스트견 실사 사진 2' }));
    expect(approve).toBeDisabled();
    expect(screen.getByText('사진을 불러올 수 없어요')).toBeInTheDocument();
  });

  it('does not approve when saving the SVG draft fails', async () => {
    const api = makeApi({ saveDraft: vi.fn().mockRejectedValueOnce(new Error('SVG 저장 실패')) });
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });
    fireEvent.load(screen.getByRole('img', { name: '테스트견 실사 사진 1' }));
    fireEvent.click(screen.getByRole('button', { name: '테스트견 승인' }));
    fireEvent.click(screen.getByRole('button', { name: '승인 확정' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('SVG 저장 실패');
    expect(api.review).not.toHaveBeenCalled();
  });
  it('scores an identical reviewed design at 100', () => {
    expect(reviewSimilarityScore(item.traits, item.publishedStyle, item.traits, item.publishedStyle)).toBe(100);
  });

  it('does not call a partially matching design similar', () => {
    expect(reviewSimilarityScore(
      item.traits,
      item.publishedStyle,
      { ...item.traits, secondaryColor: 'white' },
      item.publishedStyle,
    )).toBe(0);
  });

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
    expect(screen.getAllByLabelText('테스트견 강아지')).toHaveLength(3);
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
        decision: 'approved', expectedDraftRevision: 1, expectedDesignVersion: 1,
        finalName: '테스트견',
        reviewNote: '',
      });
    });
    expect(await screen.findByText('검수할 강아지가 없어요')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('테스트견 등록을 승인했어요.');
  });

  it('shows Titi curated draft and prepares the corrected name and gray solid design', async () => {
    const titi = {
      ...item,
      petId: '36d0b0eb-32b6-48d7-b505-31a58d4bf4f7',
      name: null,
      submittedTraits: { ...item.submittedTraits, baseColor: 'gray' as const, secondaryColor: 'white' as const, markingPattern: 'brow' as const },
    };
    const api = makeApi({ getQueue: vi.fn().mockResolvedValue([titi]) });
    const { container } = render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '이름 없는 강아지' });
    expect(screen.getByText('검수 제안 있음')).toBeInTheDocument();
    expect(screen.getByText(/전용 산책 가방/)).toBeInTheDocument();
    expect(container.querySelector('[data-pet-signature="gray-backpack"]')).toBeInTheDocument();

    fireEvent.load(screen.getByRole('img', { name: '이름 없는 강아지 실사 사진 1' }));
    fireEvent.click(screen.getByRole('button', { name: '이름 없는 강아지 승인' }));
    expect(screen.getByRole('textbox', { name: /최종 이름/ })).toHaveValue('티티');
    expect(screen.getByLabelText('최종 캐릭터 보정').querySelector('[data-coat-mode="solid"]')).toBeInTheDocument();
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
        reason: '얼굴이 잘 보이는 사진이 필요해요.', reviewNote: '',
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent('등록을 반려했어요.');
  });

  it('lets the reviewer choose a delegated accessory and stores only the final choice and note', async () => {
    const api = makeApi();
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });
    fireEvent.load(screen.getByRole('img', { name: '테스트견 실사 사진 1' }));
    fireEvent.click(screen.getByRole('button', { name: '테스트견 승인' }));

    fireEvent.click(screen.getByRole('button', { name: '스카프' }));
    fireEvent.click(screen.getByRole('button', { name: '민트' }));
    fireEvent.change(screen.getByRole('textbox', { name: /검수 메모/ }), { target: { value: '  흰 털에서 대비 확인  ' } });
    fireEvent.click(screen.getByRole('button', { name: '승인 확정' }));

    await waitFor(() => expect(api.review).toHaveBeenCalledWith({
      petId: item.petId,
      decision: 'approved', expectedDraftRevision: 1, expectedDesignVersion: 1,
      finalName: '테스트견',

      reviewNote: '흰 털에서 대비 확인',
    }));
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ editorState: expect.objectContaining({ publishedAccessory: { kind: 'scarf', color: 'mint', assetKey: 'builtin:scarf' } }) }));
  });

  it('preserves the original request while letting the creator replace its final accessory', async () => {
    const lockedAccessory = { kind: 'ball', color: 'yellow', assetKey: 'builtin:ball' } as const;
    const api = makeApi({
      getQueue: vi.fn().mockResolvedValue([{
        ...item,
        accessorySelectionMode: 'owner',
        requestedAccessory: lockedAccessory,
        publishedAccessory: lockedAccessory,
      }]),
    });
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });
    fireEvent.load(screen.getByRole('img', { name: '테스트견 실사 사진 1' }));
    fireEvent.click(screen.getByRole('button', { name: '테스트견 승인' }));

    expect(screen.getByRole('button', { name: '애착 공' })).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: '애착 공' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '스카프' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '스카프' }));
    expect(screen.getByText(/사용자가 고른 원래 소품/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '승인 확정' }));

    await waitFor(() => expect(api.review).toHaveBeenCalledWith({
      petId: item.petId,
      decision: 'approved', expectedDraftRevision: 1, expectedDesignVersion: 1,
      finalName: '테스트견',
      reviewNote: '',
    }));
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ editorState: expect.objectContaining({ publishedAccessory: { kind: 'scarf', color: 'yellow', assetKey: 'builtin:scarf' } }) }));
    expect(lockedAccessory.kind).toBe('ball');
  });

  it('keeps the submitted photo and 64/114/190 final previews together in the approval editor', async () => {
    const api = makeApi();
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });
    fireEvent.load(screen.getByRole('img', { name: '테스트견 실사 사진 1' }));
    fireEvent.click(screen.getByRole('button', { name: '테스트견 승인' }));

    expect(screen.getByRole('img', { name: '테스트견 검수 실사' })).toBeInTheDocument();
    const previews = screen.getByLabelText('최종 크기 미리보기');
    expect(within(previews).getByText('64px')).toBeInTheDocument();
    expect(within(previews).getByText('114px')).toBeInTheDocument();
    expect(within(previews).getByText('190px')).toBeInTheDocument();
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

  it('finds an approved dog by name and pauses it with an audit note', async () => {
    const catalogItem = {
      petId: item.petId,
      name: '우유',
      status: 'approved' as const,
      traits: item.traits,
      publishedStyle: item.publishedStyle,
      publishedAccessory: null,
      designVersion: 2,
    };
    const api = makeApi({ getCatalog: vi.fn().mockResolvedValue([catalogItem]) });
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });

    fireEvent.change(screen.getByPlaceholderText('예: 우유 또는 강아지 ID'), { target: { value: '우유' } });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    expect(await screen.findByText('우유', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '공개 중지' }));
    fireEvent.change(screen.getByRole('textbox', { name: /변경 메모/ }), { target: { value: '원본 재확인' } });
    fireEvent.click(screen.getByRole('button', { name: '공개 중지 확정' }));

    await waitFor(() => expect(api.manage).toHaveBeenCalledWith({
      petId: item.petId,
      action: 'pause',
      reviewNote: '원본 재확인', expectedDesignVersion: 2, expectedDraftRevision: undefined,
    }));
  });

  it('shows only an exact decoration match without forcing a review note', async () => {
    const api = makeApi({
      getQueue: vi.fn().mockResolvedValue([{ ...item, similarPets: [{ id: 'similar', name: '닮은이', traits:item.traits, publishedStyle:item.publishedStyle }] }]),
    });
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });
    fireEvent.load(screen.getByRole('img', { name: '테스트견 실사 사진 1' }));
    fireEvent.click(screen.getByRole('button', { name: '테스트견 승인' }));

    expect(screen.getByText(/모든 꾸밈 설정이 같은 승인 강아지/)).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: '승인 확정' });
    expect(approve).toBeEnabled();
  });
  it('saves a private draft without approval and uses its new revision on the next save', async () => {
    const api = makeApi();
    render(<ReviewApp api={api} />);
    await screen.findByRole('heading', { name: '테스트견' });
    fireEvent.load(screen.getByRole('img', { name: '테스트견 실사 사진 1' }));
    fireEvent.click(screen.getByRole('button', { name: '테스트견 승인' }));
    fireEvent.click(screen.getByRole('button', { name: '초안 저장' }));
    await screen.findByText('SVG 초안을 저장하고 DB 저장본을 다시 불러왔어요.');
    expect(api.review).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '승인 확정' }));
    await waitFor(() => expect(api.review).toHaveBeenCalledWith(expect.objectContaining({ expectedDraftRevision: 2 })));
    expect(api.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ expectedDraftRevision: 1 }));
  });

});
