export type NotificationSendOutcome = { outcome: 'sent' | 'failed' | 'unknown'; reason: string };
export const TOSS_NOTIFICATION_URL = 'https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/messenger/send-message';

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** HTTP 200 / resultType SUCCESS alone does not prove that a push was sent. */
export function parseNotificationSendOutcome(httpStatus: number, payload: unknown): NotificationSendOutcome {
  const body = object(payload);
  if (httpStatus >= 200 && httpStatus < 300 && body?.resultType === 'SUCCESS') {
    const success = object(body.success);
    const detail = object(success?.detail);
    const fail = object(success?.fail);
    const count = success?.sentPushCount;
    if (count === 0 && Array.isArray(fail?.sentPush)) return { outcome: 'failed', reason: 'push_not_sent' };
    if (typeof count === 'number' && Number.isInteger(count) && count > 0
      && Array.isArray(detail?.sentPush) && detail.sentPush.length === count
      && detail.sentPush.every((entry) => {
        const message = object(entry);
        return typeof message?.contentId === 'string' && message.contentId.length > 0 && !message.reachedFailReason;
      })
      && Array.isArray(fail?.sentPush) && fail.sentPush.length === 0) {
      return { outcome: 'sent', reason: 'push_confirmed' };
    }
    return { outcome: 'unknown', reason: 'invalid_success_body' };
  }
  if (httpStatus < 500 && body?.resultType === 'FAIL' && typeof object(body.error)?.errorCode === 'string') {
    return { outcome: 'failed', reason: 'provider_rejected' };
  }
  return { outcome: 'unknown', reason: 'unconfirmed_provider_response' };
}

export async function sendRechargeNotification(
  anonymousKey: string,
  templateCode: string,
  client: unknown,
  fetcher: typeof fetch = fetch,
): Promise<NotificationSendOutcome> {
  try {
    const response = await fetcher(TOSS_NOTIFICATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-anon-key': anonymousKey },
      // Text is the pre-approved static Toss template, not caller-controlled copy.
      body: JSON.stringify({ templateSetCode: templateCode, context: {} }),
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
      client,
    } as RequestInit & { client: unknown });
    return parseNotificationSendOutcome(response.status, await response.json().catch(() => null));
  } catch {
    // The request may have reached Toss. Never blindly retry.
    return { outcome: 'unknown', reason: 'network_outcome_unknown' };
  }
}
