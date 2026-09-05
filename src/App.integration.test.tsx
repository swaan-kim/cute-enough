import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getKstDate } from './lib/allowance';
import { enqueueRewardRecovery, readActiveRewardSessions, readRewardRecovery, rememberActiveRewardSession } from './lib/rewardRecovery';

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
    adsEnabled: false,
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
  fetchRewardStatus: vi.fn(),
  startAdReward: vi.fn(),
  completeAdReward: vi.fn(),
  cancelAdReward: vi.fn(),
  rebindAdReward: vi.fn(),
  startShareReward: vi.fn(),
  recordShareReward: vi.fn(),
  closeShareReward: vi.fn(),
  fetchRechargeNotificationSettings: vi.fn(),
  setRechargeNotificationSettings: vi.fn(),
}));

const rewardMocks = vi.hoisted(() => ({
  openShareReward: vi.fn(),
  supportsShareReward: vi.fn(() => true),
  showRewardedAd: vi.fn(),
  requestRechargeNotificationAgreement: vi.fn(),
}));
vi.mock('./lib/shareReward', () => ({ openShareReward: rewardMocks.openShareReward, supportsShareReward: rewardMocks.supportsShareReward }));
vi.mock('./lib/rechargeNotification', () => ({ requestRechargeNotificationAgreement: rewardMocks.requestRechargeNotificationAgreement }));

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
  getRewardedAdStatus: vi.fn(() => appHarness.adsEnabled ? 'loaded' : 'disabled'),
  preloadRewardedAd: vi.fn(() => Promise.resolve()),
  showRewardedAd: rewardMocks.showRewardedAd,
  subscribeRewardedAdStatus: vi.fn(() => () => undefined),
}));

vi.mock('./lib/runtime', () => ({
  isPreviewRuntime: false,
  get rewardedAdsEnabled() { return appHarness.adsEnabled; },
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
  SharedPetLanding: ({ pet }: { pet: typeof appHarness.submittedPet }) => <main data-testid="shared-screen" data-status={pet.approvalStatus}>공유 화면</main>,
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
  RevealCard: ({ pet, photoUrl, onClose, onRetryPhoto, onReport, retryPhotoLabel }: {
    pet: typeof appHarness.submittedPet;
    photoUrl: string;
    onClose: () => void;
    onRetryPhoto?: () => Promise<void> | void;
    onReport: () => Promise<void> | void;
    retryPhotoLabel?: string;
  }) => (
    <div role="dialog" aria-label="강아지 실사 사진">
      <span>{pet.name} 사진</span>
      <span data-testid="revealed-photo-url">{photoUrl}</span>
      <button type="button" onClick={onClose}>사진 닫기</button>
      {onRetryPhoto && <button type="button" onClick={() => { void Promise.resolve(onRetryPhoto()).catch(() => undefined); }}>{retryPhotoLabel ?? '사진 다시 불러오기'}</button>}
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
    appHarness.adsEnabled = false;
    appHarness.navigationHandlers = undefined;
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    Object.values(rewardMocks).forEach((mock) => mock.mockReset());
    rewardMocks.supportsShareReward.mockReturnValue(true);
    apiMocks.fetchRewardStatus.mockRejectedValue(new Error('legacy server'));
    apiMocks.fetchRechargeNotificationSettings.mockResolvedValue({ enabled: false, available: false });
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

  it('retries an uncertain first reveal with the original method and request ID', async () => {
    const pet = { ...appHarness.submittedPet, id: 'retry-first', isMine: false, ownerPinned: false, approvalStatus: 'approved' as const };
    const allowance = { date: getKstDate(), freeUsed: 0, remaining: 2, rewardedUsed: 0, uploadCredit: false, uploadUsed: false };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance });
    apiMocks.revealPet.mockRejectedValueOnce(new Error('응답을 확인하지 못했어요.')).mockResolvedValueOnce({
      photoUrl: 'https://example.test/retried.jpg', signedUrlExpiresAt: '2099-09-05T12:00:00Z',
      allowance: { ...allowance, freeUsed: 1, remaining: 1 }, revisitUntil: '2099-09-05T12:00:00Z',
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '보리 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    await screen.findByText('응답을 확인하지 못했어요.');
    const original = apiMocks.revealPet.mock.calls[0];
    expect(original[1]).toBe('FREE');
    expect(original[3]).toEqual(expect.any(String));
    fireEvent.click(screen.getByRole('button', { name: '사진 다시 불러오기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('retried.jpg'));
    expect(apiMocks.revealPet.mock.calls[1]).toEqual(original);
    expect(apiMocks.reopenPet).not.toHaveBeenCalled();
  });

  it('uses a restored earned ad credit before a newly charged free ticket even when new ads are disabled', async () => {
    const pet = { ...appHarness.submittedPet, id: 'earned-pet', isMine: false, ownerPinned: false, approvalStatus: 'approved' as const };
    const allowance = { date: getKstDate(), freeUsed: 0, remaining: 2, rewardedUsed: 1, uploadCredit: false, uploadUsed: false };
    const rewardStatus = { allowance, capabilities: { ads: false, share: false }, adCredits: [{ sessionId: 'earned-session', petId: pet.id }] };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance, rewardStatus });
    apiMocks.fetchRewardStatus.mockResolvedValue(rewardStatus);
    apiMocks.revealPet.mockResolvedValue({ photoUrl: 'https://example.test/earned.jpg', signedUrlExpiresAt: '2099-09-05T12:00:00Z', allowance });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '보리 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), 'REWARDED', 'earned-session', expect.any(String)));
    expect(apiMocks.startAdReward).not.toHaveBeenCalled();
    expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
  });

  it('shows share rewards at full free capacity and replays an uncertain grant with the same event identity', async () => {
    let allowance = { date: getKstDate(), freeUsed: 0, remaining: 2, rewardedUsed: 0, bonusTickets: 0, uploadCredit: false, uploadUsed: false };
    const status = () => ({ allowance, capabilities: { ads: false, share: true }, adCredits: [] });
    apiMocks.fetchHouse.mockResolvedValue({ pets: [], allowance, rewardStatus: status() });
    apiMocks.fetchRewardStatus.mockImplementation(async () => status());
    apiMocks.startShareReward.mockImplementation(async () => ({ ...status(), sessionId: 'share-session' }));
    apiMocks.recordShareReward.mockRejectedValueOnce(new Error('response lost')).mockImplementation(async () => {
      allowance = { ...allowance, bonusTickets: 1 };
      return status();
    });
    apiMocks.closeShareReward.mockImplementation(async () => status());
    rewardMocks.openShareReward.mockImplementation(async ({ onReward, onClose }) => {
      onReward(1, 1, '강아지 티켓');
      onClose({ sentRewardsCount: 1, sentRewardAmount: 1 });
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '친구에게 공유하고 티켓 받기' }));
    await waitFor(() => expect(screen.getByText('무료 2/2 · 보너스 1장')).toBeInTheDocument());
    expect(apiMocks.recordShareReward).toHaveBeenCalledTimes(2);
    expect(apiMocks.recordShareReward.mock.calls[0]).toEqual(apiMocks.recordShareReward.mock.calls[1]);
    expect(apiMocks.recordShareReward.mock.calls[0]).toEqual(['share-session', expect.any(String), 1, 1]);
    expect(apiMocks.closeShareReward).toHaveBeenCalledOnce();
  });

  it('uses a bonus ticket when free tickets are empty without opening an ad', async () => {
    const pet = { ...appHarness.submittedPet, id: 'bonus-pet', isMine: false, ownerPinned: false, approvalStatus: 'approved' as const };
    const allowance = { date: getKstDate(), freeUsed: 2, remaining: 0, nextChargeAt: new Date(Date.now() + 3600000).toISOString(), rewardedUsed: 0, bonusTickets: 1, uploadCredit: false, uploadUsed: false };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance });
    apiMocks.revealPet.mockResolvedValue({ photoUrl: 'https://example.test/bonus.jpg', signedUrlExpiresAt: '2099-09-05T12:00:00Z', allowance: { ...allowance, bonusTickets: 0 } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '보리 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), 'SHARE', undefined, expect.any(String)));
    expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
  });

  it('starts the server ad session before showing and records earned reward while the native ad remains open', async () => {
    appHarness.adsEnabled = true;
    const pet = { ...appHarness.submittedPet, id: 'new-ad-pet', isMine: false, ownerPinned: false, approvalStatus: 'approved' as const };
    const allowance = { date: getKstDate(), freeUsed: 2, remaining: 0, nextChargeAt: new Date(Date.now() + 3600000).toISOString(), rewardedUsed: 0, bonusTickets: 0, uploadCredit: false, uploadUsed: false };
    let status = { allowance, capabilities: { ads: true, share: false }, adCredits: [] as { sessionId: string; petId: string }[] };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance, rewardStatus: status });
    apiMocks.fetchRewardStatus.mockImplementation(async () => status);
    apiMocks.startAdReward.mockImplementation(async () => ({ ...status, sessionId: 'started-ad' }));
    apiMocks.completeAdReward.mockImplementation(async () => {
      status = { ...status, adCredits: [{ sessionId: 'started-ad', petId: pet.id }] };
      return status;
    });
    const dismissed = deferred<void>();
    rewardMocks.showRewardedAd.mockImplementation((_signal, earned) => { earned(); return dismissed.promise; });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '보리 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '광고 보고 이 친구 만나기' }));
    await waitFor(() => expect(apiMocks.completeAdReward).toHaveBeenCalledWith('started-ad'));
    expect(apiMocks.startAdReward.mock.invocationCallOrder[0]).toBeLessThan(rewardMocks.showRewardedAd.mock.invocationCallOrder[0]);
    expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
    await act(async () => { dismissed.resolve(); await dismissed.promise; });
    expect(await screen.findByTestId('play-scene')).toBeInTheDocument();
    expect(apiMocks.cancelAdReward).not.toHaveBeenCalled();
  });

  it('enables charging notifications only after an explicit native agreement, and supports switching them off', async () => {
    const allowance = { date: getKstDate(), freeUsed: 2, remaining: 0, nextChargeAt: new Date(Date.now() + 3600000).toISOString(), rewardedUsed: 0, uploadCredit: false, uploadUsed: false };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [], allowance });
    apiMocks.fetchRechargeNotificationSettings.mockResolvedValue({ enabled: false, available: true, templateCode: 'charge-ready' });
    rewardMocks.requestRechargeNotificationAgreement.mockResolvedValueOnce('denied').mockResolvedValueOnce('granted');
    apiMocks.setRechargeNotificationSettings.mockImplementation(async (enabled) => ({ enabled, available: true, templateCode: 'charge-ready' }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '충전되면 알려주세요' }));
    await waitFor(() => expect(rewardMocks.requestRechargeNotificationAgreement).toHaveBeenCalledOnce());
    expect(apiMocks.setRechargeNotificationSettings).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '충전되면 알려주세요' }));
    fireEvent.click(await screen.findByRole('button', { name: '충전 알림 끄기' }));
    await waitFor(() => expect(apiMocks.setRechargeNotificationSettings.mock.calls).toEqual([[true, true], [false]]));
  });

  it('keeps notification opt-out available while new notifications are disabled', async () => {
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchRechargeNotificationSettings.mockResolvedValue({ enabled: true, available: false });
    apiMocks.setRechargeNotificationSettings.mockResolvedValue({ enabled: false, available: false });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '충전 알림 끄기' }));
    await waitFor(() => expect(apiMocks.setRechargeNotificationSettings).toHaveBeenCalledWith(false));
    expect(rewardMocks.requestRechargeNotificationAgreement).not.toHaveBeenCalled();
  });

  it('returns home after a revisit expires without silently spending another ticket', async () => {
    const pet = { ...appHarness.submittedPet, id: 'expired-revisit', isMine: false, approvalStatus: 'approved' as const, revisitUntil: '2099-09-05T12:00:00Z' };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet] });
    apiMocks.reopenPet.mockRejectedValue(Object.assign(new Error('다시 만날 시간이 지났어요.'), { code: 'PET_REVISIT_EXPIRED' }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '보리 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '집에서 다시 만나기' }));
    expect(await screen.findByRole('region', { name: '강아지들이 있는 집' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
    expect(apiMocks.reopenPet).toHaveBeenCalledOnce();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
  });

  it('recovers interrupted native sessions after restart, grants known callbacks before abandoning unknown share totals, and retries online', async () => {
    const allowance = { date: getKstDate(), freeUsed: 0, remaining: 2, rewardedUsed: 0, bonusTickets: 0, uploadCredit: false, uploadUsed: false };
    const status = { allowance, capabilities: { ads: false, share: false }, adCredits: [] };
    rememberActiveRewardSession({ kind: 'share', sessionId: 'interrupted-share' });
    rememberActiveRewardSession({ kind: 'ad', sessionId: 'interrupted-ad' });
    enqueueRewardRecovery({ kind: 'shareReward', sessionId: 'interrupted-share', requestId: 'known-earned', eventSequence: 1, rewardAmount: 2 });
    apiMocks.fetchHouse.mockResolvedValue({ pets: [], allowance });
    apiMocks.fetchRewardStatus.mockResolvedValue(status);
    apiMocks.recordShareReward.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(status);
    apiMocks.closeShareReward.mockResolvedValue(status);
    apiMocks.cancelAdReward.mockResolvedValue(status);
    render(<App />);
    await waitFor(() => expect(apiMocks.cancelAdReward).toHaveBeenCalledWith('interrupted-ad'));
    expect(apiMocks.closeShareReward).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(apiMocks.closeShareReward).toHaveBeenCalledWith('interrupted-share', expect.any(String), null));
    expect(apiMocks.recordShareReward.mock.calls).toEqual([
      ['interrupted-share', 'known-earned', 2, 1], ['interrupted-share', 'known-earned', 2, 1],
    ]);
    expect(apiMocks.recordShareReward.mock.invocationCallOrder[1]).toBeLessThan(apiMocks.closeShareReward.mock.invocationCallOrder[0]);
    expect(readActiveRewardSessions()).toEqual([]);
    expect(readRewardRecovery()).toEqual([]);
    expect(rewardMocks.openShareReward).not.toHaveBeenCalled();
    expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
  });

  it('refreshes a visible pending share every 30 seconds and on return, then stops after approval', async () => {
    const interval = vi.spyOn(window, 'setInterval');
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    appHarness.initialSharedPetId = 'pending-share';
    const pet = { ...appHarness.submittedPet, id: 'pending-share', isMine: false };
    apiMocks.fetchSharedPet.mockResolvedValue({ pet });
    render(<App />);
    expect(await screen.findByTestId('shared-screen')).toHaveAttribute('data-status', 'pending');
    const tick = interval.mock.calls.find((call) => call[1] === 30_000)?.[0] as () => void;
    expect(tick).toEqual(expect.any(Function));
    hidden.mockReturnValue(true);
    await act(async () => tick());
    expect(apiMocks.fetchSharedPet).toHaveBeenCalledOnce();
    hidden.mockReturnValue(false);
    await act(async () => tick());
    expect(apiMocks.fetchSharedPet).toHaveBeenCalledTimes(2);
    apiMocks.fetchSharedPet.mockResolvedValue({ pet: { ...pet, approvalStatus: 'approved' } });
    const clear = vi.spyOn(window, 'clearInterval');
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByTestId('shared-screen')).toHaveAttribute('data-status', 'approved');
    expect(clear).toHaveBeenCalled();
    expect(apiMocks.openOwnerPhoto).not.toHaveBeenCalled();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
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
