import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getKstDate } from './lib/allowance';
import { enqueueRewardRecovery, readActiveRewardSessions, readPendingAdStarts, readRewardRecovery, rememberActiveRewardSession, rememberPendingAdStart } from './lib/rewardRecovery';
import type { AlbumPetSummary } from './types';
import { SAMPLE_PETS } from './data/samplePets';

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
    adStatusListener: undefined as undefined | ((status: import('./lib/rewardedAd').RewardedAdStatus) => void),
    navigationHandlers: undefined as undefined | { onBack: () => void; onHome: () => void },
  };
});

const apiMocks = vi.hoisted(() => ({
  fetchHouse: vi.fn(),
  fetchMyPets: vi.fn(),
  fetchAlbum: vi.fn(),
  openAlbumPhoto: vi.fn(),
  setPetFavorite: vi.fn(),
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
  confirmRewardedAdReturn: vi.fn(() => false),
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

vi.mock('./lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('./lib/api')>(), ...apiMocks }));
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
  confirmRewardedAdReturn: rewardMocks.confirmRewardedAdReturn,
  subscribeRewardedAdStatus: vi.fn((listener) => { appHarness.adStatusListener = listener; return () => { appHarness.adStatusListener = undefined; }; }),
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

const photoBufferMocks = vi.hoisted(() => ({ resolve: vi.fn(), dispose: vi.fn() }));
vi.mock('./lib/photoPreparation', () => ({
  createPhotoPreparation: (petId: string, requestId: string) => ({ petId, requestId,
    resolve: photoBufferMocks.resolve, dispose: photoBufferMocks.dispose,
  }),
}));

vi.mock('./components/MyPetsScreen', () => ({
  MyPetsScreen: ({ pets, onUpload, onMeet, onShare, onAddPhotos }: {
    pets: typeof appHarness.submittedPet[];
    onUpload: () => void;
    onMeet: (pet: typeof appHarness.submittedPet) => void;
    onShare: (pet: typeof appHarness.submittedPet) => void;
    onAddPhotos?: (pet: typeof appHarness.submittedPet) => void;
  }) => (
    <main>
      {pets.map((pet) => <div key={pet.id} data-testid={`mine-pet-${pet.id}`} data-status={pet.approvalStatus}
        data-design-sha256={(pet as Partial<AlbumPetSummary>).publishedDesign?.sha256}>
        <button type="button" onClick={() => onMeet(pet)}>{pet.name} 만나기</button>
        <button type="button" onClick={() => onShare(pet)}>{pet.name} 공유하기</button>
        {onAddPhotos && <button type="button" onClick={() => onAddPhotos(pet)}>{pet.name} 사진 추가하기</button>}
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

vi.mock('./components/PetPhotoAdditionFlow', () => ({
  PetPhotoAdditionFlow: ({ pet, onSubmitted, onCancel }: {
    pet: typeof appHarness.submittedPet; onSubmitted: () => void; onCancel: () => void;
  }) => <main data-testid="photo-addition-screen" data-pet-id={pet.id}>
    <button onClick={() => window.dispatchEvent(new CustomEvent('cute-enough:upload-dirty-change', { detail: { dirty: true, busy: false } }))}>추가 사진 선택</button>
    <button onClick={() => window.dispatchEvent(new CustomEvent('cute-enough:upload-dirty-change', { detail: { dirty: true, busy: true } }))}>추가 사진 결과 확인 중</button>
    <button onClick={() => {
      window.dispatchEvent(new CustomEvent('cute-enough:upload-dirty-change', { detail: { dirty: false, busy: false } }));
      onSubmitted();
    }}>추가 사진 접수 완료</button>
    <button onClick={onCancel}>추가 사진 나가기</button>
  </main>,
}));

vi.mock('./components/SharedPetLanding', () => ({
  SharedPetLanding: ({ pet }: { pet: typeof appHarness.submittedPet }) => <main data-testid="shared-screen" data-status={pet.approvalStatus}>공유 화면</main>,
}));

vi.mock('./components/PetArtwork', () => ({
  PetArtwork: ({ pet }: { pet?: typeof appHarness.submittedPet }) => (
    <div
      data-testid={pet ? `pet-artwork-${pet.id}` : 'pet-artwork'}
      data-status={pet?.approvalStatus}
      data-design-sha256={(pet as Partial<AlbumPetSummary> | undefined)?.publishedDesign?.sha256}
    >
      {pet?.name ?? '이름 없는 강아지'} 캐릭터
    </div>
  ),
}));

vi.mock('./components/PlayScene', () => ({
  PlayScene: ({ pet, onFed, photoHint, onInteractionComplete }: { pet: typeof appHarness.submittedPet; onFed: (method: 'stroke' | 'tap' | 'keyboard') => void; photoHint?: string; onInteractionComplete?: (method: 'tap') => void }) => (
    <main data-testid="play-scene" data-pet-id={pet.id} data-status={pet.approvalStatus} data-design-sha256={(pet as Partial<AlbumPetSummary>).publishedDesign?.sha256}>
      {pet.name}와 노는 중
      {photoHint && <p>{photoHint}</p>}
      <button type="button" onClick={() => onFed('tap')}>간식 주기</button>
      <button type="button" onClick={() => undefined}>쓰다듬기 시작 신호</button>
      <button type="button" onClick={() => onInteractionComplete?.('tap')}>세 번째 입력 신호</button>
    </main>
  ),
}));

vi.mock('./components/RevealCard', () => ({
  RevealCard: ({ pet, photoUrl, onClose, onRetryPhoto, onReport, retryPhotoLabel, isFavorite, favoritePending, onFavoriteChange, photoPosition, onPreviousPhoto, onNextPhoto }: {
    pet: typeof appHarness.submittedPet;
    photoUrl: string;
    onClose: () => void;
    onRetryPhoto?: () => Promise<void> | void;
    onReport: () => Promise<void> | void;
    retryPhotoLabel?: string;
    isFavorite?: boolean;
    favoritePending?: boolean;
    onFavoriteChange?: (isFavorite: boolean) => void;
    photoPosition?: { index: number; total: number };
    onPreviousPhoto?: () => void;
    onNextPhoto?: () => void;
  }) => (
    <div role="dialog" aria-label="강아지 실사 사진">
      <span>{pet.name} 사진</span>
      <span data-testid="revealed-photo-url">{photoUrl}</span>
      <button type="button" onClick={onClose}>사진 닫기</button>
      {onRetryPhoto && <button type="button" onClick={() => { void Promise.resolve(onRetryPhoto()).catch(() => undefined); }}>{retryPhotoLabel ?? '사진 다시 불러오기'}</button>}
      <button type="button" onClick={() => { void Promise.resolve(onReport()).catch(() => undefined); }}>이 사진 신고하기</button>
      <button type="button">사진 하트 효과</button>
      {onFavoriteChange && <button type="button" aria-label={isFavorite ? '마음에 담았어요, 마음에 담기 취소' : '또 보고 싶어요, 마음에 담기'} aria-pressed={Boolean(isFavorite)} disabled={favoritePending} onClick={() => onFavoriteChange(!isFavorite)}>{isFavorite ? '마음에 담았어요' : '또 보고 싶어요'}</button>}
      {photoPosition && photoPosition.total > 1 && <div aria-label="모은 사진 넘기기">
        <button type="button" disabled={photoPosition.index <= 0 || !onPreviousPhoto} onClick={onPreviousPhoto}>이전 사진</button>
        <span>{photoPosition.index + 1} / {photoPosition.total}</span>
        <button type="button" disabled={photoPosition.index >= photoPosition.total - 1 || !onNextPhoto} onClick={onNextPhoto}>다음 사진</button>
      </div>}
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

function collectedFriend(overrides: Partial<AlbumPetSummary> = {}): AlbumPetSummary {
  return {
    ...appHarness.submittedPet,
    id: 'album-friend', name: '구르미', isMine: false, ownerPinned: false, approvalStatus: 'approved',
    publishedDesign: SAMPLE_PETS[0].publishedDesign, designVersion: 1, designStatus: 'ready',
    unlockedPhotoCount: 2, albumPhotoId: 'photo-newer', hasUnseenPhotos: true, isFavorite: false,
    unlockedPhotos: [
      { photoId: 'photo-newer', unlockedAt: '2026-09-05T02:00:00Z', source: 'reveal' },
      { photoId: 'photo-older', unlockedAt: '2026-09-04T02:00:00Z', source: 'legacy_gift' },
    ],
    ...overrides,
  };
}

function collectedPhotoResponse(pet: AlbumPetSummary, photoId = pet.albumPhotoId ?? 'photo-newer') {
  return {
    photoId, photoUrl: `https://example.test/${photoId}.jpg`, signedUrlExpiresAt: '2099-09-05T12:00:00Z',
    albumPhotoId: pet.albumPhotoId, unlockedPhotoCount: pet.unlockedPhotoCount, isFavorite: pet.isFavorite, hasUnseenPhotos: pet.hasUnseenPhotos,
    allowance: { date: getKstDate(), freeUsed: 0, remaining: 2, rewardedUsed: 0, uploadCredit: false, uploadUsed: false },
  };
}

describe('App upload submission integration', () => {
  it('adds photos to the same owned dog and returns to its unchanged list without a new dog or bonus', async () => {
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchMyPets.mockResolvedValue([appHarness.submittedPet]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '내가 소개한 강아지' }));
    fireEvent.click(await screen.findByRole('button', { name: '보리 사진 추가하기' }));
    expect(await screen.findByTestId('photo-addition-screen')).toHaveAttribute('data-pet-id', 'submitted-pet');
    const storedBefore = JSON.stringify(localStorage);
    fireEvent.click(screen.getByRole('button', { name: '추가 사진 접수 완료' }));
    expect(await screen.findByTestId('mine-pet-submitted-pet')).toHaveAttribute('data-status', 'pending');
    expect(screen.queryByTestId('photo-addition-screen')).not.toBeInTheDocument();
    expect(screen.queryByText('보리가 집에 놀러 왔어요')).not.toBeInTheDocument();
    expect(JSON.stringify(localStorage)).toBe(storedBefore);
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    expect(apiMocks.openOwnerPhoto).not.toHaveBeenCalled();
    expect(analyticsMocks.trackProductEvent).not.toHaveBeenCalledWith('registration_complete', expect.anything());
    expect(hapticMocks.playHaptic).not.toHaveBeenCalledWith('uploadSuccess');
  });

  it('confirms discarded extra photos on native home and keeps unknown submissions on screen', async () => {
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchMyPets.mockResolvedValue([appHarness.submittedPet]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '내가 소개한 강아지' }));
    fireEvent.click(await screen.findByRole('button', { name: '보리 사진 추가하기' }));
    fireEvent.click(await screen.findByRole('button', { name: '추가 사진 선택' }));
    act(() => appHarness.navigationHandlers?.onHome());
    expect(await screen.findByText('새로 고른 사진은 보내지 않아요. 기존 사진은 그대로 유지돼요.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '계속 고르기' }));
    expect(screen.getByTestId('photo-addition-screen')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '추가 사진 결과 확인 중' }));
    act(() => appHarness.navigationHandlers?.onHome());
    act(() => appHarness.navigationHandlers?.onBack());
    expect(screen.getByTestId('photo-addition-screen')).toBeInTheDocument();
    expect(screen.queryByText('작성 중인 내용을 나갈까요?')).not.toBeInTheDocument();
  });

  it('uses the confirmed native-home destination when discarding added photos', async () => {
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchMyPets.mockResolvedValue([appHarness.submittedPet]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '내가 소개한 강아지' }));
    fireEvent.click(await screen.findByRole('button', { name: '보리 사진 추가하기' }));
    fireEvent.click(await screen.findByRole('button', { name: '추가 사진 선택' }));
    act(() => appHarness.navigationHandlers?.onHome());
    fireEvent.click(await screen.findByRole('button', { name: '나가기' }));
    expect(await screen.findByRole('region', { name: '강아지들이 있는 집' })).toBeInTheDocument();
    expect(screen.queryByTestId('photo-addition-screen')).not.toBeInTheDocument();
  });

  beforeEach(() => {
    cleanup();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    appHarness.initialSharedPetId = undefined;
    appHarness.adsEnabled = false;
    appHarness.adStatusListener = undefined;
    appHarness.navigationHandlers = undefined;
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    photoBufferMocks.resolve.mockReset().mockImplementation(async (photo) => photo.photoUrl);
    photoBufferMocks.dispose.mockReset();
    Object.values(rewardMocks).forEach((mock) => mock.mockReset());
    rewardMocks.supportsShareReward.mockReturnValue(true);
    apiMocks.fetchRewardStatus.mockRejectedValue(new Error('legacy server'));
    apiMocks.fetchRechargeNotificationSettings.mockResolvedValue({ enabled: false, available: false });
    hapticMocks.playHaptic.mockClear();
    analyticsMocks.trackProductEvent.mockClear();
    tossMocks.sharePet.mockClear();
    tossMocks.sharePet.mockResolvedValue(undefined);
    apiMocks.fetchMyPets.mockResolvedValue([]);
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [], legacyGiftCount: 0 });
    apiMocks.openAlbumPhoto.mockRejectedValue(new Error('album photo mock not configured'));
    apiMocks.setPetFavorite.mockImplementation(async (pet, isFavorite) => ({ petId: pet.id, isFavorite, favoriteCount: Number(isFavorite) }));
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('restarts the cancelled first house request under StrictMode and ignores its late response', async () => {
    const stale = deferred<{ pets: typeof SAMPLE_PETS }>();
    const pet = collectedFriend();
    apiMocks.fetchHouse.mockReturnValueOnce(stale.promise).mockResolvedValue({ pets: [pet] });
    render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' })).toBeInTheDocument();
    expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(2);
    expect(apiMocks.fetchHouse.mock.calls[0][0].aborted).toBe(true);
    expect(apiMocks.fetchHouse.mock.calls[1][0].aborted).toBe(false);
    await act(async () => stale.resolve({ pets: [] }));
    expect(screen.getByRole('button', { name: '구르미 옮기기 또는 선택' })).toBeInTheDocument();
  });

  it('uses the tilted ticket, places mine before the album image, and omits the sound toggle', async () => {
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    const { container } = render(<App />);
    await waitFor(() => expect(apiMocks.fetchHouse).toHaveBeenCalledOnce());
    const mine = screen.getByRole('button', { name: '내가 소개한 강아지' });
    const album = screen.getByRole('button', { name: '강아지 앨범' });
    expect(container.querySelector('.home-collection-links')?.firstElementChild).toBe(mine);
    expect(mine.nextElementSibling).toBe(album);
    expect(album.querySelector('img')).toHaveAttribute('src', '/ui/dog-encyclopedia-book-v1.png');
    expect(album.querySelector('img')).toHaveAttribute('alt', '');
    expect(album.textContent).toBe('');
    expect(container.querySelector('.ticket-card-icon img')).toHaveAttribute('src', '/ui/dog-ticket-pass-v1.png');
    expect(screen.queryByRole('button', { name: /소리 (켜기|끄기)/ })).not.toBeInTheDocument();
  });

  it('starts a new-photo commit on the third gesture before showing the modal at reaction end', async () => {
    const pet = collectedFriend({ unlockedPhotoCount: 0, albumPhotoId: undefined,
      collection: { collectedCount: 0, totalCount: 3, collectedToday: false, canCollectToday: true } });
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet] });
    apiMocks.revealPet.mockResolvedValue(collectedPhotoResponse(pet));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '쓰다듬기 시작 신호' }));
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '세 번째 입력 신호' }));
    await waitFor(() => expect(photoBufferMocks.resolve).toHaveBeenCalledOnce());
    expect(apiMocks.revealPet).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: '강아지 실사 사진' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '세 번째 입력 신호' }));
    expect(apiMocks.revealPet).toHaveBeenCalledOnce();
  });

  it('does not request an owner photo before the third input or after abandoning play', async () => {
    const pet = { ...collectedFriend(), id: 'prefetch-owner', isMine: true, approvalStatus: 'approved' as const, ownerPhotoAvailable: true };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [], ownerBonusPet: pet });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '쓰다듬기 시작 신호' }));
    expect(apiMocks.openOwnerPhoto).not.toHaveBeenCalled();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    act(() => appHarness.navigationHandlers?.onBack());
    expect(photoBufferMocks.resolve).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
  });

  it('keeps a slow decoded photo inside the modal and does not issue a second commit', async () => {
    const pet = collectedFriend({ collection: { collectedCount: 2, totalCount: 3, collectedToday: true, canCollectToday: false } });
    const pixels = deferred<string>();
    photoBufferMocks.resolve.mockReturnValueOnce(pixels.promise);
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet] });
    apiMocks.revealPet.mockResolvedValue(collectedPhotoResponse(pet));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '쓰다듬기 시작 신호' }));
    fireEvent.click(screen.getByRole('button', { name: '세 번째 입력 신호' }));
    await waitFor(() => expect(photoBufferMocks.resolve).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
    expect(await screen.findByRole('dialog', { name: '강아지 실사 사진' })).toBeInTheDocument();
    expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.anything(), 'FREE', undefined, expect.any(String), 'replay');
    act(() => appHarness.navigationHandlers?.onBack());
    await act(async () => { pixels.resolve('blob:late-photo'); });
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
    expect(apiMocks.revealPet).toHaveBeenCalledOnce();
  });

  it('carries the exact published SVG from the house into the selected play pet', async () => {
    const pet = { ...appHarness.submittedPet, id: 'saved-selection', isMine: false, ownerPinned: false,
      approvalStatus: 'approved', publishedDesign: { ...SAMPLE_PETS[0].publishedDesign!, designVersion: 3 }, designVersion: 3 };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet] });
    render(<App />);
    expect(await screen.findByTestId('pet-artwork-saved-selection')).toHaveAttribute('data-design-sha256', pet.publishedDesign.sha256);
    fireEvent.click(screen.getByRole('button', { name: '보리 옮기기 또는 선택' }));
    expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-design-sha256', pet.publishedDesign.sha256);
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
  });

  it('updates the owners home from mine approval without losing an older upload or spending tickets', async () => {
    const draft = { ...appHarness.submittedPet, designVersion: 1 };
    const approved = { ...draft, approvalStatus: 'approved', designVersion: 2, ownerPhotoAvailable: true,
      publishedDesign: { ...SAMPLE_PETS[0].publishedDesign!, designVersion: 2 }, designStatus: 'ready' };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [], ownerBonusPet: draft });
    apiMocks.fetchMyPets.mockResolvedValue([approved, { ...draft, id: 'older-upload', name: '예전친구' }]);
    render(<App />);
    expect(await screen.findByTestId('pet-artwork-submitted-pet')).toHaveAttribute('data-status', 'pending');
    fireEvent.click(screen.getByRole('button', { name: '내가 소개한 강아지' }));
    expect(await screen.findByTestId('mine-pet-submitted-pet')).toHaveAttribute('data-design-sha256', approved.publishedDesign.sha256);
    expect(screen.getByTestId('mine-pet-older-upload')).toBeInTheDocument();
    act(() => appHarness.navigationHandlers?.onBack());
    expect(await screen.findByTestId('pet-artwork-submitted-pet')).toHaveAttribute('data-status', 'approved');
    expect(screen.getByTestId('pet-artwork-submitted-pet')).toHaveAttribute('data-design-sha256', approved.publishedDesign.sha256);
    expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(1);
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    expect(apiMocks.openOwnerPhoto).not.toHaveBeenCalled();
  });

  it('does not roll back the owners approved SVG when an older house response arrives late', async () => {
    const draft = { ...appHarness.submittedPet, designVersion: 1 };
    const approved = { ...draft, approvalStatus: 'approved', designVersion: 2,
      publishedDesign: { ...SAMPLE_PETS[0].publishedDesign!, designVersion: 2 }, designStatus: 'ready' };
    const oldHouse = deferred<{ pets: typeof draft[]; ownerBonusPet: typeof draft }>();
    apiMocks.fetchHouse.mockReturnValue(oldHouse.promise);
    apiMocks.fetchMyPets.mockResolvedValue([approved]);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '내가 소개한 강아지' }));
    await screen.findByTestId('mine-pet-submitted-pet');
    await act(async () => oldHouse.resolve({ pets: [], ownerBonusPet: draft }));
    expect(screen.getByTestId('mine-pet-submitted-pet')).toHaveAttribute('data-status', 'approved');
    act(() => appHarness.navigationHandlers?.onBack());
    expect(await screen.findByTestId('pet-artwork-submitted-pet')).toHaveAttribute('data-design-sha256', approved.publishedDesign.sha256);
  });

  it('picks up an approval while the owner is playing, without skipping interaction or issuing photo requests', async () => {
    const approved = { ...appHarness.submittedPet, approvalStatus: 'approved', designVersion: 2,
      publishedDesign: { ...SAMPLE_PETS[0].publishedDesign!, designVersion: 2 }, designStatus: 'ready' };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchSharedPet.mockResolvedValue({ pet: approved });
    render(<App />);
    await openUploadAndSubmit();
    fireEvent.click(screen.getByRole('button', { name: '지금 만나보기' }));
    expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-status', 'pending');
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByTestId('play-scene')).toHaveAttribute('data-design-sha256', approved.publishedDesign.sha256));
    expect(screen.getByRole('button', { name: '간식 주기' })).toBeInTheDocument();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    expect(apiMocks.openOwnerPhoto).not.toHaveBeenCalled();
  });

  it('asks to reopen the app when the server requires the SVG-compatible client', async () => {
    apiMocks.fetchHouse.mockRejectedValue(Object.assign(new Error('새 강아지 디자인을 보려면 앱을 다시 열어 주세요.'), { code: 'CLIENT_RESTART_REQUIRED', status: 426 }));
    render(<App />);
    expect(await screen.findByText('새 강아지 디자인을 보려면 앱을 다시 열어 주세요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '앱 닫기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
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

  it('opens the album from home and opens its last collected photo above the album without playing or spending', async () => {
    const pet = collectedFriend();
    const pendingPhoto = deferred<ReturnType<typeof collectedPhotoResponse>>();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [pet], legacyGiftCount: 0 });
    apiMocks.openAlbumPhoto.mockReturnValueOnce(pendingPhoto.promise);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '강아지 앨범' }));
    fireEvent.click(await screen.findByRole('button', { name: /구르미, 모은 사진 2장/ }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: '강아지 실사 사진' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toBeEmptyDOMElement());
    expect(apiMocks.fetchAlbum).toHaveBeenCalledWith(false, undefined, expect.any(AbortSignal));
    expect(apiMocks.openAlbumPhoto).toHaveBeenCalledWith('photo-newer', expect.objectContaining({ id: pet.id }));
    await act(async () => { pendingPhoto.resolve(collectedPhotoResponse(pet)); await pendingPhoto.promise; });
    expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg');
    expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    expect(screen.getByRole('button', { name: /구르미, 모은 사진 2장/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
  });

  it('persists only the explicit favorite choice once and refreshes the album with the selected state', async () => {
    const pet = collectedFriend();
    const pendingFavorite = deferred<{ petId: string; isFavorite: boolean; favoriteCount: number }>();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [pet], legacyGiftCount: 0 });
    apiMocks.openAlbumPhoto.mockResolvedValue(collectedPhotoResponse(pet));
    apiMocks.setPetFavorite.mockReturnValueOnce(pendingFavorite.promise);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '강아지 앨범' }));
    fireEvent.click(await screen.findByRole('button', { name: /구르미, 모은 사진 2장/ }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg'));
    fireEvent.click(screen.getByRole('button', { name: '사진 하트 효과' }));
    expect(apiMocks.setPetFavorite).not.toHaveBeenCalled();
    const favorite = within(screen.getByRole('dialog', { name: '강아지 실사 사진' })).getByRole('button', { name: /마음에 담기/, pressed: false });
    act(() => { fireEvent.click(favorite); fireEvent.click(favorite); });
    expect(apiMocks.setPetFavorite).toHaveBeenCalledOnce();
    expect(apiMocks.setPetFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), true);
    expect(within(screen.getByRole('dialog', { name: '강아지 실사 사진' })).getByRole('button', { name: /마음에 담기/, pressed: true })).toBeDisabled();
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [{ ...pet, isFavorite: true }], legacyGiftCount: 0 });
    await act(async () => { pendingFavorite.resolve({ petId: pet.id, isFavorite: true, favoriteCount: 1 }); await pendingFavorite.promise; });
    expect(within(screen.getByRole('dialog', { name: '강아지 실사 사진' })).getByRole('button', { name: /마음에 담기/, pressed: true })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    expect(await screen.findByRole('button', { name: /구르미, 모은 사진 2장, 마음에 담은 친구 사진 보기/ })).toBeInTheDocument();
  });

  it('retries the exact requested gallery photo when navigating fails and never consumes another ticket', async () => {
    const pet = collectedFriend();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [pet], legacyGiftCount: 0 });
    apiMocks.openAlbumPhoto.mockResolvedValueOnce(collectedPhotoResponse(pet))
      .mockRejectedValueOnce(new Error('사진 연결을 다시 확인해 주세요'))
      .mockResolvedValueOnce(collectedPhotoResponse(pet, 'photo-older'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '강아지 앨범' }));
    fireEvent.click(await screen.findByRole('button', { name: /구르미, 모은 사진 2장/ }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg'));
    fireEvent.click(screen.getByRole('button', { name: '다음 사진' }));
    await screen.findByText('사진 연결을 다시 확인해 주세요');
    fireEvent.click(screen.getByRole('button', { name: '사진 다시 불러오기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-older.jpg'));
    expect(apiMocks.openAlbumPhoto.mock.calls.map((call) => call[0])).toEqual(['photo-newer', 'photo-older', 'photo-older']);
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    expect(apiMocks.reopenPet).not.toHaveBeenCalled();
  });

  it('ignores a delayed photo response after closing so it cannot replace a newly opened friend', async () => {
    const first = collectedFriend();
    const second = collectedFriend({ id: 'other-album-friend', name: '하늘', albumPhotoId: 'haneul-photo', unlockedPhotos: [{ photoId: 'haneul-photo', unlockedAt: '2026-09-05T02:00:00Z', source: 'reveal' }], unlockedPhotoCount: 1 });
    const delayed = deferred<ReturnType<typeof collectedPhotoResponse>>();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [first, second], legacyGiftCount: 0 });
    apiMocks.openAlbumPhoto.mockReturnValueOnce(delayed.promise).mockResolvedValueOnce(collectedPhotoResponse(second));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '강아지 앨범' }));
    fireEvent.click(await screen.findByRole('button', { name: /구르미, 모은 사진 2장/ }));
    fireEvent.click(await screen.findByRole('button', { name: '사진 닫기' }));
    fireEvent.click(screen.getByRole('button', { name: /하늘, 모은 사진 1장/ }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('haneul-photo.jpg'));
    await act(async () => { delayed.resolve(collectedPhotoResponse(first)); await delayed.promise; });
    expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('haneul-photo.jpg');
    expect(screen.queryByText('구르미 사진')).not.toBeInTheDocument();
  });

  it('preserves a new permanent grant in house caches and replays it through play after the old revisit expiry', async () => {
    const pet = collectedFriend({ unlockedPhotoCount: 0, albumPhotoId: undefined, unlockedPhotos: [] });
    const granted = collectedFriend({ unlockedPhotoCount: 1, albumPhotoId: 'first-grant', unlockedPhotos: [{ photoId: 'first-grant', unlockedAt: '2026-09-05T02:00:00Z', source: 'reveal' }] });
    const response = { ...collectedPhotoResponse(granted), revisitUntil: '2000-01-01T00:00:00Z' };
    const pendingReload = deferred<{ pets: AlbumPetSummary[] }>();
    apiMocks.fetchHouse.mockResolvedValueOnce({ pets: [pet], allowance: response.allowance }).mockReturnValue(pendingReload.promise);
    apiMocks.revealPet.mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ ...response, photoUrl: 'https://example.test/free-reopen.jpg', alreadyRevealed: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('first-grant.jpg'));
    expect(within(screen.getByRole('dialog', { name: '강아지 실사 사진' })).getByRole('button', { name: /마음에 담기/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    expect(await screen.findByTestId('play-scene')).toBeInTheDocument();
    expect(screen.queryByText('새 사진을 만나면 티켓 1장을 써요')).not.toBeInTheDocument();
    expect(apiMocks.revealPet).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('free-reopen.jpg'));
    expect(apiMocks.revealPet).toHaveBeenLastCalledWith(expect.objectContaining({ albumPhotoId: 'first-grant', unlockedPhotoCount: 1 }), 'FREE', undefined, expect.any(String), 'replay');
    expect(apiMocks.revealPet.mock.calls.map((call) => call[4])).toEqual(['collect', 'replay']);
    expect(apiMocks.openAlbumPhoto).not.toHaveBeenCalled();
    expect(apiMocks.reopenPet).not.toHaveBeenCalled();
    await act(async () => { pendingReload.resolve({ pets: [granted] }); await pendingReload.promise; });
  });

  it('releases an in-flight album photo on native home so another friend can open immediately', async () => {
    const first = collectedFriend();
    const second = collectedFriend({ id: 'home-friend', name: '하늘', albumPhotoId: 'haneul-home-photo' });
    const delayed = deferred<ReturnType<typeof collectedPhotoResponse>>();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [first, second] });
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [first], legacyGiftCount: 0 });
    apiMocks.openAlbumPhoto.mockReturnValueOnce(delayed.promise);
    apiMocks.revealPet.mockResolvedValueOnce(collectedPhotoResponse(second));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '강아지 앨범' }));
    fireEvent.click(await screen.findByRole('button', { name: /구르미, 모은 사진 2장/ }));
    await waitFor(() => expect(apiMocks.openAlbumPhoto).toHaveBeenCalledOnce());
    act(() => appHarness.navigationHandlers?.onHome());
    fireEvent.click(await screen.findByRole('button', { name: '하늘 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('haneul-home-photo.jpg'));
    await act(async () => { delayed.resolve(collectedPhotoResponse(first)); await delayed.promise; });
    expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('haneul-home-photo.jpg');
  });

  it('collects one new photo after play then replays the same daily photo without another collection CTA', async () => {
    const pet = collectedFriend({ collection: { collectedCount: 2, totalCount: 4, collectedToday: false, canCollectToday: true } });
    const collected = { ...collectedPhotoResponse(pet, 'unseen-photo'),
      unlockedPhotoCount: 3, hasUnseenPhotos: true,
      collection: { collectedCount: 3, totalCount: 4, collectedToday: true, canCollectToday: false, todayPhotoId: 'unseen-photo' },
    };
    apiMocks.fetchHouse.mockResolvedValueOnce({ pets: [pet], allowance: collected.allowance })
      .mockResolvedValue({ pets: [{ ...pet, collection: collected.collection, unlockedPhotoCount: 3, albumPhotoId: 'unseen-photo' }], allowance: collected.allowance });
    apiMocks.revealPet.mockResolvedValueOnce(collected).mockResolvedValueOnce({ ...collected, alreadyRevealed: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    expect(await screen.findByText('새 사진을 만나면 티켓 1장을 써요')).toBeInTheDocument();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('unseen-photo.jpg'));
    expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), 'FREE', undefined, expect.any(String), 'collect');
    expect(analyticsMocks.trackProductEvent).toHaveBeenCalledWith('play_complete', {
      access_method: 'FREE',
      interaction_method: 'tap',
    });
    expect(screen.queryByRole('button', { name: '다른 사진 만나기' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    expect(await screen.findByTestId('play-scene')).toBeInTheDocument();
    expect(screen.queryByText('새 사진을 만나면 티켓 1장을 써요')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('unseen-photo.jpg'));
    expect(apiMocks.revealPet.mock.calls.map((call) => call[4])).toEqual(['collect', 'replay']);
  });

  it('does not offer unseen photos for an album friend absent from today’s house', async () => {
    const pet = collectedFriend();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [pet], legacyGiftCount: 0 });
    apiMocks.openAlbumPhoto.mockResolvedValue(collectedPhotoResponse(pet));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '강아지 앨범' }));
    fireEvent.click(await screen.findByRole('button', { name: /구르미, 모은 사진 2장/ }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg'));
    expect(screen.queryByRole('button', { name: '다른 사진 만나기' })).not.toBeInTheDocument();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
  });

  it('keeps a free replay intent when a ticket recharges during play, without opening an ad', async () => {
    appHarness.adsEnabled = true;
    const pet = collectedFriend({ collection: { collectedCount: 2, totalCount: 4, collectedToday: false, canCollectToday: true } });
    const chargeAt = Date.now() + 3_600_000;
    const empty = { ...collectedPhotoResponse(pet).allowance, remaining: 0, freeUsed: 2, nextChargeAt: new Date(chargeAt).toISOString() };
    const charged = { ...empty, remaining: 1, freeUsed: 1, nextChargeAt: new Date(chargeAt + 3_600_000).toISOString() };
    apiMocks.fetchHouse.mockResolvedValueOnce({ pets: [pet], allowance: empty })
      .mockResolvedValue({ pets: [pet], allowance: charged });
    apiMocks.revealPet.mockResolvedValue({ ...collectedPhotoResponse(pet), allowance: charged, alreadyRevealed: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    expect(await screen.findByTestId('play-scene')).toBeInTheDocument();
    expect(screen.queryByText('새 사진을 만나면 티켓 1장을 써요')).not.toBeInTheDocument();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(chargeAt + 1_000);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg'));
    expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), 'FREE', undefined, expect.any(String), 'replay');
    expect(apiMocks.startAdReward).not.toHaveBeenCalled();
    expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it('opens an owner pending photo from the house only after play without a ticket request', async () => {
    const pet = { ...appHarness.submittedPet, ownerPhotoAvailable: true };
    const allowance = { date: getKstDate(), remaining: 0, freeUsed: 2, rewardedUsed: 0, uploadCredit: false, uploadUsed: false, nextChargeAt: new Date(Date.now() + 3_600_000).toISOString() };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance });
    apiMocks.openOwnerPhoto.mockResolvedValue({ photoId: 'mine-photo', photoUrl: 'https://example.test/mine-photo.jpg', ownerPhotoAvailable: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '보리 옮기기 또는 선택' }));
    expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-status', 'pending');
    expect(apiMocks.openOwnerPhoto).not.toHaveBeenCalled();
    expect(screen.queryByText('새 사진을 만나면 티켓 1장을 써요')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('mine-photo.jpg'));
    expect(apiMocks.openOwnerPhoto).toHaveBeenCalledOnce();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    expect(apiMocks.startAdReward).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    expect(await screen.findByRole('region', { name: '강아지들이 있는 집' })).toBeInTheDocument();
  });

  it('only offers explicit ticket recovery for an uncollected dog when no ticket or ad is available', async () => {
    const pet = collectedFriend({ unlockedPhotoCount: 0, albumPhotoId: undefined, unlockedPhotos: [], collection: { collectedCount: 0, totalCount: 2, collectedToday: false, canCollectToday: true } });
    const allowance = { ...collectedPhotoResponse(pet).allowance, remaining: 0, freeUsed: 2, nextChargeAt: new Date(Date.now() + 3_600_000).toISOString() };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    expect(await screen.findByRole('dialog', { name: '다음 친구도 만나볼까요?' })).toBeInTheDocument();
    expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    expect(apiMocks.startAdReward).not.toHaveBeenCalled();
    expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
    act(() => appHarness.navigationHandlers?.onBack());
    expect(screen.queryByRole('dialog', { name: '다음 친구도 만나볼까요?' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '강아지들이 있는 집' })).toBeInTheDocument();
  });

  it('does not spend on a house selection or cancelled play and deduplicates feed completion', async () => {
    const pet = collectedFriend({ unlockedPhotoCount: 0, albumPhotoId: undefined, unlockedPhotos: [] });
    const pending = deferred<ReturnType<typeof collectedPhotoResponse>>();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance: collectedPhotoResponse(pet).allowance });
    apiMocks.revealPet.mockReturnValueOnce(pending.promise);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    await screen.findByTestId('play-scene');
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
    act(() => appHarness.navigationHandlers?.onBack());
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    const feed = await screen.findByRole('button', { name: '간식 주기' });
    act(() => { fireEvent.click(feed); fireEvent.click(feed); });
    expect(apiMocks.revealPet).toHaveBeenCalledOnce();
    expect(apiMocks.revealPet.mock.calls[0][4]).toBe('collect');
    await act(async () => { pending.resolve(collectedPhotoResponse(pet)); await pending.promise; });
  });

  it('keeps the prepared collection intent across the KST midnight house refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-05T14:59:50.000Z'));
    const pet = collectedFriend({ unlockedPhotoCount: 0, albumPhotoId: undefined, unlockedPhotos: [] });
    const allowance = collectedPhotoResponse(pet).allowance;
    apiMocks.fetchHouse.mockResolvedValueOnce({ pets: [pet], allowance })
      .mockResolvedValue({ pets: [pet], allowance: { ...allowance, date: '2026-09-06' } });
    apiMocks.revealPet.mockResolvedValue({ ...collectedPhotoResponse(pet), allowance: { ...allowance, date: '2026-09-06', remaining: 1, freeUsed: 1 } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    await screen.findByTestId('play-scene');
    vi.setSystemTime(new Date('2026-09-05T15:00:01.000Z'));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg'));
    expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), 'FREE', undefined, expect.any(String), 'collect');
  });

  it('refreshes home tickets after a delayed successful feed without reopening the dismissed photo', async () => {
    const pet = collectedFriend({ unlockedPhotoCount: 0, albumPhotoId: undefined, unlockedPhotos: [] });
    const grant = { ...collectedPhotoResponse(pet), unlockedPhotoCount: 1,
      collection: { collectedCount: 1, totalCount: 3, collectedToday: true, canCollectToday: false, todayPhotoId: 'photo-newer' },
      allowance: { ...collectedPhotoResponse(pet).allowance, remaining: 1, freeUsed: 1 },
    };
    const pending = deferred<typeof grant>();
    apiMocks.fetchHouse.mockResolvedValueOnce({ pets: [pet], allowance: collectedPhotoResponse(pet).allowance })
      .mockResolvedValue({ pets: [{ ...pet, collection: grant.collection, unlockedPhotoCount: 1, albumPhotoId: 'photo-newer' }], allowance: grant.allowance });
    apiMocks.revealPet.mockReturnValueOnce(pending.promise);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    fireEvent.click(await screen.findByRole('button', { name: '사진 닫기' }));
    await screen.findByRole('region', { name: '강아지들이 있는 집' });
    const beforeReply = apiMocks.fetchHouse.mock.calls.length;
    await act(async () => { pending.resolve(grant); await pending.promise; });
    await waitFor(() => expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(beforeReply + 1));
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('cute-enough:allowance') ?? '{}').remaining).toBe(1);
    expect(apiMocks.revealPet).toHaveBeenCalledOnce();
  });

  it('ignores a pre-mutation reward snapshot so it cannot restore spent tickets or an old ad credit', async () => {
    const first = collectedFriend({ unlockedPhotoCount: 0, albumPhotoId: undefined, unlockedPhotos: [] });
    const second = collectedFriend({ id: 'second-new-friend', name: '하늘', unlockedPhotoCount: 0, albumPhotoId: undefined, unlockedPhotos: [] });
    const allowance = collectedPhotoResponse(first).allowance;
    const spent = { ...allowance, remaining: 1, freeUsed: 1 };
    const delayed = deferred<{ allowance: typeof allowance; capabilities: { ads: boolean; share: boolean }; adCredits: { sessionId: string; petId: string }[] }>();
    apiMocks.fetchRewardStatus.mockReturnValueOnce(delayed.promise);
    apiMocks.fetchHouse.mockResolvedValueOnce({ pets: [first, second], allowance })
      .mockResolvedValue({ pets: [first, second], allowance: spent });
    apiMocks.revealPet.mockResolvedValueOnce({ ...collectedPhotoResponse(first), allowance: spent })
      .mockResolvedValueOnce({ ...collectedPhotoResponse(second), allowance: { ...spent, remaining: 0, freeUsed: 2 } });
    render(<App />);
    await waitFor(() => expect(apiMocks.fetchRewardStatus).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg'));
    await act(async () => {
      delayed.resolve({ allowance, capabilities: { ads: false, share: false }, adCredits: [{ sessionId: 'stale-ad-credit', petId: second.id }] });
      await delayed.promise;
    });
    expect(JSON.parse(localStorage.getItem('cute-enough:allowance') ?? '{}').remaining).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    fireEvent.click(await screen.findByRole('button', { name: '하늘 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(apiMocks.revealPet).toHaveBeenCalledTimes(2));
    expect(apiMocks.revealPet.mock.calls[1].slice(1, 3)).toEqual(['FREE', undefined]);
  });

  it('rolls a failed favorite change back while preserving the collected photo', async () => {
    const pet = collectedFriend();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet] });
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [pet], legacyGiftCount: 0 });
    apiMocks.openAlbumPhoto.mockResolvedValue(collectedPhotoResponse(pet));
    apiMocks.setPetFavorite.mockRejectedValueOnce(new Error('하트를 저장하지 못했어요'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '강아지 앨범' }));
    fireEvent.click(await screen.findByRole('button', { name: /구르미, 모은 사진 2장/ }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg'));
    fireEvent.click(screen.getByRole('button', { name: /마음에 담기/ }));
    await screen.findByText('하트를 저장하지 못했어요');
    expect(screen.getByRole('button', { name: /마음에 담기/, pressed: false })).toBeEnabled();
    expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg');
    expect(apiMocks.revealPet).not.toHaveBeenCalled();
  });

  it('returns to the selected favorites tab after native back closes a collected photo', async () => {
    const pet = collectedFriend({ isFavorite: true });
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchAlbum.mockResolvedValue({ pets: [pet], legacyGiftCount: 0 });
    apiMocks.openAlbumPhoto.mockResolvedValue(collectedPhotoResponse(pet));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '강아지 앨범' }));
    fireEvent.click(await screen.findByRole('button', { name: '마음에 담은 친구' }));
    fireEvent.click(await screen.findByRole('button', { name: /구르미, 모은 사진 2장, 마음에 담은 친구/ }));
    await waitFor(() => expect(screen.getByTestId('revealed-photo-url')).toHaveTextContent('photo-newer.jpg'));
    act(() => appHarness.navigationHandlers?.onBack());
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '마음에 담은 친구', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '마음에 담은 친구 목록' })).toBeInTheDocument();
  });

  it('keeps cached all-friends visible when a superseded favorites request resolves late', async () => {
    const original = collectedFriend();
    const favorite = collectedFriend({ id: 'late-favorite', name: '하늘', isFavorite: true });
    const lateFavorites = deferred<{ pets: AlbumPetSummary[]; legacyGiftCount: number }>();
    apiMocks.fetchHouse.mockResolvedValue({ pets: [] });
    apiMocks.fetchAlbum.mockResolvedValueOnce({ pets: [original], legacyGiftCount: 0 }).mockReturnValueOnce(lateFavorites.promise);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '강아지 앨범' }));
    await screen.findByRole('button', { name: /구르미, 모은 사진 2장/ });
    fireEvent.click(screen.getByRole('button', { name: '마음에 담은 친구' }));
    await waitFor(() => expect(apiMocks.fetchAlbum).toHaveBeenCalledTimes(2));
    const favoritesSignal = apiMocks.fetchAlbum.mock.calls[1][2] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: '모든 친구' }));
    expect(screen.getByRole('button', { name: /구르미, 모은 사진 2장/ })).toBeInTheDocument();
    expect(favoritesSignal.aborted).toBe(true);
    await act(async () => { lateFavorites.resolve({ pets: [favorite], legacyGiftCount: 0 }); await lateFavorites.promise; });
    expect(screen.getByRole('button', { name: '모든 친구', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /구르미, 모은 사진 2장/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /하늘, 모은 사진/ })).not.toBeInTheDocument();
    expect(apiMocks.fetchAlbum).toHaveBeenCalledTimes(2);
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

  it('does not let a pre-reveal house response erase the replay intent after returning from play', async () => {
    const publicPet = {
      ...appHarness.submittedPet,
      id: 'public-pet',
      name: '초코',
      publishedDesign: SAMPLE_PETS[0].publishedDesign, designVersion: 1,
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
    apiMocks.revealPet.mockResolvedValueOnce({
      photoUrl: 'https://example.test/first-public-photo.jpg',
      signedUrlExpiresAt: '2026-08-28T02:10:00.000Z',
      revisitUntil: '2099-08-28T04:00:00.000Z',
      allowance: afterReveal,
    }).mockResolvedValueOnce({
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
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));

    expect(await screen.findByTestId('revealed-photo-url'))
      .toHaveTextContent('reopened-public-photo.jpg');
    expect(apiMocks.reopenPet).not.toHaveBeenCalled();
    expect(apiMocks.revealPet.mock.calls.map((call) => call[4])).toEqual(['collect', 'replay']);
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
    const pet = { ...appHarness.submittedPet, publishedDesign: SAMPLE_PETS[0].publishedDesign, designVersion: 1, id: 'retry-first', isMine: false, ownerPinned: false, approvalStatus: 'approved' as const };
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
    const pet = { ...appHarness.submittedPet, publishedDesign: SAMPLE_PETS[0].publishedDesign, designVersion: 1, id: 'earned-pet', isMine: false, ownerPinned: false, approvalStatus: 'approved' as const };
    const allowance = { date: getKstDate(), freeUsed: 0, remaining: 2, rewardedUsed: 1, uploadCredit: false, uploadUsed: false };
    const rewardStatus = { allowance, capabilities: { ads: false, share: false }, adCredits: [{ sessionId: 'earned-session', petId: pet.id }] };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance, rewardStatus });
    apiMocks.fetchRewardStatus.mockResolvedValue(rewardStatus);
    apiMocks.revealPet.mockResolvedValue({ photoUrl: 'https://example.test/earned.jpg', signedUrlExpiresAt: '2099-09-05T12:00:00Z', allowance });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '보리 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), 'REWARDED', 'earned-session', expect.any(String), 'collect'));
    expect(apiMocks.startAdReward).not.toHaveBeenCalled();
    expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
  });

  it.each([
    { remaining: 2, bonusTickets: 0, shareEnabled: true, shareSupported: true, visible: false },
    { remaining: 1, bonusTickets: 0, shareEnabled: true, shareSupported: true, visible: false },
    { remaining: 0, bonusTickets: 0, shareEnabled: true, shareSupported: true, visible: true },
    { remaining: 0, bonusTickets: 1, shareEnabled: true, shareSupported: true, visible: false },
    { remaining: 0, bonusTickets: 0, shareEnabled: false, shareSupported: true, visible: false },
    { remaining: 0, bonusTickets: 0, shareEnabled: true, shareSupported: false, visible: false },
  ])('sets home share reward visibility to $visible with $remaining free tickets, $bonusTickets bonus tickets, enabled=$shareEnabled, supported=$shareSupported', async ({ remaining, bonusTickets, shareEnabled, shareSupported, visible }) => {
    const allowance = {
      date: getKstDate(), freeUsed: 2 - remaining, remaining, bonusTickets,
      nextChargeAt: remaining < 2 ? new Date(Date.now() + 3600000).toISOString() : undefined,
      rewardedUsed: 0, uploadCredit: false, uploadUsed: false,
    };
    const status = { allowance, capabilities: { ads: false, share: shareEnabled }, adCredits: [] };
    rewardMocks.supportsShareReward.mockReturnValue(shareSupported);
    apiMocks.fetchHouse.mockResolvedValue({ pets: [], allowance, rewardStatus: status });
    apiMocks.fetchRewardStatus.mockResolvedValue(status);
    render(<App />);
    await screen.findByRole('region', { name: '강아지들이 있는 집' });
    const button = screen.queryByRole('button', { name: '친구에게 공유하고 티켓 받기' });
    if (visible) expect(button).toBeInTheDocument();
    else expect(button).not.toBeInTheDocument();
    expect(apiMocks.startShareReward).not.toHaveBeenCalled();
  });

  it('hides home share rewards automatically when a free ticket recharges', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-09-06T00:00:00.000Z'));
    const allowance = {
      date: getKstDate(), freeUsed: 2, remaining: 0, bonusTickets: 0,
      nextChargeAt: new Date(Date.now() + 60000).toISOString(),
      rewardedUsed: 0, uploadCredit: false, uploadUsed: false,
    };
    const status = { allowance, capabilities: { ads: false, share: true }, adCredits: [] };
    const recharged = { ...allowance, freeUsed: 1, remaining: 1, nextChargeAt: new Date(Date.now() + 60000 + 10800000).toISOString() };
    apiMocks.fetchHouse.mockResolvedValueOnce({ pets: [], allowance, rewardStatus: status })
      .mockResolvedValue({ pets: [], allowance: recharged, rewardStatus: { ...status, allowance: recharged } });
    apiMocks.fetchRewardStatus.mockResolvedValue(status);
    await act(async () => { render(<App />); });
    expect(screen.getByRole('button', { name: '친구에게 공유하고 티켓 받기' })).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(60500); });

    expect(screen.queryByRole('button', { name: '친구에게 공유하고 티켓 받기' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/강아지 티켓 1장/)).toBeInTheDocument();
    expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(2);
    expect(apiMocks.startShareReward).not.toHaveBeenCalled();
  });

  describe('open reward prompts after confirmed ticket changes', () => {
    function exhaustedPrompt(ads: boolean, share = false, untilRecharge = 3_600_000) {
      appHarness.adsEnabled = ads;
      const pet = collectedFriend({ unlockedPhotoCount: 0, albumPhotoId: undefined, unlockedPhotos: [],
        collection: { collectedCount: 0, totalCount: 3, collectedToday: false, canCollectToday: true } });
      const allowance = { date: getKstDate(), remaining: 0, freeUsed: 2, bonusTickets: 0,
        nextChargeAt: new Date(Date.now() + untilRecharge).toISOString(), rewardedUsed: 0, uploadCredit: false, uploadUsed: false };
      const status = { allowance, capabilities: { ads, share }, adCredits: [] as { sessionId: string; petId: string }[] };
      apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance, rewardStatus: status });
      apiMocks.fetchRewardStatus.mockResolvedValue(status);
      return { pet, allowance, status };
    }

    async function openPrompt(ads: boolean) {
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: '구르미 옮기기 또는 선택' }));
      await screen.findByRole('dialog', { name: ads ? '광고를 보고 지금 이 친구 만나기' : '다음 친구도 만나볼까요?' });
    }

    it('connects the zero-ticket home button to pet choice, ad, play and photo without another ticket', async () => {
      const { pet, allowance, status } = exhaustedPrompt(true);
      let current = status;
      apiMocks.fetchRewardStatus.mockImplementation(async () => current);
      apiMocks.startAdReward.mockResolvedValue({ ...status, sessionId: 'home-ad' });
      apiMocks.completeAdReward.mockImplementation(async () => {
        current = { ...status, adCredits: [{ sessionId: 'home-ad', petId: pet.id }] };
        return current;
      });
      rewardMocks.showRewardedAd.mockImplementation(async (_signal, onEarned) => onEarned());
      apiMocks.revealPet.mockResolvedValue({ ...collectedPhotoResponse(pet), allowance });
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /광고 보고 한 마리 더 만나기/ }));
      const picker = await screen.findByRole('dialog', { name: '어떤 친구를 만나볼까요?' });
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
      fireEvent.click(within(picker).getByRole('button', { name: pet.name }));
      fireEvent.click(await screen.findByRole('button', { name: '광고 보고 이 친구 만나기' }));
      await screen.findByTestId('play-scene');
      expect(screen.getByText('받은 광고 보상으로 만나요. 티켓은 쓰지 않아요.')).toBeInTheDocument();
      expect(screen.queryByText('새 사진을 만나면 티켓 1장을 써요')).not.toBeInTheDocument();
      expect(rewardMocks.showRewardedAd).toHaveBeenCalledOnce();
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
      await screen.findByRole('dialog', { name: '강아지 실사 사진' });
      expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), 'REWARDED', 'home-ad', expect.any(String), 'collect');
      expect(JSON.parse(localStorage.getItem('cute-enough:allowance') ?? '{}').remaining).toBe(0);
    });

    it('offers only ad-eligible pets, not owner or free replays, and native back dismisses choice', async () => {
      const { pet, allowance, status } = exhaustedPrompt(true);
      const replay = { ...pet, id: 'replay', name: '다시', unlockedPhotoCount: 1,
        collection: { collectedCount: 1, totalCount: 3, collectedToday: true, canCollectToday: false } };
      apiMocks.fetchHouse.mockResolvedValue({ pets: [pet, replay], ownerBonusPet: appHarness.submittedPet, allowance, rewardStatus: status });
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /광고 보고 한 마리 더 만나기/ }));
      const picker = screen.getByRole('dialog', { name: '어떤 친구를 만나볼까요?' });
      expect(within(picker).getByRole('button', { name: pet.name })).toBeInTheDocument();
      expect(within(picker).queryByRole('button', { name: '다시' })).not.toBeInTheDocument();
      expect(within(picker).queryByRole('button', { name: '보리' })).not.toBeInTheDocument();
      await act(async () => appHarness.navigationHandlers?.onBack());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
    });

    it('offers the album instead of an ad when every friend is a free replay', async () => {
      const { pet, allowance, status } = exhaustedPrompt(true);
      apiMocks.fetchHouse.mockResolvedValue({ pets: [{ ...pet, unlockedPhotoCount: 1,
        collection: { collectedCount: 1, totalCount: 1, collectedToday: true, canCollectToday: false } }], allowance, rewardStatus: status });
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /광고 보고 한 마리 더 만나기/ }));
      expect(screen.getByText('모아 둔 사진은 무료로 다시 볼 수 있어요.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '강아지 앨범 보기' }));
      await waitFor(() => expect(apiMocks.fetchAlbum).toHaveBeenCalled());
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
    });

    it.each(['awaiting-confirmation', 'reward-earned'] as const)('allows explicit app return while native %s is pending', async (phase) => {
      const { status } = exhaustedPrompt(true);
      apiMocks.startAdReward.mockResolvedValue({ ...status, sessionId: 'no-dismiss' });
      const dismissal = deferred<void>();
      rewardMocks.showRewardedAd.mockReturnValue(dismissal.promise);
      apiMocks.cancelAdReward.mockResolvedValue(status);
      await openPrompt(true);
      fireEvent.click(screen.getByRole('button', { name: '광고 보고 이 친구 만나기' }));
      await waitFor(() => expect(rewardMocks.showRewardedAd).toHaveBeenCalledOnce());
      act(() => appHarness.adStatusListener?.(phase));
      const resume = screen.getByRole('button', { name: phase === 'reward-earned' ? '받은 보상으로 계속하기' : '광고 없이 돌아왔어요 · 다시 확인' });
      expect(resume).not.toBeDisabled();
      fireEvent.click(resume);
      expect(rewardMocks.confirmRewardedAdReturn).toHaveBeenCalledOnce();
      expect(apiMocks.completeAdReward).not.toHaveBeenCalled();
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
      await act(async () => { dismissal.reject(new Error('광고 확인 필요')); await dismissal.promise.catch(() => undefined); });
    });

    it('recovers a lost start with the same id before allowing a different pet ad', async () => {
      const { pet, allowance, status } = exhaustedPrompt(true);
      const other = { ...pet, id: 'another-friend', name: '하늘' };
      apiMocks.fetchHouse.mockResolvedValue({ pets: [pet, other], allowance, rewardStatus: status });
      apiMocks.startAdReward.mockRejectedValueOnce(new Error('시작 응답을 받지 못했어요'))
        .mockImplementation(async (_petId, requestId) => ({ ...status, sessionId: requestId }));
      apiMocks.cancelAdReward.mockResolvedValue(status);
      rewardMocks.showRewardedAd.mockRejectedValue(new Error('테스트 광고 취소'));
      await openPrompt(true);
      fireEvent.click(screen.getByRole('button', { name: '광고 보고 이 친구 만나기' }));
      await waitFor(() => expect(apiMocks.cancelAdReward).toHaveBeenCalledOnce());
      const firstId = apiMocks.startAdReward.mock.calls[0][1];
      expect(apiMocks.startAdReward.mock.calls[1]).toEqual([pet.id, firstId]);
      expect(readPendingAdStarts()).toHaveLength(0);
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
      await act(async () => appHarness.navigationHandlers?.onBack());
      fireEvent.click(screen.getByRole('button', { name: '하늘 옮기기 또는 선택' }));
      fireEvent.click(await screen.findByRole('button', { name: '광고 보고 이 친구 만나기' }));
      await waitFor(() => expect(rewardMocks.showRewardedAd).toHaveBeenCalledOnce());
      expect(apiMocks.startAdReward.mock.calls[2][0]).toBe(other.id);
      expect(apiMocks.startAdReward.mock.calls[2][1]).not.toBe(firstId);
      await waitFor(() => expect(apiMocks.cancelAdReward).toHaveBeenCalledTimes(2));
      expect(apiMocks.completeAdReward).not.toHaveBeenCalled();
    });

    it('continues an earned reward after a missing dismissal only on explicit app interaction', async () => {
      const { pet, status } = exhaustedPrompt(true);
      let current = status;
      apiMocks.fetchRewardStatus.mockImplementation(async () => current);
      apiMocks.startAdReward.mockResolvedValue({ ...status, sessionId: 'earned-no-dismiss' });
      apiMocks.completeAdReward.mockImplementation(async () => {
        current = { ...status, adCredits: [{ sessionId: 'earned-no-dismiss', petId: pet.id }] };
        return current;
      });
      const dismissal = deferred<void>();
      let earned!: () => void;
      rewardMocks.showRewardedAd.mockImplementation((_signal, onEarned) => { earned = onEarned; return dismissal.promise; });
      rewardMocks.confirmRewardedAdReturn.mockImplementation(() => { dismissal.resolve(); return true; });
      await openPrompt(true);
      fireEvent.click(screen.getByRole('button', { name: '광고 보고 이 친구 만나기' }));
      await waitFor(() => expect(rewardMocks.showRewardedAd).toHaveBeenCalledOnce());
      await act(async () => { earned(); appHarness.adStatusListener?.('reward-earned'); });
      await waitFor(() => expect(apiMocks.completeAdReward).toHaveBeenCalledOnce());
      expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '받은 보상으로 계속하기' }));
      expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-pet-id', pet.id);
      expect(apiMocks.startAdReward).toHaveBeenCalledOnce();
      expect(apiMocks.completeAdReward).toHaveBeenCalledOnce();
      expect(apiMocks.cancelAdReward).not.toHaveBeenCalled();
    });

    it.each([false, true])('preserves earned completion through storage failure with an existing cancel=%s', async (existingCancel) => {
      const { pet, status } = exhaustedPrompt(true);
      let current = status;
      let failRecoveryStorage = false;
      const setItem = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
        if (failRecoveryStorage && key === 'cute-enough:reward-recovery:v1') throw new Error('recovery storage unavailable');
        setItem.call(this, key, value);
      });
      apiMocks.fetchRewardStatus.mockImplementation(async () => current);
      apiMocks.startAdReward.mockResolvedValue({ ...status, sessionId: 'earned-without-storage' });
      apiMocks.completeAdReward.mockRejectedValueOnce(new Error('completion offline')).mockImplementation(async () => {
        current = { ...status, adCredits: [{ sessionId: 'earned-without-storage', petId: pet.id }] };
        return current;
      });
      rewardMocks.showRewardedAd.mockImplementation(async (_signal, onEarned) => {
        if (existingCancel) enqueueRewardRecovery({ kind: 'adCancel', requestId: 'stale-cancel', sessionId: 'earned-without-storage' });
        failRecoveryStorage = true;
        onEarned();
      });
      await openPrompt(true);
      fireEvent.click(screen.getByRole('button', { name: '광고 보고 이 친구 만나기' }));
      await waitFor(() => expect(apiMocks.completeAdReward).toHaveBeenCalledOnce());
      expect(readPendingAdStarts()).toEqual([expect.objectContaining({ phase: 'native', sessionId: 'earned-without-storage' })]);
      expect(readActiveRewardSessions()).toEqual([{ kind: 'ad', sessionId: 'earned-without-storage' }]);
      expect(readRewardRecovery().some((job) => job.kind === 'adComplete')).toBe(false);
      expect(apiMocks.cancelAdReward).not.toHaveBeenCalled();
      await act(async () => window.dispatchEvent(new Event('online')));
      await waitFor(() => expect(apiMocks.completeAdReward).toHaveBeenCalledTimes(2));
      expect(apiMocks.cancelAdReward).not.toHaveBeenCalled();
      expect(current.adCredits).toEqual([{ sessionId: 'earned-without-storage', petId: pet.id }]);
      failRecoveryStorage = false;
      await act(async () => window.dispatchEvent(new Event('online')));
      await waitFor(() => expect(readPendingAdStarts()).toEqual([]));
      expect(readActiveRewardSessions()).toEqual([]);
      expect(readRewardRecovery()).toEqual([]);
      expect(apiMocks.completeAdReward.mock.calls).toEqual([
        ['earned-without-storage'], ['earned-without-storage'], ['earned-without-storage'],
      ]);
      expect(apiMocks.cancelAdReward).not.toHaveBeenCalled();
      expect(apiMocks.startAdReward).toHaveBeenCalledOnce();
      expect(rewardMocks.showRewardedAd).toHaveBeenCalledOnce();
      await act(async () => window.dispatchEvent(new Event('online')));
      expect(apiMocks.completeAdReward).toHaveBeenCalledTimes(3);
    });

    it.each([
      { ads: false, kind: 'free' }, { ads: true, kind: 'free' },
      { ads: false, kind: 'bonus' }, { ads: true, kind: 'bonus' },
    ])('changes the open ads=$ads prompt for confirmed $kind tickets without spending before snacks', async ({ ads, kind }) => {
      const { pet, allowance, status } = exhaustedPrompt(ads, true);
      await openPrompt(ads);
      const granted = kind === 'free' ? { ...allowance, remaining: 1, freeUsed: 1 } : { ...allowance, bonusTickets: 1 };
      apiMocks.fetchRewardStatus.mockResolvedValue({ ...status, allowance: granted });
      act(() => window.dispatchEvent(new Event('focus')));
      const button = await screen.findByRole('button', { name: '티켓으로 이 친구 만나기' });
      expect(screen.queryByRole('button', { name: '공유하고 티켓 받기' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '광고 보고 이 친구 만나기' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
      expect(apiMocks.startShareReward).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-pet-id', pet.id);
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
      apiMocks.revealPet.mockResolvedValue({ ...collectedPhotoResponse(pet), allowance: { ...granted, remaining: 0, bonusTickets: 0 } });
      fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
      await waitFor(() => expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), kind === 'free' ? 'FREE' : 'SHARE', undefined, expect.any(String), 'collect'));
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
    });

    it.each([false, true])('keeps ads=%s prompt unconfirmed when only the countdown passes and the server refresh fails', async (ads) => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(new Date('2026-09-06T00:00:00.000Z'));
      const { pet, allowance, status } = exhaustedPrompt(ads, true, 60_000);
      apiMocks.fetchHouse.mockResolvedValueOnce({ pets: [pet], allowance, rewardStatus: status }).mockRejectedValue(new Error('offline'));
      await act(async () => { render(<App />); });
      fireEvent.click(screen.getByRole('button', { name: '구르미 옮기기 또는 선택' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(60_500); });
      expect(apiMocks.fetchHouse).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('button', { name: '티켓으로 이 친구 만나기' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: ads ? '광고를 보고 지금 이 친구 만나기' : '다음 친구도 만나볼까요?' })).toBeInTheDocument();
      expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
    });

    it('rechecks the old ad action after recovery confirms a charge, before opening a new ad session', async () => {
      const { pet, allowance, status } = exhaustedPrompt(true);
      await openPrompt(true);
      const recovery = deferred<typeof status>();
      apiMocks.fetchRewardStatus.mockReturnValueOnce(recovery.promise);
      fireEvent.click(screen.getByRole('button', { name: '광고 보고 이 친구 만나기' }));
      await waitFor(() => expect(apiMocks.fetchRewardStatus).toHaveBeenCalledTimes(2));
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
      await act(async () => { recovery.resolve({ ...status, allowance: { ...allowance, remaining: 1, freeUsed: 1 } }); await recovery.promise; });
      expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-pet-id', pet.id);
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
      apiMocks.revealPet.mockResolvedValue({ ...collectedPhotoResponse(pet), allowance });
      fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
      await waitFor(() => expect(apiMocks.revealPet.mock.calls[0][1]).toBe('FREE'));
    });

    it('does not reopen a cancelled prompt after its in-flight reward recovery returns a ticket', async () => {
      const { allowance, status } = exhaustedPrompt(true);
      await openPrompt(true);
      const recovery = deferred<typeof status>();
      apiMocks.fetchRewardStatus.mockReturnValueOnce(recovery.promise);
      fireEvent.click(screen.getByRole('button', { name: '광고 보고 이 친구 만나기' }));
      await waitFor(() => expect(apiMocks.fetchRewardStatus).toHaveBeenCalledTimes(2));
      act(() => appHarness.navigationHandlers?.onBack());
      await act(async () => { recovery.resolve({ ...status, allowance: { ...allowance, remaining: 1, freeUsed: 1 } }); await recovery.promise; });
      expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
    });

    it.each([false, true])('keeps the selected dog after a share reward in ads=%s prompt and waits until native sharing closes', async (ads) => {
      const { pet, allowance, status } = exhaustedPrompt(ads, true);
      let currentStatus = status;
      apiMocks.fetchRewardStatus.mockImplementation(async () => currentStatus);
      apiMocks.startShareReward.mockImplementation(async () => ({ ...currentStatus, sessionId: 'share-prompt-session' }));
      apiMocks.recordShareReward.mockImplementation(async () => {
        currentStatus = { ...status, allowance: { ...allowance, bonusTickets: 1 } };
        return currentStatus;
      });
      apiMocks.closeShareReward.mockImplementation(async () => currentStatus);
      const nativeClose = deferred<void>();
      let callbacks!: { onReward: (amount: number, sequence: number, unit: string) => void; onClose: (summary: { sentRewardsCount: number; sentRewardAmount: number }) => void };
      rewardMocks.openShareReward.mockImplementation((next) => { callbacks = next; return nativeClose.promise; });
      await openPrompt(ads);
      fireEvent.click(screen.getByRole('button', { name: '공유하고 티켓 받기' }));
      await waitFor(() => expect(rewardMocks.openShareReward).toHaveBeenCalledOnce());
      act(() => callbacks.onReward(1, 1, '티켓'));
      const dialog = await screen.findByRole('dialog', { name: '이 친구를 만날 준비가 됐어요' });
      const ready = within(dialog).getByRole('button', { name: '잠시만요…' });
      expect(ready).toBeDisabled();
      fireEvent.click(ready);
      expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
      await act(async () => { callbacks.onClose({ sentRewardsCount: 1, sentRewardAmount: 1 }); nativeClose.resolve(); await nativeClose.promise; });
      await waitFor(() => expect(ready).toBeEnabled());
      expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
      fireEvent.click(ready);
      expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-pet-id', pet.id);
      expect(apiMocks.startShareReward).toHaveBeenCalledOnce();
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
    });

    it.each([false, true])('uses a newly confirmed earned credit from the ads=%s prompt without starting or spending another reward', async (ads) => {
      const { pet, allowance, status } = exhaustedPrompt(ads);
      await openPrompt(ads);
      apiMocks.fetchRewardStatus.mockResolvedValue({ ...status, allowance: { ...allowance, remaining: 1, freeUsed: 1 }, adCredits: [{ sessionId: 'earned-prompt-credit', petId: pet.id }] });
      act(() => window.dispatchEvent(new Event('focus')));
      fireEvent.click(await screen.findByRole('button', { name: '받은 보상으로 이 친구 만나기' }));
      expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-pet-id', pet.id);
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
      apiMocks.revealPet.mockResolvedValue({ ...collectedPhotoResponse(pet), allowance });
      fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
      await waitFor(() => expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), 'REWARDED', 'earned-prompt-credit', expect.any(String), 'collect'));
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
    });

    it.each([false, true])('keeps a confirmed ticket or credit from starting a second play while an ad is open, cancelled=%s', async (cancelled) => {
      const { pet, allowance, status } = exhaustedPrompt(true);
      let currentStatus = status;
      apiMocks.fetchRewardStatus.mockImplementation(async () => currentStatus);
      apiMocks.startAdReward.mockImplementation(async () => ({ ...currentStatus, sessionId: 'active-prompt-ad' }));
      apiMocks.completeAdReward.mockImplementation(async () => {
        currentStatus = { ...status, allowance: { ...allowance, remaining: 1, freeUsed: 1 }, adCredits: [{ sessionId: 'active-prompt-ad', petId: pet.id }] };
        return currentStatus;
      });
      const dismissal = deferred<void>();
      let earned!: () => void;
      rewardMocks.showRewardedAd.mockImplementation((_signal, onEarned) => { earned = onEarned; return dismissal.promise; });
      await openPrompt(true);
      fireEvent.click(screen.getByRole('button', { name: '광고 보고 이 친구 만나기' }));
      await waitFor(() => expect(rewardMocks.showRewardedAd).toHaveBeenCalledOnce());
      act(() => earned());
      const dialog = await screen.findByRole('dialog', { name: '이 친구를 만날 준비가 됐어요' });
      const ready = within(dialog).getByRole('button', { name: '잠시만요…' });
      expect(ready).toBeDisabled();
      fireEvent.click(ready);
      expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
      if (cancelled) act(() => appHarness.navigationHandlers?.onBack());
      await act(async () => { dismissal.resolve(); await dismissal.promise; });
      if (cancelled) {
        expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      } else expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-pet-id', pet.id);
      expect(apiMocks.startAdReward).toHaveBeenCalledOnce();
      expect(apiMocks.completeAdReward).toHaveBeenCalledOnce();
      expect(apiMocks.cancelAdReward).not.toHaveBeenCalled();
      expect(apiMocks.revealPet).not.toHaveBeenCalled();
    });

    it.each([
      { ads: false, right: 'revisit' }, { ads: true, right: 'revisit' },
      { ads: false, right: 'owner' }, { ads: true, right: 'owner' },
      { ads: false, right: 'rejected' }, { ads: true, right: 'rejected' },
    ])('refreshes the original friend to $right in ads=$ads prompt without consuming a ticket', async ({ ads, right }) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-06T00:00:00.000Z'));
      const { pet, allowance, status } = exhaustedPrompt(ads, false, 60_000);
      await openPrompt(ads);
      const refreshed = right === 'revisit'
        ? { ...pet, unlockedPhotoCount: 1, albumPhotoId: 'existing-photo', collection: { collectedCount: 1, totalCount: 3, collectedToday: true, canCollectToday: false } }
        : right === 'owner' ? { ...pet, isMine: true, ownerPhotoAvailable: true }
          : { ...pet, approvalStatus: 'rejected' as const };
      apiMocks.fetchHouse.mockResolvedValue({ pets: [refreshed], allowance, rewardStatus: status });
      vi.setSystemTime(new Date('2026-09-06T00:01:01.000Z'));
      act(() => window.dispatchEvent(new Event('focus')));
      const label = right === 'revisit' ? '이 친구 다시 만나기' : right === 'owner' ? '우리 강아지 만나기' : '확인';
      fireEvent.click(await screen.findByRole('button', { name: label }));
      if (right === 'rejected') {
        expect(screen.queryByTestId('play-scene')).not.toBeInTheDocument();
        expect(apiMocks.revealPet).not.toHaveBeenCalled();
      } else {
        expect(await screen.findByTestId('play-scene')).toHaveAttribute('data-pet-id', pet.id);
        expect(apiMocks.revealPet).not.toHaveBeenCalled();
        expect(apiMocks.openOwnerPhoto).not.toHaveBeenCalled();
        apiMocks.revealPet.mockResolvedValue({ ...collectedPhotoResponse(pet), allowance });
        apiMocks.openOwnerPhoto.mockResolvedValue({ photoUrl: 'https://example.test/owner.jpg', photoId: 'owner-photo', signedUrlExpiresAt: '2099-09-05T12:00:00Z' });
        fireEvent.click(screen.getByRole('button', { name: '간식 주기' }));
        if (right === 'revisit') await waitFor(() => expect(apiMocks.revealPet.mock.calls[0][4]).toBe('replay'));
        else await waitFor(() => expect(apiMocks.openOwnerPhoto).toHaveBeenCalledOnce());
      }
      expect(apiMocks.startAdReward).not.toHaveBeenCalled();
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
    });
  });

  it('shows share rewards after all tickets are used and replays an uncertain grant with the same event identity', async () => {
    let allowance = { date: getKstDate(), freeUsed: 2, remaining: 0, nextChargeAt: new Date(Date.now() + 3600000).toISOString(), rewardedUsed: 0, bonusTickets: 0, uploadCredit: false, uploadUsed: false };
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
    await waitFor(() => expect(screen.getByText('무료 티켓 0장 · 보너스 티켓 1장')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '친구에게 공유하고 티켓 받기' })).not.toBeInTheDocument();
    expect(apiMocks.recordShareReward).toHaveBeenCalledTimes(2);
    expect(apiMocks.recordShareReward.mock.calls[0]).toEqual(apiMocks.recordShareReward.mock.calls[1]);
    expect(apiMocks.recordShareReward.mock.calls[0]).toEqual(['share-session', expect.any(String), 1, 1]);
    expect(apiMocks.closeShareReward).toHaveBeenCalledOnce();
  });

  it('uses a bonus ticket when free tickets are empty without opening an ad', async () => {
    const pet = { ...appHarness.submittedPet, publishedDesign: SAMPLE_PETS[0].publishedDesign, designVersion: 1, id: 'bonus-pet', isMine: false, ownerPinned: false, approvalStatus: 'approved' as const };
    const allowance = { date: getKstDate(), freeUsed: 2, remaining: 0, nextChargeAt: new Date(Date.now() + 3600000).toISOString(), rewardedUsed: 0, bonusTickets: 1, uploadCredit: false, uploadUsed: false };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet], allowance });
    apiMocks.revealPet.mockResolvedValue({ photoUrl: 'https://example.test/bonus.jpg', signedUrlExpiresAt: '2099-09-05T12:00:00Z', allowance: { ...allowance, bonusTickets: 0 } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '보리 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    await waitFor(() => expect(apiMocks.revealPet).toHaveBeenCalledWith(expect.objectContaining({ id: pet.id }), 'SHARE', undefined, expect.any(String), 'collect'));
    expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
  });

  it('starts the server ad session before showing and records earned reward while the native ad remains open', async () => {
    appHarness.adsEnabled = true;
    const pet = { ...appHarness.submittedPet, publishedDesign: SAMPLE_PETS[0].publishedDesign, designVersion: 1, id: 'new-ad-pet', isMine: false, ownerPinned: false, approvalStatus: 'approved' as const };
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
    const pet = { ...appHarness.submittedPet, publishedDesign: SAMPLE_PETS[0].publishedDesign, designVersion: 1, id: 'expired-revisit', isMine: false, approvalStatus: 'approved' as const, revisitUntil: '2099-09-05T12:00:00Z' };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [pet] });
    apiMocks.revealPet.mockRejectedValue(Object.assign(new Error('다시 만날 시간이 지났어요.'), { code: 'PET_REVISIT_EXPIRED' }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '보리 옮기기 또는 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
    fireEvent.click(await screen.findByRole('button', { name: '집에서 다시 만나기' }));
    expect(await screen.findByRole('region', { name: '강아지들이 있는 집' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '강아지 실사 사진' })).not.toBeInTheDocument();
    expect(apiMocks.reopenPet).not.toHaveBeenCalled();
    expect(apiMocks.revealPet).toHaveBeenCalledOnce();
    expect(apiMocks.revealPet.mock.calls[0][4]).toBe('replay');
  });

  describe('pending ad start rejection recovery', () => {
    function pendingStart() {
      const pending = rememberPendingAdStart('interrupted-start-pet');
      const allowance = { date: getKstDate(), freeUsed: 2, remaining: 0, rewardedUsed: 0, bonusTickets: 0, uploadCredit: false, uploadUsed: false };
      const status = { allowance, capabilities: { ads: false, share: false }, adCredits: [] as { sessionId: string; petId: string }[] };
      apiMocks.fetchHouse.mockResolvedValue({ pets: [], allowance });
      apiMocks.fetchRewardStatus.mockResolvedValue(status);
      return { pending, status };
    }

    it.each([
      'REWARDED_LIMIT_REACHED', 'PET_NOT_AVAILABLE', 'PHOTO_NOT_REVEALABLE', 'OWNER_PHOTO_FREE', 'ALBUM_ALL_PHOTOS_UNLOCKED', 'ALBUM_PET_NOT_TODAY',
      'DAILY_PHOTO_ALREADY_COLLECTED', 'FREE_ALLOWANCE_AVAILABLE', 'BONUS_ALLOWANCE_AVAILABLE', 'BONUS_TICKETS_AVAILABLE',
      'PET_REVISIT_ACTIVE', 'AD_REWARD_AVAILABLE',
    ])('retires a definitive %s rejection without retrying or opening native ads', async (code) => {
      const { pending } = pendingStart();
      apiMocks.startAdReward.mockRejectedValue(Object.assign(new Error('start rejected'), { code }));
      render(<App />);
      await waitFor(() => expect(apiMocks.fetchRewardStatus).toHaveBeenCalled());
      expect(apiMocks.startAdReward).toHaveBeenCalledWith(pending.petId, pending.requestId);
      expect(readPendingAdStarts()).toEqual([]);
      await act(async () => window.dispatchEvent(new Event('online')));
      expect(apiMocks.startAdReward).toHaveBeenCalledOnce();
      expect(apiMocks.cancelAdReward).not.toHaveBeenCalled();
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
    });

    it.each([
      ['ADS_DISABLED', 'cancelled'], ['ADS_DISABLED', 'not-found'],
      ['REWARDED_ADS_DISABLED', 'cancelled'], ['REWARDED_ADS_DISABLED', 'not-found'],
    ])('retires %s only after the original request is confirmed %s', async (code, result) => {
      const { pending, status } = pendingStart();
      apiMocks.startAdReward.mockRejectedValue(Object.assign(new Error('ads disabled'), { code }));
      const cancellation = deferred<typeof status>();
      apiMocks.cancelAdReward.mockReturnValue(cancellation.promise);
      render(<App />);
      await waitFor(() => expect(apiMocks.cancelAdReward).toHaveBeenCalledWith(pending.requestId));
      expect(readPendingAdStarts()).toEqual([pending]);
      await act(async () => {
        if (result === 'cancelled') cancellation.resolve(status);
        else cancellation.reject(Object.assign(new Error('session absent'), { code: 'AD_SESSION_NOT_FOUND' }));
        await cancellation.promise.catch(() => undefined);
      });
      await waitFor(() => expect(readPendingAdStarts()).toEqual([]));
      expect(readRewardRecovery()).toEqual([]);
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
      expect(apiMocks.completeAdReward).not.toHaveBeenCalled();
    });

    it('retains a disabled start through cancellation transport failure and retries the identical session online', async () => {
      const { pending, status } = pendingStart();
      apiMocks.startAdReward.mockRejectedValue(Object.assign(new Error('ads disabled'), { code: 'REWARDED_ADS_DISABLED' }));
      apiMocks.cancelAdReward.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(status);
      render(<App />);
      await waitFor(() => expect(apiMocks.fetchRewardStatus).toHaveBeenCalledOnce());
      expect(readPendingAdStarts()).toEqual([pending]);
      expect(apiMocks.cancelAdReward).toHaveBeenCalledWith(pending.requestId);
      await act(async () => window.dispatchEvent(new Event('online')));
      await waitFor(() => expect(readPendingAdStarts()).toEqual([]));
      expect(apiMocks.startAdReward.mock.calls).toEqual([[pending.petId, pending.requestId], [pending.petId, pending.requestId]]);
      expect(apiMocks.cancelAdReward.mock.calls).toEqual([[pending.requestId], [pending.requestId]]);
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
      expect(apiMocks.completeAdReward).not.toHaveBeenCalled();
    });

    it.each(['REQUEST_TIMEOUT', 'AD_SESSION_ACTIVE'])('preserves an uncertain %s response for replay with the same request ID', async (code) => {
      const { pending } = pendingStart();
      apiMocks.startAdReward.mockRejectedValue(Object.assign(new Error('retry required'), { code }));
      render(<App />);
      await waitFor(() => expect(apiMocks.fetchRewardStatus).toHaveBeenCalledOnce());
      expect(readPendingAdStarts()).toEqual([pending]);
      await act(async () => window.dispatchEvent(new Event('online')));
      expect(apiMocks.startAdReward.mock.calls).toEqual([[pending.petId, pending.requestId], [pending.petId, pending.requestId]]);
      expect(readPendingAdStarts()).toEqual([pending]);
      expect(apiMocks.cancelAdReward).not.toHaveBeenCalled();
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
    });

    it('rechecks earned callbacks that arrive while a disabled start replay is in flight before cancelling', async () => {
      const { pending, status } = pendingStart();
      const replay = deferred<typeof status & { sessionId: string }>();
      apiMocks.startAdReward.mockReturnValue(replay.promise);
      const earnedStatus = { ...status, adCredits: [{ sessionId: pending.requestId, petId: pending.petId }] };
      apiMocks.completeAdReward.mockResolvedValue(earnedStatus);
      apiMocks.fetchRewardStatus.mockResolvedValue(earnedStatus);
      render(<App />);
      await waitFor(() => expect(apiMocks.startAdReward).toHaveBeenCalledOnce());
      enqueueRewardRecovery({ kind: 'adComplete', requestId: 'earned-during-replay', sessionId: pending.requestId, petId: pending.petId });
      await act(async () => {
        replay.reject(Object.assign(new Error('ads disabled'), { code: 'REWARDED_ADS_DISABLED' }));
        await replay.promise.catch(() => undefined);
      });
      await waitFor(() => expect(apiMocks.completeAdReward).toHaveBeenCalledWith(pending.requestId));
      expect(readPendingAdStarts()).toEqual([]);
      expect(apiMocks.cancelAdReward).not.toHaveBeenCalled();
      expect(rewardMocks.showRewardedAd).not.toHaveBeenCalled();
    });
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
      publishedDesign: SAMPLE_PETS[0].publishedDesign, designVersion: 1,
      isMine: false,
      ownerPinned: false,
      approvalStatus: 'approved' as const,
      ownerPhotoAvailable: false,
      revisitUntil: '2099-08-28T04:00:00.000Z',
    };
    apiMocks.fetchHouse.mockResolvedValue({ pets: [publicPet] });
    apiMocks.revealPet.mockResolvedValue({
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
    fireEvent.click(await screen.findByRole('button', { name: '간식 주기' }));
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
