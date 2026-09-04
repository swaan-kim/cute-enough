import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getKstDate } from './lib/allowance';

const appHarness = vi.hoisted(() => {
  const submittedPet = {
    id: 'submitted-pet',
    name: '보리',
    traits: {
      schemaVersion: 1 as const,
      earShape: 'floppy' as const,
      headShape: 'round' as const,
      baseColor: 'cream' as const,
      secondaryColor: 'caramel' as const,
      markingPattern: 'none' as const,
      muzzle: 'short' as const,
      confidence: 0.94,
    },
    photoAvailable: true,
    isMine: true,
    ownerPinned: true,
    approvalStatus: 'pending' as const,
    shareable: true,
  };

  return {
    submittedPet,
    submission: {
      pet: submittedPet,
      rewardGranted: true,
      uploadRewardPetId: submittedPet.id,
    },
    initialSharedPetId: undefined as string | undefined,
    navigationHandlers: undefined as undefined | { onBack: () => void; onHome: () => void },
  };
});

const apiMocks = vi.hoisted(() => ({
  fetchHouse: vi.fn(),
  fetchMyPets: vi.fn(),
  fetchSharedPet: vi.fn(),
  openOwnerPhoto: vi.fn(),
  reopenPet: vi.fn(),
  reportPet: vi.fn(),
  revealPet: vi.fn(),
}));

const hapticMocks = vi.hoisted(() => ({
  playHaptic: vi.fn(() => Promise.resolve()),
}));

const analyticsMocks = vi.hoisted(() => ({
  trackProductEvent: vi.fn(),
}));

const tossMocks = vi.hoisted(() => ({
  sharePet: vi.fn(() => Promise.resolve()),
}));

vi.mock('@toss/tds-mobile', async () => import('./web-preview/tds-mobile'));

vi.mock('./lib/api', () => apiMocks);
vi.mock('./lib/haptics', () => hapticMocks);
vi.mock('./lib/analytics', () => analyticsMocks);

vi.mock('./lib/nativeNavigation', () => ({
  closeMiniApp: vi.fn(() => Promise.resolve()),
  getInitialSharedPetId: vi.fn(() => appHarness.initialSharedPetId),
  subscribeNativeNavigation: vi.fn((handlers: { onBack: () => void; onHome: () => void }) => {
    appHarness.navigationHandlers = handlers;
    return () => {
      if (appHarness.navigationHandlers === handlers) appHarness.navigationHandlers = undefined;
    };
  }),
}));

vi.mock('./lib/rewardedAd', () => ({
  getRewardedAdStatus: vi.fn(() => 'disabled'),
  preloadRewardedAd: vi.fn(() => Promise.resolve()),
  showRewardedAd: vi.fn(() => Promise.reject(new Error('not used in this test'))),
  subscribeRewardedAdStatus: vi.fn(() => () => undefined),
}));

vi.mock('./lib/runtime', () => ({
  isPreviewRuntime: false,
  rewardedAdsEnabled: false,
}));

vi.mock('./lib/safeArea', () => ({
  subscribeSafeArea: vi.fn(() => () => undefined),
}));

vi.mock('./lib/sound', () => ({
  getPetSoundVariant: vi.fn(() => 0),
  playSoundEffect: vi.fn(),
  readSoundEnabled: vi.fn(() => true),
  resumeSound: vi.fn(() => Promise.resolve()),
  saveSoundEnabled: vi.fn(),
  suspendSound: vi.fn(() => Promise.resolve()),
}));

vi.mock('./lib/toss', () => tossMocks);

vi.mock('./components/MyPetsScreen', () => ({
  MyPetsScreen: ({ pets, onUpload, onMeet, onShare }: {
    pets: typeof appHarness.submittedPet[];
    onUpload: () => void;
    onMeet: (pet: typeof appHarness.submittedPet) => void;
    onShare: (pet: typeof appHarness.submittedPet) => void;
  }) => (
    <main>
      {pets.map((pet) => <div key={pet.id}>
        <button type="button" onClick={() => onMeet(pet)}>{pet.name} 만나기</button>
        <button type="button" onClick={() => onShare(pet)}>{pet.name} 공유하기</button>
      </div>)}
      <button type="button" onClick={onUpload}>새 강아지 소개하기</button>
    </main>
  ),
}));

vi.mock('./components/UploadFlow', () => ({
  UploadFlow: ({ onSubmitted }: { onSubmitted: (result: typeof appHarness.submission) => void }) => (
    <main>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('cute-enough:upload-dirty-change', { detail: { dirty: true } }))}>초안 변경</button>
      <button type="button" onClick={() => onSubmitted(appHarness.submission)}>pending 등록 완료</button>
    </main>
  ),
}));

vi.mock('./components/SharedPetLanding', () => ({
  SharedPetLanding: () => <main>공유 화면</main>,
}));

vi.mock('./components/PetArtwork', () => ({
  PetArtwork: ({ pet }: { pet?: typeof appHarness.submittedPet }) => (
    <div
      data-testid={pet ? `pet-artwork-${pet.id}` : 'pet-artwork'}
      data-status={pet?.approvalStatus}
    >
      {pet?.name ?? '이름 없는 강아지'} 캐릭터
    </div>
  ),
}));

vi.mock('./components/PlayScene', () => ({
  PlayScene: ({ pet, onFed }: { pet: typeof appHarness.submittedPet; onFed: () => void }) => (
    <main data-testid="play-scene" data-pet-id={pet.id} data-status={pet.approvalStatus}>
      {pet.name}와 노는 중
      <button type="button" onClick={onFed}>간식 주기</button>
    </main>
  ),
}));

vi.mock('./components/RevealCard', () => ({
  RevealCard: ({ pet, photoUrl, onClose, onRetryPhoto, onReport }: {
    pet: typeof appHarness.submittedPet;
    photoUrl: string;
    onClose: () => void;
    onRetryPhoto?: () => Promise<void> | void;
    onReport: () => Promise<void> | void;
  }) => (
    <div role="dialog" aria-label="강아지 실사 사진">
      <span>{pet.name} 사진</span>
      <span data-testid="revealed-photo-url">{photoUrl}</span>
      <button type="button" onClick={onClose}>사진 닫기</button>
      {onRetryPhoto && <button type="button" onClick={() => { void Promise.resolve(onRetryPhoto()).catch(() => undefined); }}>사진 다시 불러오기</button>}
      <button type="button" onClick={() => { void Promise.resolve(onReport()).catch(() => undefined); }}>이 사진 신고하기</button>
    </div>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function openUploadAndSubmit() {
  await screen.findByRole('region', { name: '강아지들이 있는 집' });
  fireEvent.click(screen.getByRole('button', { name: '내가 소개한 강아지' }));
  fireEvent.click(await screen.findByRole('button', { name: '새 강아지 소개하기' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pending 등록 완료' }));
  await screen.findByRole('heading', { name: '보리가 집에 놀러 왔어요' });
}

describe('App upload submission integration', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    appHarness.initialSharedPetId = undefined;
    appHarness.navigationHandlers = undefined;
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    hapticMocks.playHaptic.mockClear();
    analyticsMocks.trackProductEvent.mockClear();
    tossMocks.sharePet.mockClear();
    tossMocks.sharePet.mockResolvedValue(undefined);
    apiMocks.fetchMyPets.mockResolvedValue([]);
    apiMocks.openOwnerPhoto.mockRejectedValue(new Error('owner photo mock not configured'));
    apiMocks.reopenPet.mockRejectedValue(new Error('reopen mock not configured'));
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: (id: number) => window.clearTimeout(id),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the submitted pending character and name, then opens it from 지금 만나보기', async () => {
    apiMocks.fetchHouse
      .mockResolvedValueOnce({ pets: [] })
      .mockResolvedValueOnce({ pets: [appHarness.submittedPet] });

    render(<App />);
    await openUploadAndSubmit();

    expect(screen.getByText('검수 중')).toBeInTheDocument();
    expect(screen.getByTestId('pet-artwork-submitted-pet'))
      .toHaveAttribute('data-status', 'pending');
    expect(screen.getByTestId('pet-artwork-submitted-pet'))
      .toHaveTextContent('보리 캐릭터');
    expect(hapticMocks.playHaptic).toHaveBeenCalledOnce();
    expect(hapticMocks.playHaptic).toHaveBeenCalledWith('uploadSuccess');

    fireEvent.click(screen.getByRole('button', { name: '지금 만나보기' }));

    const playScene = await screen.findByTestId('play-scene');
    expect(playScene).toHaveAttribute('data-pet-id', 'submitted-pet');
    expect(playScene).toHaveAttribute('data-status', 'pending');
    expect(playScene).toHaveTextContent('보리와 노는 중');
    expect(screen.queryByText('화면을 준비하고 있어요…')).not.toBeInTheDocument();
  });

  it('asks once before discarding a changed upload draft on native back', async () => {
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    render(<App />);

    await screen.findByRole('region', { name: '강아지들이 있는 집' });
    fireEvent.click(screen.getByRole('button', { name: '내가 소개한 강아지' }));
    fireEvent.click(await screen.findByRole('button', { name: '새 강아지 소개하기' }));
    fireEvent.click(await screen.findByRole('button', { name: '초안 변경' }));

    act(() => appHarness.navigationHandlers?.onBack());
    expect(await screen.findByText('작성 중인 내용을 나갈까요?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '초안 변경' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    expect(await screen.findByRole('button', { name: '새 강아지 소개하기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '초안 변경' })).not.toBeInTheDocument();
  });

  it('keeps the optimistic pending character visible at home when post-submit house reloads fail', async () => {
    const postSubmitReload = deferred<{ pets: never[] }>();
    const reloadError = new Error('house unavailable');
    apiMocks.fetchHouse
      .mockResolvedValueOnce({ pets: [] })
      .mockReturnValueOnce(postSubmitReload.promise)
      .mockRejectedValueOnce(reloadError);

    render(<App />);
    await openUploadAndSubmit();
    await waitFor(() => expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(2));

    await act(async () => {
      postSubmitReload.reject(reloadError);
      await postSubmitReload.promise.catch(() => undefined);
    });

    expect(appHarness.navigationHandlers).toBeDefined();
    act(() => appHarness.navigationHandlers?.onHome());

    await waitFor(() => expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('button', { name: '새 친구를 불러오지 못했어요 · 다시 눌러보기' }))
      .toBeInTheDocument();
    expect(screen.queryByText('잠시 뒤 다시 불러와 주세요')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '강아지들이 있는 집' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보리 옮기기 또는 선택' })).toBeInTheDocument();
    expect(screen.getByTestId('pet-artwork-submitted-pet')).toHaveAttribute('data-status', 'pending');
    expect(screen.getByText('내 강아지')).toBeInTheDocument();
  });

  it('opens an owner pending photo directly and reopens it without feed or allowance use', async () => {
    const pendingOwner = {
      ...appHarness.submittedPet,
      ownerPhotoAvailable: true,
    };
    const beforeUpload = {
      date: '2026-08-28', freeUsed: 0, remaining: 2, rewardedUsed: 0,
      uploadCredit: true, uploadUsed: false, uploadRewardPetId: pendingOwner.id,
    };
    const afterUpload = {
      ...beforeUpload,
      uploadUsed: true,
    };
    apiMocks.fetchHouse
      .mockResolvedValueOnce({ pets: [], allowance: beforeUpload })
      .mockResolvedValue({ pets: [], allowance: afterUpload });
    apiMocks.fetchMyPets.mockResolvedValue([pendingOwner]);
    apiMocks.openOwnerPhoto
      .mockResolvedValueOnce({
        photoUrl: 'https://example.test/first-owner-photo.jpg',
        signedUrlExpiresAt: '2026-08-28T02:10:00.000Z',
        ownerPhotoAvailable: true,
      })
      .mockResolvedValueOnce({
        photoUrl: 'https://example.test/reopened-owner-photo.jpg',
        signedUrlExpiresAt: '2026-08-28T02:20:00.000Z',
        ownerPhotoAvailable: true,
      });

    render(<App />);
    await screen.findByRole('region', { name: '강아지들이 있는 집' });
    fireEvent.click(screen.getByRole('button', { name: '내가 소개한 강아지' }));
    fireEvent.click(await screen.findByRole('button', { name: '보리 만나기' }));

    expect(await screen.findByTestId('revealed-photo-url'))
      .toHaveTextContent('first-owner-photo.jpg');
    expect(screen.queryByText('사진 화면을 준비하고 있어요')).not.toBeInTheDocument();
    expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
    expect(apiMocks.openOwnerPhoto).toHaveBeenCalledTimes(1);
    expect(apiMocks.revealPet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument());

    fireEvent.click(await screen.findByRole('button', { name: '보리 만나기' }));
    expect(await screen.findByTestId('revealed-photo-url'))
      .toHaveTextContent('reopened-owner-photo.jpg');
    expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
    expect(apiMocks.openOwnerPhoto).toHaveBeenCalledWith(expect.objectContaining({
      id: pendingOwner.id,
      ownerPhotoAvailable: true,
    }));
    expect(apiMocks.openOwnerPhoto).toHaveBeenCalledTimes(2);
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
  });

  it('does not let a pre-reveal house response erase the direct revisit state', async () => {
    const publicPet = {
      ...appHarness.submittedPet,
      id: 'public-pet',
      name: '초코',
      isMine: false,
      ownerPinned: false,
      approvalStatus: 'approved' as const,
      photoAvailable: true,
    };
    const initialAllowance = {
      date: getKstDate(), freeUsed: 0, remaining: 2, rewardedUsed: 0,
      uploadCredit: false, uploadUsed: false,
    };
    const afterReveal = {
      ...initialAllowance,
      freeUsed: 1,
      remaining: 1,
      nextChargeAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    };
    const staleHouse = deferred<{ pets: typeof publicPet[]; allowance: typeof initialAllowance }>();
    const authoritativePet = {
      ...publicPet,
      revisitUntil: '2099-08-28T04:00:00.000Z',
      revealedToday: true,
    };
    apiMocks.fetchHouse
      .mockResolvedValueOnce({ pets: [publicPet], allowance: initialAllowance })
      .mockReturnValueOnce(staleHouse.promise)
      .mockResolvedValue({ pets: [authoritativePet], allowance: afterReveal });
    apiMocks.revealPet.mockResolvedValue({
      photoUrl: 'https://example.test/first-public-photo.jpg',
      signedUrlExpiresAt: '2026-08-28T02:10:00.000Z',
      revisitUntil: '2099-08-28T04:00:00.000Z',
      allowance: afterReveal,
    });
    apiMocks.reopenPet.mockResolvedValue({
      photoUrl: 'https://example.test/reopened-public-photo.jpg',
      signedUrlExpiresAt: '2026-08-28T02:10:00.000Z',
      revisitUntil: '2099-08-28T04:00:00.000Z',
      allowance: afterReveal,
    });

    render(<App />);
    const dogButton = await screen.findByRole('button', { name: '초코 옮기기 또는 선택' });
    const afterSWRWindow = Date.now() + 5 * 60_000 + 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(afterSWRWindow);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(2));
    dateNow.mockRestore();

    fireEvent.click(dogButton);
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    expect(await screen.findByTestId('revealed-photo-url')).toHaveTextContent('first-public-photo.jpg');

    await act(async () => {
      staleHouse.resolve({ pets: [publicPet], allowance: initialAllowance });
      await staleHouse.promise;
    });
    await waitFor(() => expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    fireEvent.click(await screen.findByRole('button', { name: '초코 옮기기 또는 선택' }));

    expect(await screen.findByTestId('revealed-photo-url'))
      .toHaveTextContent('reopened-public-photo.jpg');
    expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
    expect(apiMocks.reopenPet).toHaveBeenCalledTimes(1);
    expect(apiMocks.revealPet).toHaveBeenCalledTimes(1);
  });

  it('retries a failed owner photo with ownerPhoto and keeps the mine route underneath', async () => {
    const pendingOwner = { ...appHarness.submittedPet, ownerPhotoAvailable: true };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchMyPets.mockResolvedValue([pendingOwner]);
    apiMocks.openOwnerPhoto
      .mockResolvedValueOnce({
        photoUrl: 'https://example.test/owner-first.jpg',
        signedUrlExpiresAt: '2026-08-28T02:10:00.000Z',
        ownerPhotoAvailable: true,
      })
      .mockRejectedValueOnce(new Error('새 사진 주소를 받지 못했어요.'))
      .mockResolvedValueOnce({
        photoUrl: 'https://example.test/owner-refreshed.jpg',
        signedUrlExpiresAt: '2026-08-28T02:20:00.000Z',
        ownerPhotoAvailable: true,
      });

    render(<App />);
    await screen.findByRole('region', { name: '강아지들이 있는 집' });
    fireEvent.click(screen.getByRole('button', { name: '내가 소개한 강아지' }));
    fireEvent.click(await screen.findByRole('button', { name: '보리 만나기' }));
    expect(await screen.findByTestId('revealed-photo-url')).toHaveTextContent('owner-first.jpg');

    fireEvent.click(screen.getByRole('button', { name: '사진 다시 불러오기' }));
    expect(await screen.findByText('새 사진 주소를 받지 못했어요.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '강아지 실사 사진' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '사진 다시 불러오기' }));
    expect(await screen.findByTestId('revealed-photo-url')).toHaveTextContent('owner-refreshed.jpg');
    expect(apiMocks.openOwnerPhoto).toHaveBeenCalledTimes(3);
    expect(apiMocks.reopenPet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    expect(await screen.findByRole('button', { name: '보리 만나기' })).toBeInTheDocument();
  });

  it('keeps the photo open when reporting fails and returns home only after success', async () => {
    const publicPet = {
      ...appHarness.submittedPet,
      id: 'report-pet',
      name: '하늘',
      isMine: false,
      ownerPinned: false,
      approvalStatus: 'approved' as const,
      ownerPhotoAvailable: false,
      revisitUntil: '2099-08-28T04:00:00.000Z',
    };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [publicPet] });
    apiMocks.reopenPet.mockResolvedValue({
      photoUrl: 'https://example.test/report-photo.jpg',
      signedUrlExpiresAt: '2026-08-28T02:10:00.000Z',
      revisitUntil: publicPet.revisitUntil,
      allowance: {
        date: '2026-08-28', freeUsed: 0, remaining: 2, rewardedUsed: 0,
        uploadCredit: false, uploadUsed: false,
      },
    });
    apiMocks.reportPet
      .mockRejectedValueOnce(new Error('신고를 접수하지 못했어요.'))
      .mockResolvedValueOnce(undefined);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '하늘 옮기기 또는 선택' }));
    await screen.findByRole('dialog', { name: '강아지 실사 사진' });

    fireEvent.click(screen.getByRole('button', { name: '이 사진 신고하기' }));
    expect(await screen.findByText('신고를 접수하지 못했어요.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '강아지 실사 사진' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '이 사진 신고하기' }));
    expect(await screen.findByText('신고가 접수됐어요. 확인 후 처리할게요.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '강아지들이 있는 집' })).toBeInTheDocument();
  });

  it('lets a shared-link fetch failure retry without leaving the shared route', async () => {
    appHarness.initialSharedPetId = 'shared-pet';
    apiMocks.fetchSharedPet
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce({ pet: { ...appHarness.submittedPet, id: 'shared-pet', name: '구르미' } });

    render(<App />);
    expect(await screen.findByText('이 친구는 지금 만날 수 없어요.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 확인하기' }));
    expect(await screen.findByText('공유 화면')).toBeInTheDocument();
    expect(apiMocks.fetchSharedPet).toHaveBeenCalledTimes(2);
    expect(apiMocks.fetchSharedPet).toHaveBeenNthCalledWith(1, 'shared-pet', expect.any(AbortSignal));
    expect(apiMocks.fetchSharedPet).toHaveBeenNthCalledWith(2, 'shared-pet', expect.any(AbortSignal));
    expect(apiMocks.fetchHouse).not.toHaveBeenCalled();
  });

  it('cancels an older shared refresh before applying the newest response', async () => {
    const firstRequest = deferred<{ pet: typeof appHarness.submittedPet }>();
    appHarness.initialSharedPetId = 'shared-pet';
    apiMocks.fetchSharedPet
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce({ pet: { ...appHarness.submittedPet, id: 'shared-pet', name: '최신친구' } });

    render(<App />);
    await waitFor(() => expect(apiMocks.fetchSharedPet).toHaveBeenCalledTimes(1));
    const firstSignal = apiMocks.fetchSharedPet.mock.calls[0][1] as AbortSignal;
    act(() => window.dispatchEvent(new Event('focus')));

    expect(await screen.findByText('공유 화면')).toBeInTheDocument();
    expect(apiMocks.fetchSharedPet).toHaveBeenCalledTimes(2);
    expect(firstSignal.aborted).toBe(true);
    firstRequest.resolve({ pet: appHarness.submittedPet });
  });

  it('logs a successful share started from 내가 소개한 강아지', async () => {
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchMyPets.mockResolvedValue([appHarness.submittedPet]);

    render(<App />);
    await screen.findByRole('region', { name: '강아지들이 있는 집' });
    fireEvent.click(screen.getByRole('button', { name: '내가 소개한 강아지' }));
    fireEvent.click(await screen.findByRole('button', { name: '보리 공유하기' }));

    await waitFor(() => expect(tossMocks.sharePet).toHaveBeenCalledWith('submitted-pet', '보리'));
    expect(analyticsMocks.trackProductEvent).toHaveBeenCalledWith('share_complete', { entry_point: 'mine' });
    expect(await screen.findByText('공유할 곳을 골라주세요.')).toBeInTheDocument();
  });

  it('cancels an older 내가 소개한 강아지 refresh before applying the newest list', async () => {
    const firstRequest = deferred<(typeof appHarness.submittedPet)[]>();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchMyPets
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce([{ ...appHarness.submittedPet, name: '최신보리' }]);

    render(<App />);
    await screen.findByRole('region', { name: '강아지들이 있는 집' });
    fireEvent.click(screen.getByRole('button', { name: '내가 소개한 강아지' }));
    await waitFor(() => expect(apiMocks.fetchMyPets).toHaveBeenCalledTimes(1));
    const firstSignal = apiMocks.fetchMyPets.mock.calls[0][0] as AbortSignal;
    act(() => window.dispatchEvent(new Event('focus')));

    expect(await screen.findByRole('button', { name: '최신보리 만나기' })).toBeInTheDocument();
    expect(apiMocks.fetchMyPets).toHaveBeenCalledTimes(2);
    expect(firstSignal.aborted).toBe(true);
    firstRequest.resolve([]);
  });
});
