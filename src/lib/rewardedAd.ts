import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import { rewardedAdsEnabled } from './runtime';

export type RewardedAdStatus = 'disabled' | 'unsupported' | 'idle' | 'loading' | 'loaded' | 'showing' | 'error';

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
  if (error instanceof Error && error.message) return error;
  return new Error(fallback);
}

export class RewardedAdController {
  private status: RewardedAdStatus;
  private listeners = new Set<(status: RewardedAdStatus) => void>();
  private loadPromise?: Promise<void>;
  private loadCleanup?: Cleanup;
  private showCleanup?: Cleanup;
  private cancelActiveShow?: () => void;

  constructor(
    private readonly enabled: boolean,
    private readonly adGroupId: string,
    private readonly bridge: RewardedAdBridge = nativeBridge,
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

  private supportReady(): boolean {
    if (!this.enabled) { this.setStatus('disabled'); return false; }
    if (!this.adGroupId || /test/i.test(this.adGroupId)) { this.setStatus('error'); return false; }
    try {
      if (this.bridge.isSupported()) return true;
    } catch { /* handled as unsupported below */ }
    this.setStatus('unsupported');
    return false;
  }

  preload(): Promise<void> {
    if (!this.supportReady()) return Promise.reject(new Error('현재 광고를 사용할 수 없어요. 잠시 뒤 다시 시도해 주세요.'));
    if (this.status === 'loaded') return Promise.resolve();
    if (this.status === 'loading' && this.loadPromise) return this.loadPromise;

    this.setStatus('loading');
    this.loadPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish('error', new Error('광고 준비가 늦어지고 있어요. 다시 시도해 주세요.')), 12_000);
      const finish = (next: 'loaded' | 'error', error?: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.loadCleanup?.();
        this.loadCleanup = undefined;
        this.loadPromise = undefined;
        this.setStatus(next);
        if (next === 'loaded') resolve();
        else reject(friendlyError(error, '광고를 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
      };
      try {
        this.loadCleanup = this.bridge.load({
          adGroupId: this.adGroupId,
          onEvent: (event) => { if (event.type === 'loaded') finish('loaded'); },
          onError: (error) => finish('error', error),
        });
      } catch (error) {
        finish('error', error);
      }
    });
    return this.loadPromise;
  }

  async show(signal?: AbortSignal): Promise<void> {
    await this.preload();
    if (signal?.aborted) throw new DOMException('광고 요청이 취소됐어요.', 'AbortError');
    this.setStatus('showing');

    return new Promise<void>((resolve, reject) => {
      let rewarded = false;
      let settled = false;
      const finish = (result: 'dismissed' | 'failed' | 'aborted', error?: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        this.showCleanup?.();
        this.showCleanup = undefined;
        this.cancelActiveShow = undefined;
        this.setStatus('idle');
        if (result === 'dismissed' && rewarded) resolve();
        else if (result === 'aborted') reject(new DOMException('광고 요청이 취소됐어요.', 'AbortError'));
        else if (result === 'dismissed') reject(new Error('광고 시청을 완료해야 이 친구를 만날 수 있어요.'));
        else reject(friendlyError(error, '광고를 보여드리지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
      };
      const abort = () => finish('aborted');
      this.cancelActiveShow = abort;
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.showCleanup = this.bridge.show({
          adGroupId: this.adGroupId,
          onEvent: (event) => {
            if (event.type === 'userEarnedReward') rewarded = true;
            else if (event.type === 'dismissed') finish('dismissed');
            else if (event.type === 'failedToShow') finish('failed');
          },
          onError: (error) => finish('failed', error),
        });
      } catch (error) {
        finish('failed', error);
      }
    }).finally(() => {
      if (this.enabled) void this.preload().catch(() => undefined);
    });
  }

  dispose() {
    this.loadCleanup?.();
    this.loadCleanup = undefined;
    this.loadPromise = undefined;
    this.cancelActiveShow?.();
    this.cancelActiveShow = undefined;
    this.showCleanup?.();
    this.showCleanup = undefined;
    this.listeners.clear();
    this.status = this.enabled ? 'idle' : 'disabled';
  }
}

const rewardedAd = new RewardedAdController(
  rewardedAdsEnabled,
  import.meta.env.VITE_REWARDED_AD_GROUP_ID ?? '',
);

export const getRewardedAdStatus = () => rewardedAd.getStatus();
export const subscribeRewardedAdStatus = (listener: (status: RewardedAdStatus) => void) => rewardedAd.subscribe(listener);
export const preloadRewardedAd = () => rewardedAd.preload();
export const showRewardedAd = (signal?: AbortSignal) => rewardedAd.show(signal);
export const disposeRewardedAd = () => rewardedAd.dispose();
