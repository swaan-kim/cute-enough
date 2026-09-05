import { Promotion } from '@apps-in-toss/web-framework';
import type { ShareCloseSummary } from '../types';

export const SHARE_REWARD_MODULE_ID = 'e5de3e72-cbfb-4b50-a050-9fd71fb4368b';

type ShareEvent =
  | { type: 'sendViral'; data: { rewardAmount: number; rewardUnit: string } }
  | { type: 'close'; data: ShareCloseSummary };

export interface ShareRewardBridge {
  isSupported(): boolean;
  open(args: {
    moduleId: string;
    onEvent(event: ShareEvent): void;
    onError(error: unknown): void;
  }): () => void;
}

const nativeBridge: ShareRewardBridge = {
  isSupported: () => Promotion.openContactsInvite.isSupported(),
  open: ({ moduleId, onEvent, onError }) => Promotion.openContactsInvite({
    options: { moduleId }, onEvent, onError,
  }),
};

export function supportsShareReward(bridge: ShareRewardBridge = nativeBridge): boolean {
  try { return bridge.isSupported(); } catch { return false; }
}

/** Each callback is persisted by the caller before returning to the bridge. */
export function openShareReward(
  callbacks: {
    onReward(rewardAmount: number, eventSequence: number, rewardUnit: string): void;
    onClose(summary: ShareCloseSummary): void;
  },
  bridge: ShareRewardBridge = nativeBridge,
  signal?: AbortSignal,
): Promise<void> {
  if (!supportsShareReward(bridge)) return Promise.reject(new Error('토스 앱을 업데이트한 뒤 친구를 초대해 주세요.'));
  if (signal?.aborted) return Promise.reject(new DOMException('친구 초대를 닫았어요.', 'AbortError'));
  return new Promise((resolve, reject) => {
    let settled = false;
    let cleanup: (() => void) | undefined;
    let sequence = 0;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      cleanup?.();
      if (error) reject(error instanceof Error ? error : new Error('친구 초대를 열지 못했어요. 다시 시도해 주세요.'));
      else resolve();
    };
    const abort = () => finish(new DOMException('친구 초대를 닫았어요.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      cleanup = bridge.open({
        moduleId: SHARE_REWARD_MODULE_ID,
        onEvent(event) {
          if (settled) return;
          try {
            if (event.type === 'sendViral') {
              const { rewardAmount, rewardUnit } = event.data;
              if (!Number.isSafeInteger(rewardAmount) || rewardAmount <= 0 || rewardUnit !== '강아지 티켓') {
                throw new Error('공유 보상 설정을 확인하고 있어요. 잠시 뒤 다시 시도해 주세요.');
              }
              callbacks.onReward(rewardAmount, ++sequence, rewardUnit);
            } else {
              callbacks.onClose(event.data);
              finish();
            }
          } catch (error) { finish(error); }
        },
        onError: finish,
      });
      if (settled) cleanup();
    } catch (error) { finish(error); }
  });
}
