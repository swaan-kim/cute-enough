import { REWARDED_TEST_AD_GROUP_ID, RewardedAdController, type RewardedAdBridge, type RewardedAdOptions } from './rewardedAd';
import { trackProductEvent } from './analytics';

vi.mock('./analytics', () => ({ trackProductEvent: vi.fn() }));

function bridge() {
  let loadEvent: ((event: { type: string }) => void) | undefined;
  let showEvent: ((event: { type: string }) => void) | undefined;
  let loadError: ((error: unknown) => void) | undefined;
  let showError: ((error: unknown) => void) | undefined;
  const loads: Array<{ onEvent: (event: { type: string }) => void; onError: (error: unknown) => void }> = [];
  const shows: Array<{ onEvent: (event: { type: string }) => void; onError: (error: unknown) => void }> = [];
  const loadCleanup = vi.fn();
  const showCleanup = vi.fn();
  const value: RewardedAdBridge = {
    isSupported: () => true,
    load: (args) => { loads.push(args); loadEvent = args.onEvent; loadError = args.onError; return loadCleanup; },
    show: (args) => { shows.push(args); showEvent = args.onEvent; showError = args.onError; return showCleanup; },
  };
  return {
    value, loadCleanup, showCleanup, loads, shows,
    loaded: () => loadEvent?.({ type: 'loaded' }), event: (type: string) => showEvent?.({ type }),
    loadError: (error: unknown) => loadError?.(error), showError: (error: unknown) => showError?.(error),
  };
}

describe('rewarded ad controller', () => {
  it('loads the exact official rewarded test ID only with explicit private test mode', async () => {
    const testBridge = bridge();
    const load = vi.spyOn(testBridge.value, 'load');
    const controller = new RewardedAdController(true, REWARDED_TEST_AD_GROUP_ID, testBridge.value, { runtime: 'private', testMode: true });
    const loading = controller.preload();
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ adGroupId: 'ait-ad-test-rewarded-id' }));
    testBridge.loaded();
    await loading;
    expect(controller.getStatus()).toBe('loaded');
    controller.dispose();
  });

  it.each<{ id: string; options?: RewardedAdOptions }>([
    { id: REWARDED_TEST_AD_GROUP_ID },
    { id: REWARDED_TEST_AD_GROUP_ID, options: { runtime: 'private' } },
    { id: REWARDED_TEST_AD_GROUP_ID, options: { runtime: 'private', testMode: false } },
    { id: REWARDED_TEST_AD_GROUP_ID, options: { testMode: true } },
    { id: REWARDED_TEST_AD_GROUP_ID, options: { runtime: 'preview', testMode: true } },
    { id: REWARDED_TEST_AD_GROUP_ID, options: { runtime: 'production', testMode: true } },
    { id: REWARDED_TEST_AD_GROUP_ID, options: { runtime: 'production', testMode: false } },
    { id: 'live-group', options: { runtime: 'production', testMode: true } },
    { id: 'live-group', options: { runtime: 'private', testMode: true } },
    { id: '', options: { runtime: 'private', testMode: true } },
    { id: ' ', options: { runtime: 'private', testMode: false } },
    { id: 'ait-ad-test-interstitial-id', options: { runtime: 'private', testMode: true } },
    { id: 'ait-ad-test-rewarded-id-extra', options: { runtime: 'private', testMode: true } },
    { id: 'AIT-AD-TEST-REWARDED-ID', options: { runtime: 'private', testMode: true } },
    { id: 'ait-ad-test-rewarded-id ', options: { runtime: 'private', testMode: true } },
  ])('rejects unsafe ad configuration $id with $options before reaching the SDK', async ({ id, options }) => {
    const testBridge = bridge();
    const load = vi.spyOn(testBridge.value, 'load');
    const show = vi.spyOn(testBridge.value, 'show');
    const controller = new RewardedAdController(true, id, testBridge.value, options);
    await expect(controller.show()).rejects.toThrow('사용할 수 없어요');
    expect(controller.getStatus()).toBe('error');
    expect(load).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it.each(['private', 'production'] as const)('keeps real ad groups available in %s with test mode off', async (runtime) => {
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value, { runtime, testMode: false });
    const loading = controller.preload();
    testBridge.loaded();
    await loading;
    expect(controller.getStatus()).toBe('loaded');
    controller.dispose();
  });

  it('does not turn on disabled ads through private test mode', async () => {
    const testBridge = bridge();
    const load = vi.spyOn(testBridge.value, 'load');
    const controller = new RewardedAdController(false, REWARDED_TEST_AD_GROUP_ID, testBridge.value, { runtime: 'private', testMode: true });
    await expect(controller.show()).rejects.toThrow('사용할 수 없어요');
    expect(controller.getStatus()).toBe('disabled');
    expect(load).not.toHaveBeenCalled();
  });

  it('never simulates a reward when ads are disabled', async () => {
    const testBridge = bridge();
    const controller = new RewardedAdController(false, 'live-group', testBridge.value);
    await expect(controller.show()).rejects.toThrow('사용할 수 없어요');
    expect(controller.getStatus()).toBe('disabled');
  });

  it('loads once and cleans up the load callback', async () => {
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    const first = controller.preload();
    const second = controller.preload();
    expect(first).toBe(second);
    testBridge.loaded();
    await first;
    expect(controller.getStatus()).toBe('loaded');
    expect(testBridge.loadCleanup).toHaveBeenCalledOnce();
  });

  it('keeps waiting after 12 seconds and accepts an ad loaded at 20 seconds', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload();
      await vi.advanceTimersByTimeAsync(12_001);
      expect(controller.getStatus()).toBe('loading');
      expect(testBridge.loadCleanup).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(7_999);
      testBridge.loaded();
      await expect(loading).resolves.toBeUndefined();
      expect(controller.getStatus()).toBe('loaded');
      expect(testBridge.loadCleanup).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(50_000);
      expect(controller.getStatus()).toBe('loaded');
      expect(testBridge.loadCleanup).toHaveBeenCalledOnce();
    } finally {
      controller.dispose();
      vi.useRealTimers();
    }
  });

  it('fails a load after 65 seconds and cleans up exactly once despite a late loaded event', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload();
      const rejection = expect(loading).rejects.toThrow('광고 준비가 늦어지고 있어요. 다시 시도해 주세요.');
      await vi.advanceTimersByTimeAsync(64_999);
      expect(controller.getStatus()).toBe('loading');
      expect(testBridge.loadCleanup).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      await rejection;
      expect(controller.getStatus()).toBe('error');
      expect(testBridge.loadCleanup).toHaveBeenCalledOnce();
      testBridge.loaded();
      await vi.advanceTimersByTimeAsync(65_000);
      expect(controller.getStatus()).toBe('error');
      expect(testBridge.loadCleanup).toHaveBeenCalledOnce();
    } finally {
      controller.dispose();
      vi.useRealTimers();
    }
  });

  it('rewards only after earned and dismissed events both arrive', async () => {
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    const loading = controller.preload(); testBridge.loaded(); await loading;
    const showing = controller.show();
    await Promise.resolve();
    testBridge.event('userEarnedReward');
    testBridge.event('dismissed');
    await expect(showing).resolves.toBeUndefined();
    expect(testBridge.showCleanup).toHaveBeenCalledOnce();
  });

  it('does not reward a skipped ad', async () => {
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    const loading = controller.preload(); testBridge.loaded(); await loading;
    const showing = controller.show();
    await Promise.resolve();
    testBridge.event('dismissed');
    await expect(showing).rejects.toThrow('완료해야');
  });

  it('persists earned reward before dismissal and preserves it after a late SDK failure', async () => {
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    const loading = controller.preload(); testBridge.loaded(); await loading;
    const onEarned = vi.fn();
    const showing = controller.show(undefined, onEarned);
    await Promise.resolve();
    testBridge.event('userEarnedReward');
    expect(onEarned).toHaveBeenCalledOnce();
    testBridge.event('userEarnedReward');
    expect(onEarned).toHaveBeenCalledOnce();
    testBridge.event('failedToShow');
    await expect(showing).resolves.toBeUndefined();
  });

  it('aborts and unregisters when the screen exits', async () => {
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    const loading = controller.preload(); testBridge.loaded(); await loading;
    const abort = new AbortController();
    const showing = controller.show(abort.signal);
    await Promise.resolve();
    abort.abort();
    await expect(showing).rejects.toMatchObject({ name: 'AbortError' });
    expect(testBridge.showCleanup).toHaveBeenCalledOnce();
  });

  it('surfaces a persistence failure without treating it as a successful saved reward', async () => {
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    const loading = controller.preload(); testBridge.loaded(); await loading;
    const showing = controller.show(undefined, () => { throw new Error('보상 기록 저장 실패'); });
    await Promise.resolve();
    testBridge.event('userEarnedReward');
    await expect(showing).rejects.toThrow('보상 기록 저장 실패');
    expect(testBridge.showCleanup).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('holds a silent display request for explicit return confirmation after 15 seconds', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload(); testBridge.loaded(); await loading;
      const onEarned = vi.fn();
      const showing = controller.show(undefined, onEarned);
      const settled = vi.fn();
      void showing.then(settled, settled);
      await Promise.resolve();
      testBridge.event('requested');
      await vi.advanceTimersByTimeAsync(14_999);
      expect(controller.getStatus()).toBe('showing');
      expect(controller.confirmReturn()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(controller.getStatus()).toBe('awaiting-confirmation');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).not.toHaveBeenCalled();
      expect(onEarned).not.toHaveBeenCalled();
      expect(testBridge.loads).toHaveLength(1);
      expect(testBridge.shows).toHaveLength(1);
      expect(testBridge.showCleanup).not.toHaveBeenCalled();
      expect(controller.confirmReturn()).toBe(true);
      await expect(showing).rejects.toThrow('시청 완료를 확인하지 못했어요');
      expect(testBridge.showCleanup).toHaveBeenCalledOnce();
      expect(controller.confirmReturn()).toBe(false);
      expect(testBridge.loads).toHaveLength(2);
      expect(testBridge.shows).toHaveLength(1);
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it.each(['show', 'impression'])('does not time out a long ad after the actual %s event', async (event) => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload(); testBridge.loaded(); await loading;
      const showing = controller.show();
      await Promise.resolve();
      testBridge.event(event);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(controller.getStatus()).toBe('showing');
      expect(controller.confirmReturn()).toBe(false);
      expect(testBridge.loads).toHaveLength(1);
      testBridge.event('userEarnedReward');
      testBridge.event('dismissed');
      await expect(showing).resolves.toBeUndefined();
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it('withdraws return confirmation when the native ad appears after the watchdog', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload(); testBridge.loaded(); await loading;
      const showing = controller.show();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(controller.getStatus()).toBe('awaiting-confirmation');
      testBridge.event('show');
      expect(controller.getStatus()).toBe('showing');
      expect(controller.confirmReturn()).toBe(false);
      testBridge.event('dismissed');
      await expect(showing).rejects.toThrow('완료해야');
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it('persists a reward once and waits for an explicit return when dismissed is missing', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload(); testBridge.loaded(); await loading;
      const onEarned = vi.fn();
      const showing = controller.show(undefined, onEarned);
      const settled = vi.fn();
      void showing.then(settled, settled);
      await Promise.resolve();
      testBridge.event('userEarnedReward');
      expect(onEarned).toHaveBeenCalledOnce();
      expect(controller.getStatus()).toBe('reward-earned');
      testBridge.event('impression');
      testBridge.event('userEarnedReward');
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(controller.getStatus()).toBe('reward-earned');
      expect(settled).not.toHaveBeenCalled();
      expect(controller.confirmReturn()).toBe(true);
      await expect(showing).resolves.toBeUndefined();
      testBridge.event('userEarnedReward');
      testBridge.showError(new Error('late failure'));
      expect(onEarned).toHaveBeenCalledOnce();
      expect(testBridge.showCleanup).toHaveBeenCalledOnce();
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it('keeps late earned rewards after the watchdog until the user confirms returning', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload(); testBridge.loaded(); await loading;
      const onEarned = vi.fn();
      const showing = controller.show(undefined, onEarned);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(controller.getStatus()).toBe('awaiting-confirmation');
      testBridge.event('userEarnedReward');
      expect(controller.getStatus()).toBe('reward-earned');
      expect(onEarned).toHaveBeenCalledOnce();
      expect(controller.confirmReturn()).toBe(true);
      await expect(showing).resolves.toBeUndefined();
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it('rejects duplicate show and preload calls while an ad result is pending', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const showing = controller.show();
      await expect(controller.show()).rejects.toThrow('진행 중인 광고');
      expect(testBridge.loads).toHaveLength(1);
      testBridge.loaded();
      await Promise.resolve();
      await expect(controller.show()).rejects.toThrow('진행 중인 광고');
      await expect(controller.preload()).rejects.toThrow('진행 중인 광고');
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(controller.show()).rejects.toThrow('진행 중인 광고');
      await expect(controller.preload()).rejects.toThrow('진행 중인 광고');
      testBridge.event('userEarnedReward');
      await expect(controller.show()).rejects.toThrow('진행 중인 광고');
      await expect(controller.preload()).rejects.toThrow('진행 중인 광고');
      expect(testBridge.loads).toHaveLength(1);
      expect(testBridge.shows).toHaveLength(1);
      controller.confirmReturn();
      await showing;
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it('treats support exceptions as retryable and an explicit false as unsupported', async () => {
    const testBridge = bridge();
    const support = vi.spyOn(testBridge.value, 'isSupported').mockImplementationOnce(() => { throw new TypeError('bridge not injected'); });
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    await expect(controller.preload()).rejects.toThrow('사용할 수 없어요');
    expect(controller.getStatus()).toBe('error');
    support.mockReturnValueOnce(false);
    await expect(controller.preload()).rejects.toThrow('사용할 수 없어요');
    expect(controller.getStatus()).toBe('unsupported');
    support.mockReturnValue(true);
    const loading = controller.preload(); testBridge.loaded(); await loading;
    expect(controller.getStatus()).toBe('loaded');
    controller.dispose();
  });

  it('surfaces callback errors while emitting only allowlisted diagnostic fields', async () => {
    vi.mocked(trackProductEvent).mockClear();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'private-ad-group-123', testBridge.value, { runtime: 'private' });
    const loading = controller.preload();
    const rejection = expect(loading).rejects.toThrow('private-user-123');
    testBridge.loadError({ code: 'NO_FILL', message: 'private-user-123' });
    await rejection;
    expect(controller.getStatus()).toBe('error');
    expect(trackProductEvent).toHaveBeenCalledWith('rewarded_ad_diagnostic', expect.objectContaining({
      phase: 'load', result: 'failed', error_code: 'NO_FILL', runtime: 'private',
    }));
    const retry = controller.preload(); testBridge.loaded(); await retry;
    const showing = controller.show();
    await Promise.resolve();
    testBridge.showError({ code: 'private-user-123', message: 'private-source-detail' });
    await expect(showing).rejects.toThrow('private-source-detail');
    const diagnostics = JSON.stringify(vi.mocked(trackProductEvent).mock.calls);
    expect(diagnostics).not.toContain('private-user-123');
    expect(diagnostics).not.toContain('private-ad-group-123');
    expect(diagnostics).not.toContain('private-source-detail');
    expect(diagnostics).toContain('unclassified');
    controller.dispose();
  });

  it('reloads an unused ad after 45 minutes before attempting to show it', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload(); testBridge.loaded(); await loading;
      await vi.advanceTimersByTimeAsync(45 * 60_000 - 1);
      await controller.preload();
      expect(testBridge.loads).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      const showing = controller.show();
      expect(controller.getStatus()).toBe('loading');
      expect(testBridge.loads).toHaveLength(2);
      expect(testBridge.shows).toHaveLength(0);
      testBridge.loaded(); await Promise.resolve();
      expect(testBridge.shows).toHaveLength(1);
      testBridge.event('userEarnedReward'); testBridge.event('dismissed');
      await showing;
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it('cancels a pending load on dispose without letting old timers or callbacks affect the next load', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload();
      const cancelled = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
      controller.dispose();
      await cancelled;
      expect(vi.getTimerCount()).toBe(0);
      expect(controller.getStatus()).toBe('idle');
      const next = controller.preload();
      testBridge.loads[0].onEvent({ type: 'loaded' });
      testBridge.loads[0].onError(new Error('late failure'));
      expect(controller.getStatus()).toBe('loading');
      testBridge.loaded(); await next;
      await vi.advanceTimersByTimeAsync(65_000);
      expect(controller.getStatus()).toBe('loaded');
      expect(testBridge.loadCleanup).toHaveBeenCalledTimes(2);
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it('aborts a show immediately while preload is pending and never opens that abandoned request', async () => {
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    const abort = new AbortController();
    const showing = controller.show(abort.signal);
    abort.abort();
    await expect(showing).rejects.toMatchObject({ name: 'AbortError' });
    testBridge.loaded();
    await Promise.resolve();
    expect(testBridge.shows).toHaveLength(0);
    expect(controller.getStatus()).toBe('loaded');
    controller.dispose();
  });

  it('cleans up dispose during showing without starting a new preload or accepting late rewards', async () => {
    vi.useFakeTimers();
    const testBridge = bridge();
    const controller = new RewardedAdController(true, 'live-group', testBridge.value);
    try {
      const loading = controller.preload(); testBridge.loaded(); await loading;
      const onEarned = vi.fn();
      const showing = controller.show(undefined, onEarned);
      await Promise.resolve();
      const cancelled = expect(showing).rejects.toMatchObject({ name: 'AbortError' });
      controller.dispose();
      await cancelled;
      testBridge.event('userEarnedReward');
      testBridge.event('dismissed');
      await vi.advanceTimersByTimeAsync(65_000);
      expect(vi.getTimerCount()).toBe(0);
      expect(controller.getStatus()).toBe('idle');
      expect(onEarned).not.toHaveBeenCalled();
      expect(testBridge.loads).toHaveLength(1);
      expect(testBridge.showCleanup).toHaveBeenCalledOnce();
    } finally { controller.dispose(); vi.useRealTimers(); }
  });

  it('handles synchronous bridge callbacks and cleanup without retaining finished operations', async () => {
    const loadCleanup = vi.fn();
    const showCleanup = vi.fn();
    const value: RewardedAdBridge = {
      isSupported: () => true,
      load: ({ onEvent }) => { onEvent({ type: 'loaded' }); return loadCleanup; },
      show: ({ onEvent }) => { onEvent({ type: 'userEarnedReward' }); onEvent({ type: 'dismissed' }); return showCleanup; },
    };
    const controller = new RewardedAdController(true, 'live-group', value);
    await expect(controller.show()).resolves.toBeUndefined();
    expect(controller.getStatus()).toBe('loaded');
    await expect(controller.show()).resolves.toBeUndefined();
    expect(loadCleanup).toHaveBeenCalledTimes(3);
    expect(showCleanup).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});
