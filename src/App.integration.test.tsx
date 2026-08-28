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
      rewardGranted: false,
    },
    navigationHandlers: undefined as undefined | { onBack: () => void; onHome: () => void },
  };
});

const apiMocks = vi.hoisted(() => ({
  fetchHouse: vi.fn(),
  fetchMyPets: vi.fn(),
  fetchSharedPet: vi.fn(),
  reopenPet: vi.fn(),
  reportPet: vi.fn(),
  revealPet: vi.fn(),
}));

vi.mock('@toss/tds-mobile', async () => import('./web-preview/tds-mobile'));

vi.mock('./lib/api', () => apiMocks);

vi.mock('./lib/nativeNavigation', () => ({
  closeMiniApp: vi.fn(() => Promise.resolve()),
  getInitialSharedPetId: vi.fn(() => undefined),
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
  MyPetsScreen: ({ onUpload }: { onUpload: () => void }) => (
    <main>
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
  PlayScene: ({ pet }: { pet: typeof appHarness.submittedPet }) => (
    <main data-testid="play-scene" data-pet-id={pet.id} data-status={pet.approvalStatus}>
      {pet.name}와 노는 중
    </main>
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
  fireEvent.click(screen.getByRole('button', { name: '내가 올린 강아지' }));
  fireEvent.click(await screen.findByRole('button', { name: '새 강아지 소개하기' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pending 등록 완료' }));
  await screen.findByRole('heading', { name: '보리가 집에 놀러 왔어요' });
}

describe('App upload submission integration', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    appHarness.navigationHandlers = undefined;
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.fetchMyPets.mockResolvedValue([]);
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
});
