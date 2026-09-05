import { RewardedAdController, type RewardedAdBridge } from './rewardedAd';

function bridge() {
  let loadEvent: ((event: { type: string }) => void) | undefined;
  let showEvent: ((event: { type: string }) => void) | undefined;
  const loadCleanup = vi.fn();
  const showCleanup = vi.fn();
  const value: RewardedAdBridge = {
    isSupported: () => true,
    load: ({ onEvent }) => { loadEvent = onEvent; return loadCleanup; },
    show: ({ onEvent }) => { showEvent = onEvent; return showCleanup; },
  };
  return { value, loadCleanup, showCleanup, loaded: () => loadEvent?.({ type: 'loaded' }), event: (type: string) => showEvent?.({ type }) };
}

describe('rewarded ad controller', () => {
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
});
