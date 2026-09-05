import { requestNotificationAgreement } from '@apps-in-toss/web-framework';

export type RechargeNotificationAgreement = 'granted' | 'denied' | 'unsupported';
export interface NotificationAgreementBridge {
  isSupported(): boolean;
  request(input: {
    options: { templateCode: string };
    onEvent(event: { type: string }): void;
    onError(error: unknown): void;
  }): () => void;
}

const nativeBridge: NotificationAgreementBridge = {
  isSupported: () => requestNotificationAgreement.isSupported(),
  request: (input) => requestNotificationAgreement(input),
};

/** Called only from the user's explicit enable action; never on app startup. */
export function requestRechargeNotificationAgreement(
  templateCode: string,
  signal?: AbortSignal,
  bridge: NotificationAgreementBridge = nativeBridge,
): Promise<RechargeNotificationAgreement> {
  if (!templateCode.trim()) return Promise.resolve('unsupported');
  try {
    if (!bridge.isSupported()) return Promise.resolve('unsupported');
  } catch { return Promise.resolve('unsupported'); }
  if (signal?.aborted) return Promise.reject(new DOMException('알림 설정 요청을 취소했어요.', 'AbortError'));

  return new Promise((resolve, reject) => {
    let cleanup: (() => void) | undefined;
    let settled = false;
    const finish = (result?: RechargeNotificationAgreement, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      cleanup?.();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(undefined, new DOMException('알림 설정 요청을 취소했어요.', 'AbortError'));
    const timeout = setTimeout(() => finish(undefined, new Error('알림 동의 확인이 늦어지고 있어요. 다시 시도해 주세요.')), 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      cleanup = bridge.request({
        options: { templateCode },
        onEvent: ({ type }) => {
          if (type === 'newAgreement' || type === 'alreadyAgreed') finish('granted');
          else if (type === 'agreementRejected') finish('denied');
          else finish(undefined, new Error('알림 동의 결과를 확인하지 못했어요. 다시 시도해 주세요.'));
        },
        onError: () => finish(undefined, new Error('알림 동의를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')),
      });
      // Native mocks and older bridge versions can callback before returning cleanup.
      if (settled) cleanup();
    } catch {
      finish(undefined, new Error('알림 동의를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
    }
  });
}
