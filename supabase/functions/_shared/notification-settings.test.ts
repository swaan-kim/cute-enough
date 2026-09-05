import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptNotificationKey } from './notification-crypto';
import { getRechargeNotificationSettings, noteRechargeNotificationVisit, setRechargeNotificationSettings } from './notification-settings';

const secret = Buffer.alloc(32, 7).toString('base64');
const configured = (name: string) => ({
  RECHARGE_NOTIFICATIONS_ENABLED: 'true', NOTIFICATION_KEY_ENCRYPTION_KEY: secret,
  RECHARGE_NOTIFICATION_TEMPLATE_CODE: 'approved-code', RECHARGE_NOTIFICATION_CRON_SECRET: 'server-secret',
  AIT_MTLS_CERT_PEM: 'certificate', AIT_MTLS_PRIVATE_KEY_PEM: 'private-key',
})[name];
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('recharge notification settings boundaries', () => {
  it('is disabled by default while still checking an existing subscription', async () => {
    const database = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    await expect(getRechargeNotificationSettings(database, 'owner', () => undefined)).resolves.toEqual({ enabled: false, available: false });
    expect(database.rpc).toHaveBeenCalledWith('get_recharge_notification_settings', { p_owner_hash: 'owner' });
    database.rpc.mockResolvedValue({ data: { enabled: true, templateCode: 'approved-code' }, error: null });
    await expect(getRechargeNotificationSettings(database, 'owner', () => undefined)).resolves.toEqual({ enabled: true, available: false });
  });
  it('degrades only a missing optional migration to unavailable', async () => {
    const database = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } }) };
    await expect(getRechargeNotificationSettings(database, 'owner', configured)).resolves.toEqual({ enabled: false, available: false });
    database.rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    await expect(getRechargeNotificationSettings(database, 'owner', configured)).rejects.toMatchObject({ code: 'NOTIFICATION_SETTINGS_UNAVAILABLE' });
  });
  it('requires the explicit Toss agreement before saving an encrypted key', async () => {
    const database = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    await expect(setRechargeNotificationSettings(database, { ownerHash: 'owner', anonymousKey: 'private-anon', enabled: true }, configured)).rejects.toMatchObject({ code: 'NOTIFICATION_AGREEMENT_REQUIRED' });
    expect(database.rpc).not.toHaveBeenCalled();
    const result = await setRechargeNotificationSettings(database, { ownerHash: 'owner', anonymousKey: 'private-anon', enabled: true, tossAgreementGranted: true }, configured);
    expect(result).toEqual({ enabled: true, available: true, templateCode: 'approved-code' });
    const params = database.rpc.mock.calls[0][1];
    expect(JSON.stringify(params)).not.toContain('private-anon');
    expect(await decryptNotificationKey(params.p_encrypted_anon_key, 'owner', secret)).toBe('private-anon');
  });
  it('still clears the key and jobs when the global feature switch is off', async () => {
    const database = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    await setRechargeNotificationSettings(database, { ownerHash: 'owner', anonymousKey: 'private', enabled: false }, () => undefined);
    expect(database.rpc).toHaveBeenCalledWith('set_recharge_notification_settings', {
      p_owner_hash: 'owner', p_enabled: false, p_encrypted_anon_key: null, p_template_code: null,
    });
  });
  it('never fails the core house operation when visit bookkeeping is unavailable', async () => {
    await expect(noteRechargeNotificationVisit({ rpc: vi.fn().mockRejectedValue(new Error('offline')) }, 'owner')).resolves.toBeUndefined();
  });
});
