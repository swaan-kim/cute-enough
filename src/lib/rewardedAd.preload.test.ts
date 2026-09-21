import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';

const native = vi.hoisted(() => ({ loadCleanup: vi.fn() }));

vi.mock('@apps-in-toss/web-framework', () => ({
  loadFullScreenAd: Object.assign(vi.fn(() => native.loadCleanup), { isSupported: () => true }),
  showFullScreenAd: Object.assign(vi.fn(), { isSupported: () => true }),
}));
vi.mock('./analytics', () => ({ trackProductEvent: vi.fn() }));

type RewardedAdModule = typeof import('./rewardedAd');
let ads: RewardedAdModule;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('VITE_APP_RUNTIME', 'production');
  vi.stubEnv('VITE_ADS_ENABLED', 'true');
  vi.stubEnv('VITE_ADS_TEST_MODE', 'false');
  vi.stubEnv('VITE_REWARDED_AD_GROUP_ID', 'live-group');
  ads = await import('./rewardedAd');
});

afterEach(() => {
  ads.disposeRewardedAd();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function loaded() {
  vi.mocked(loadFullScreenAd).mock.calls.at(-1)![0].onEvent({ type: 'loaded' });
}

describe('abortable shared rewarded ad preload', () => {
  it('rejects a pre-aborted request without starting a native load', async () => {
    const abort = new AbortController();
    abort.abort();

    await expect(ads.preloadRewardedAd(abort.signal)).rejects.toMatchObject({ name: 'AbortError' });

    expect(ads.getRewardedAdStatus()).toBe('idle');
    expect(loadFullScreenAd).not.toHaveBeenCalled();
    expect(showFullScreenAd).not.toHaveBeenCalled();
  });

  it('stops the cancelled caller immediately while another caller completes the shared load', async () => {
    const abort = new AbortController();
    const removeListener = vi.spyOn(abort.signal, 'removeEventListener');
    const backgroundLoad = ads.preloadRewardedAd();
    const cancelledLoad = ads.preloadRewardedAd(abort.signal);
    const cancellation = expect(cancelledLoad).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await cancellation;

    expect(removeListener).toHaveBeenCalledOnce();
    expect(ads.getRewardedAdStatus()).toBe('loading');
    expect(native.loadCleanup).not.toHaveBeenCalled();
    expect(loadFullScreenAd).toHaveBeenCalledOnce();

    loaded();
    await expect(backgroundLoad).resolves.toBeUndefined();
    await expect(ads.preloadRewardedAd()).resolves.toBeUndefined();

    expect(ads.getRewardedAdStatus()).toBe('loaded');
    expect(loadFullScreenAd).toHaveBeenCalledOnce();
    expect(native.loadCleanup).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(showFullScreenAd).not.toHaveBeenCalled();
  });

  it('keeps a load reusable even when its only waiting caller cancels', async () => {
    const abort = new AbortController();
    const loading = ads.preloadRewardedAd(abort.signal);
    const cancellation = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await cancellation;

    loaded();
    await expect(ads.preloadRewardedAd(new AbortController().signal)).resolves.toBeUndefined();

    expect(ads.getRewardedAdStatus()).toBe('loaded');
    expect(loadFullScreenAd).toHaveBeenCalledOnce();
    expect(showFullScreenAd).not.toHaveBeenCalled();
  });

  it('removes its abort listener when loading succeeds', async () => {
    const abort = new AbortController();
    const addListener = vi.spyOn(abort.signal, 'addEventListener');
    const removeListener = vi.spyOn(abort.signal, 'removeEventListener');
    const loading = ads.preloadRewardedAd(abort.signal);
    loaded();
    await expect(loading).resolves.toBeUndefined();

    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', addListener.mock.calls[0][1]);
    abort.abort();
    expect(ads.getRewardedAdStatus()).toBe('loaded');
    expect(showFullScreenAd).not.toHaveBeenCalled();
  });

  it('removes its abort listener and preserves the original load failure', async () => {
    const abort = new AbortController();
    const addListener = vi.spyOn(abort.signal, 'addEventListener');
    const removeListener = vi.spyOn(abort.signal, 'removeEventListener');
    const loading = ads.preloadRewardedAd(abort.signal);
    const failure = new Error('network unavailable');
    const rejection = expect(loading).rejects.toBe(failure);
    vi.mocked(loadFullScreenAd).mock.calls[0][0].onError(failure);
    await rejection;

    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', addListener.mock.calls[0][1]);
    expect(ads.getRewardedAdStatus()).toBe('error');
    expect(showFullScreenAd).not.toHaveBeenCalled();
  });

  it('handles a shared load failure after the caller has already cancelled', async () => {
    const abort = new AbortController();
    const loading = ads.preloadRewardedAd(abort.signal);
    const cancellation = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await cancellation;

    vi.mocked(loadFullScreenAd).mock.calls[0][0].onError(new Error('late load failure'));
    await Promise.resolve();
    const retry = ads.preloadRewardedAd();
    loaded();
    await expect(retry).resolves.toBeUndefined();

    expect(loadFullScreenAd).toHaveBeenCalledTimes(2);
    expect(showFullScreenAd).not.toHaveBeenCalled();
  });

  it('preserves the same shared promise for callers without a signal', async () => {
    const first = ads.preloadRewardedAd();
    const second = ads.preloadRewardedAd();
    expect(second).toBe(first);
    loaded();
    await first;

    expect(loadFullScreenAd).toHaveBeenCalledOnce();
    expect(showFullScreenAd).not.toHaveBeenCalled();
  });
});
