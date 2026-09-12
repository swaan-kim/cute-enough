import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import { trackProductEvent } from './analytics';
import { rewardedAdsEnabled, runtimeEnvironment, type AppRuntimeEnvironment } from './runtime';

export type RewardedAdStatus = 'disabled' | 'unsupported' | 'idle' | 'loading' | 'loaded' | 'showing'
  | 'awaiting-confirmation' | 'reward-earned' | 'error';
export const REWARDED_TEST_AD_GROUP_ID = 'ait-ad-test-rewarded-id';
// Allow the native ad network's documented load window of up to 60 seconds.
const REWARDED_AD_LOAD_TIMEOUT_MS = 65_000;
const REWARDED_AD_SHOW_START_TIMEOUT_MS = 15_000;
const REWARDED_AD_FRESHNESS_MS = 45 * 60_000;

export interface RewardedAdOptions {
  runtime?: AppRuntimeEnvironment;
  testMode?: boolean;
}

type AdEvent = { type: string };
type Cleanup = () => void;

export interface RewardedAdBridge {
  isSupported: () => boolean;
  load: (args: { adGroupId: string; onEvent: (event: AdEvent) => void; onError: (error: unknown) => void }) => Cleanup;
  show: (args: { adGroupId: string; onEvent: (event: AdEvent) => void; onError: (error: unknown) => void }) => Cleanup;
}

const nativeBridge: RewardedAdBridge = {
  isSupported: () => loadFullScreenAd.isSupported() && showFullScreenAd.isSupported(),
  load: ({ adGroupId, onEvent, onError }) => loadFullScreenAd({ options: { adGroupId }, onEvent, onError }),
  show: ({ adGroupId, onEvent, onError }) => showFullScreenAd({ options: { adGroupId }, onEvent, onError }),
};

function friendlyError(error: unknown, fallback: string): Error {
  if ((error instanceof Error || error instanceof DOMException) && error.message) return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message) {
    return new Error(error.message);
  }
  return new Error(fallback);
}

const abortError = () => new DOMException('광고 요청이 취소됐어요.', 'AbortError');

function diagnostic(phase: string, result: string, runtime: AppRuntimeEnvironment | undefined, startedAt?: number, error?: unknown) {
  // SDK messages may contain URLs or request identifiers. Only known error codes leave the device.
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const safeCodes = ['NO_FILL', 'NETWORK_ERROR', 'INVALID_REQUEST', 'INTERNAL_ERROR', 'EXECUTION_ERROR', 'UNSUPPORTED_APP_VERSION'];
  trackProductEvent('rewarded_ad_diagnostic', {
    phase, result, runtime: runtime ?? runtimeEnvironment,
    duration_ms: startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt),
    error_code: error === undefined ? undefined : typeof code === 'string' && safeCodes.includes(code) ? code : 'unclassified',
  });
}

export class RewardedAdController {
  private status: RewardedAdStatus;
  private listeners = new Set<(status: RewardedAdStatus) => void>();
  private activeLoad?: { promise: Promise<void>; cancel: Cleanup };
  private activeShow?: { cancel: Cleanup; confirm: () => boolean };
  private loadedAt?: number;
  private generation = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly adGroupId: string,
    private readonly bridge: RewardedAdBridge = nativeBridge,
    private readonly options: RewardedAdOptions = {},
  ) {
    this.status = enabled ? 'idle' : 'disabled';
  }

  getStatus() { return this.status; }

  subscribe(listener: (status: RewardedAdStatus) => void): Cleanup {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: RewardedAdStatus) {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }

  private cleanup(callback?: Cleanup) {
    try { callback?.(); } catch (error) { diagnostic('cleanup', 'failed', this.options.runtime, undefined, error); }
  }

  private supportReady(): boolean {
    if (!this.enabled) { this.setStatus('disabled'); return false; }
    const privateTest = this.options.runtime === 'private' && this.options.testMode === true
      && this.adGroupId === REWARDED_TEST_AD_GROUP_ID;
    if (!this.adGroupId.trim() || (this.options.testMode === true && !privateTest)
      || (/test/i.test(this.adGroupId) && !privateTest)) {
      diagnostic('support', 'invalid_configuration', this.options.runtime);
      this.setStatus('error'); return false;
    }
    try {
      const supported = this.bridge.isSupported();
      diagnostic('support', supported === true ? 'supported' : supported === false ? 'unsupported' : 'unknown', this.options.runtime);
      if (supported === true) return true;
      this.setStatus(supported === false ? 'unsupported' : 'error');
    } catch (error) {
      diagnostic('support', 'failed', this.options.runtime, undefined, error);
      this.setStatus('error');
    }
    return false;
  }

  preload(): Promise<void> {
    if (this.activeShow) return Promise.reject(new Error('진행 중인 광고의 결과를 먼저 확인해 주세요.'));
    return this.prepare();
  }

  private prepare(): Promise<void> {
    if (this.activeLoad) return this.activeLoad.promise;
    if (!this.supportReady()) return Promise.reject(new Error('현재 광고를 사용할 수 없어요. 잠시 뒤 다시 시도해 주세요.'));
    if (this.status === 'loaded' && this.loadedAt !== undefined && Date.now() - this.loadedAt < REWARDED_AD_FRESHNESS_MS) {
      return Promise.resolve();
    }
    if (this.status === 'loaded') diagnostic('load', 'expired', this.options.runtime, this.loadedAt);
    this.loadedAt = undefined;
    const generation = this.generation;
    const startedAt = Date.now();
    let settled = false;
    let cleanup: Cleanup | undefined;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const operation = { promise, cancel: () => finish('cancelled', abortError()) };
    const timeout = window.setTimeout(() => finish('timeout', new Error('광고 준비가 늦어지고 있어요. 다시 시도해 주세요.')), REWARDED_AD_LOAD_TIMEOUT_MS);
    const finish = (result: 'loaded' | 'failed' | 'timeout' | 'cancelled', error?: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      this.cleanup(cleanup);
      cleanup = undefined;
      if (this.activeLoad === operation) this.activeLoad = undefined;
      diagnostic('load', result, this.options.runtime, startedAt, error);
      if (generation === this.generation) {
        this.loadedAt = result === 'loaded' ? Date.now() : undefined;
        this.setStatus(result === 'loaded' ? 'loaded' : result === 'cancelled' ? 'idle' : 'error');
      }
      if (result === 'loaded') resolve();
      else reject(friendlyError(error, '광고를 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
    };
    this.activeLoad = operation;
    this.setStatus('loading');
    diagnostic('load', 'started', this.options.runtime);
    try {
      if (!settled) {
        cleanup = this.bridge.load({
          adGroupId: this.adGroupId,
          onEvent: (event) => { if (event.type === 'loaded') finish('loaded'); },
          onError: (error) => finish('failed', error),
        });
        if (settled) { this.cleanup(cleanup); cleanup = undefined; }
      }
    } catch (error) { finish('failed', error); }
    return promise;
  }

  show(signal?: AbortSignal, onEarnedReward?: () => void): Promise<void> {
    if (this.activeShow) return Promise.reject(new Error('진행 중인 광고의 결과를 먼저 확인해 주세요.'));
    if (signal?.aborted) return Promise.reject(abortError());
    const generation = this.generation;
    const startedAt = Date.now();
    let rewarded = false;
    let settled = false;
    let nativeStarted = false;
    let cleanup: Cleanup | undefined;
    let showTimeout: number | undefined;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const finish = (result: 'dismissed' | 'failed' | 'aborted' | 'confirmed_return', error?: unknown, persistenceFailed = false) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(showTimeout);
      signal?.removeEventListener('abort', abort);
      this.cleanup(cleanup);
      cleanup = undefined;
      if (this.activeShow === operation) this.activeShow = undefined;
      if (nativeStarted && generation === this.generation) this.setStatus('idle');
      diagnostic('show', persistenceFailed ? 'persistence_failed' : result, this.options.runtime, startedAt, error);
      // A late bridge error cannot take back an already earned reward.
      if (persistenceFailed) reject(friendlyError(error, '보상 기록을 저장하지 못했어요. 앱을 닫지 말고 다시 시도해 주세요.'));
      else if (rewarded) resolve();
      else if (result === 'aborted') reject(abortError());
      else if (result === 'dismissed') reject(new Error('광고 시청을 완료해야 이 친구를 만날 수 있어요.'));
      else if (result === 'confirmed_return') reject(new Error('광고 시청 완료를 확인하지 못했어요. 다시 준비해 주세요.'));
      else reject(friendlyError(error, '광고를 보여드리지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
    };
    const abort = () => finish('aborted');
    const operation = {
      cancel: abort,
      confirm: () => {
        if (settled || (this.status !== 'awaiting-confirmation' && this.status !== 'reward-earned')) return false;
        finish('confirmed_return');
        return true;
      },
    };
    this.activeShow = operation;
    signal?.addEventListener('abort', abort, { once: true });
    void this.prepare().then(() => {
      if (settled || generation !== this.generation) return;
      nativeStarted = true;
      this.loadedAt = undefined;
      this.setStatus('showing');
      showTimeout = window.setTimeout(() => {
        if (settled || rewarded) return;
        diagnostic('show', 'start_timeout', this.options.runtime, startedAt);
        // The bridge may still show a late ad. Only an explicit app interaction
        // can confirm that the user has returned and release this operation.
        this.setStatus('awaiting-confirmation');
      }, REWARDED_AD_SHOW_START_TIMEOUT_MS);
      diagnostic('show', 'started', this.options.runtime);
      try {
        cleanup = this.bridge.show({
          adGroupId: this.adGroupId,
          onEvent: (event) => {
            if (settled) return;
            if (event.type === 'requested') diagnostic('show', 'requested', this.options.runtime, startedAt);
            else if (event.type === 'show' || event.type === 'impression') {
              window.clearTimeout(showTimeout);
              diagnostic('show', event.type, this.options.runtime, startedAt);
              if (!rewarded) this.setStatus('showing');
            } else if (event.type === 'userEarnedReward' && !rewarded) {
              rewarded = true;
              window.clearTimeout(showTimeout);
              try { onEarnedReward?.(); } catch (error) { finish('failed', error, true); }
              if (!settled) {
                diagnostic('show', 'reward_earned', this.options.runtime, startedAt);
                this.setStatus('reward-earned');
              }
            } else if (event.type === 'dismissed') finish('dismissed');
            else if (event.type === 'failedToShow') finish('failed');
          },
          onError: (error) => finish('failed', error),
        });
        if (settled) { this.cleanup(cleanup); cleanup = undefined; }
      } catch (error) { finish('failed', error); }
    }, (error) => finish('failed', error));
    return promise.finally(() => {
      if (nativeStarted && this.enabled && generation === this.generation && !this.activeShow) {
        void this.preload().catch(() => undefined);
      }
    });
  }

  /** Call only from a user interaction in the app, never from a timer/visibility event. */
  confirmReturn(): boolean { return this.activeShow?.confirm() ?? false; }

  dispose() {
    this.generation++;
    this.activeLoad?.cancel();
    this.activeShow?.cancel();
    this.activeLoad = undefined;
    this.activeShow = undefined;
    this.loadedAt = undefined;
    this.listeners.clear();
    this.status = this.enabled ? 'idle' : 'disabled';
  }
}

const rewardedAd = new RewardedAdController(
  rewardedAdsEnabled,
  import.meta.env.VITE_REWARDED_AD_GROUP_ID ?? '',
  undefined,
  { runtime: runtimeEnvironment, testMode: import.meta.env.VITE_ADS_TEST_MODE === 'true' },
);

export const getRewardedAdStatus = () => rewardedAd.getStatus();
export const subscribeRewardedAdStatus = (listener: (status: RewardedAdStatus) => void) => rewardedAd.subscribe(listener);
export const preloadRewardedAd = () => rewardedAd.preload();
export const showRewardedAd = (signal?: AbortSignal, onEarnedReward?: () => void) => rewardedAd.show(signal, onEarnedReward);
export const confirmRewardedAdReturn = () => rewardedAd.confirmReturn();
export const disposeRewardedAd = () => rewardedAd.dispose();
