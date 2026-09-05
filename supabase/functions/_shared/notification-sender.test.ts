import { describe, expect, it, vi } from 'vitest';
import { parseNotificationSendOutcome, sendRechargeNotification, TOSS_NOTIFICATION_URL } from './notification-sender';

const sent = { resultType: 'SUCCESS', success: { msgCount: 1, sentPushCount: 1, detail: { sentPush: [{ contentId: 'MSG_TEST' }] }, fail: { sentPush: [] } } };
describe('Toss push result validation', () => {
  it('requires a confirmed push detail and count', () => {
    expect(parseNotificationSendOutcome(200, sent).outcome).toBe('sent');
    expect(parseNotificationSendOutcome(200, { resultType: 'SUCCESS' }).outcome).toBe('unknown');
    expect(parseNotificationSendOutcome(200, { resultType: 'SUCCESS', success: { sentPushCount: 1 } }).outcome).toBe('unknown');
    expect(parseNotificationSendOutcome(200, { resultType: 'SUCCESS', success: { ...sent.success, detail: { sentPush: [] } } }).outcome).toBe('unknown');
  });
  it('does not confuse inbox delivery or HTTP 200 failures with a push', () => {
    expect(parseNotificationSendOutcome(200, { resultType: 'SUCCESS', success: { sentPushCount: 0, sentInboxCount: 1, fail: { sentPush: [] } } }).outcome).toBe('failed');
    expect(parseNotificationSendOutcome(200, { resultType: 'FAIL', error: { errorCode: 'REJECTED' } }).outcome).toBe('failed');
    expect(parseNotificationSendOutcome(503, { resultType: 'FAIL', error: { errorCode: 'INTERNAL' } }).outcome).toBe('unknown');
  });
  it('posts the approved template over the mTLS client using only x-anon-key', async () => {
    const client = { close: vi.fn() };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(sent)));
    expect((await sendRechargeNotification('anon-key', 'approved-template', client, fetcher)).outcome).toBe('sent');
    expect(fetcher).toHaveBeenCalledWith(TOSS_NOTIFICATION_URL, expect.objectContaining({
      client, redirect: 'error', body: JSON.stringify({ templateSetCode: 'approved-template', context: {} }),
      headers: expect.objectContaining({ 'x-anon-key': 'anon-key' }),
    }));
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('x-toss-user-key');
  });
  it('never retries timeout or invalid JSON responses', async () => {
    const timeout = vi.fn().mockRejectedValue(new Error('timeout'));
    expect((await sendRechargeNotification('key', 'template', {}, timeout)).outcome).toBe('unknown');
    expect(timeout).toHaveBeenCalledTimes(1);
    const invalid = vi.fn().mockResolvedValue(new Response('not JSON'));
    expect((await sendRechargeNotification('key', 'template', {}, invalid)).outcome).toBe('unknown');
    expect(invalid).toHaveBeenCalledTimes(1);
  });
});
