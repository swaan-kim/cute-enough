import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptNotificationKey } from '../_shared/notification-crypto';
import { matchesCronSecret, processRechargeNotifications } from './worker';

const secret = Buffer.alloc(32, 9).toString('base64');
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('recharge worker outcome safety', () => {
  it('requires the separate cron secret', async () => {
    expect(await matchesCronSecret(null, 'secret')).toBe(false);
    expect(await matchesCronSecret('secret', '')).toBe(false);
    expect(await matchesCronSecret('wrong', 'secret')).toBe(false);
    expect(await matchesCronSecret('secret', 'secret')).toBe(true);
  });
  it('does not send when final consent / allowance / visit checks suppress the claimed job', async () => {
    const database = { rpc: vi.fn().mockResolvedValueOnce({ data: [{ job_id: 'job', claim_token: 'token' }], error: null }).mockResolvedValueOnce({ data: null, error: null }) };
    const send = vi.fn();
    expect(await processRechargeNotifications({ database, encryptionKey: secret, templateCode: 'code', send })).toEqual({ claimed: 1, sent: 0, skipped: 1, failed: 0, unknown: 0 });
    expect(send).not.toHaveBeenCalled();
  });
  it('uses the same claim token to record an unknown outcome without sending again', async () => {
    const encryptedAnonymousKey = await encryptNotificationKey('private-anon', 'owner', secret);
    const database = { rpc: vi.fn()
      .mockResolvedValueOnce({ data: [{ job_id: 'job', claim_token: 'token' }], error: null })
      .mockResolvedValueOnce({ data: { ownerHash: 'owner', encryptedAnonymousKey, templateCode: 'code' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }) };
    const send = vi.fn().mockRejectedValue(new Error('response lost after acceptance'));
    const result = await processRechargeNotifications({ database, encryptionKey: secret, templateCode: 'code', send });
    expect(send).toHaveBeenCalledExactlyOnceWith('private-anon', 'code');
    expect(result.unknown).toBe(1);
    expect(database.rpc).toHaveBeenLastCalledWith('finish_recharge_notification_send', {
      p_job_id: 'job', p_claim_token: 'token', p_outcome: 'unknown', p_reason: 'worker_outcome_unknown',
    });
  });
  it('requires renewed consent if the approved template has changed', async () => {
    const database = { rpc: vi.fn()
      .mockResolvedValueOnce({ data: [{ job_id: 'job', claim_token: 'token' }], error: null })
      .mockResolvedValueOnce({ data: { ownerHash: 'owner', encryptedAnonymousKey: 'unneeded', templateCode: 'old-code' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }) };
    const send = vi.fn();
    const result = await processRechargeNotifications({ database, encryptionKey: secret, templateCode: 'new-code', send });
    expect(result.failed).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
});
