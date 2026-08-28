import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

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

vi.mock('@toss/tds-mobile', async () => import('./web-preview/tds-mobile'));

vi.mock('./lib/api', () => apiMocks);

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

vi.mock('./lib/toss', () => ({
  sharePet: vi.fn(() => Promise.resolve()),
}));

vi.mock('./components/MyPetsScreen', () => ({
  MyPetsScreen: ({ pets, onUpload, onMeet }: {
    pets: typeof appHarness.submittedPet[];
    onUpload: () => void;
    onMeet: (pet: typeof appHarness.submittedPet) => void;
  }) => (
    <main>
      {pets.map((pet) => <button key={pet.id} type="button" onClick={() => onMeet(pet)}>{pet.name} 만나기</button>)}
      <button type="button" onClick={onUpload}>새 강아지 소개하기</button>
    </main>
  ),
}));

vi.mock('./components/UploadFlow', () => ({
  UploadFlow: ({ onSubmitted }: { onSubmitted: (result: typeof appHarness.submission) => void }) => (
    <main>
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
  await screen.findByText('강아지를 끌어 옮기거나, 톡 눌러 만나보세요');
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

    fireEvent.click(screen.getByRole('button', { name: '지금 만나보기' }));

    const playScene = await screen.findByTestId('play-scene');
    expect(playScene).toHaveAttribute('data-pet-id', 'submitted-pet');
    expect(playScene).toHaveAttribute('data-status', 'pending');
    expect(playScene).toHaveTextContent('보리와 노는 중');
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

  it('reopens an owner pending photo after feed, native back twice, and selecting the same mine card', async () => {
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
    apiMocks.revealPet.mockResolvedValue({
      photoUrl: 'https://example.test/first-owner-photo.jpg',
      signedUrlExpiresAt: '2026-08-28T02:10:00.000Z',
      revisitUntil: '2026-08-28T04:00:00.000Z',
      allowance: afterUpload,
    });
    apiMocks.openOwnerPhoto.mockResolvedValue({
      photoUrl: 'https://example.test/reopened-owner-photo.jpg',
      signedUrlExpiresAt: '2026-08-28T02:10:00.000Z',
      ownerPhotoAvailable: true,
    });

    render(<App />);
    await screen.findByText('강아지를 끌어 옮기거나, 톡 눌러 만나보세요');
    fireEvent.click(screen.getByRole('button', { name: '내가 소개한 강아지' }));
    fireEvent.click(await screen.findByRole('button', { name: '보리 만나기' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));

    expect(await screen.findByTestId('revealed-photo-url'))
      .toHaveTextContent('first-owner-photo.jpg');
    expect(apiMocks.revealPet).toHaveBeenCalledTimes(1);

    act(() => appHarness.navigationHandlers?.onBack());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument());
    act(() => appHarness.navigationHandlers?.onBack());
    await waitFor(() => expect(apiMocks.fetchMyPets).toHaveBeenCalledTimes(2));

    fireEvent.click(await screen.findByRole('button', { name: '보리 만나기' }));
    expect(await screen.findByTestId('revealed-photo-url'))
      .toHaveTextContent('reopened-owner-photo.jpg');
    expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
    expect(apiMocks.openOwnerPhoto).toHaveBeenCalledWith(expect.objectContaining({
      id: pendingOwner.id,
      ownerPhotoAvailable: true,
    }));
    expect(apiMocks.revealPet).toHaveBeenCalledTimes(1);
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
      date: '2026-08-28', freeUsed: 0, remaining: 2, rewardedUsed: 0,
      uploadCredit: false, uploadUsed: false,
    };
    const afterReveal = {
      ...initialAllowance,
      freeUsed: 1,
      remaining: 1,
      nextChargeAt: '2026-08-28T04:00:00.000Z',
    };
    const staleHouse = deferred<{ pets: typeof publicPet[]; allowance: typeof initialAllowance }>();
    const authoritativeHouse = deferred<{ pets: typeof publicPet[]; allowance: typeof afterReveal }>();
    apiMocks.fetchHouse
      .mockResolvedValueOnce({ pets: [publicPet], allowance: initialAllowance })
      .mockReturnValueOnce(staleHouse.promise)
      .mockReturnValueOnce(authoritativeHouse.promise)
      .mockResolvedValue({ pets: [publicPet], allowance: afterReveal });
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
    const afterMinute = Date.now() + 61_000;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(afterMinute);
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
    await waitFor(() => expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(3));

    act(() => appHarness.navigationHandlers?.onBack());
    act(() => appHarness.navigationHandlers?.onBack());
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
    await screen.findByText('강아지를 끌어 옮기거나, 톡 눌러 만나보세요');
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
    expect(apiMocks.fetchHouse).not.toHaveBeenCalled();
  });
});
