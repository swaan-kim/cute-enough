import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptNotificationKey, encryptNotificationKey } from './notification-crypto';

const key = Buffer.alloc(32, 42).toString('base64');
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('encrypted notification identity', () => {
  it('round-trips with fresh IVs and never stores the anonymous key as plaintext', async () => {
    const first = await encryptNotificationKey('anon-private-key', 'owner-hash', key);
    const second = await encryptNotificationKey('anon-private-key', 'owner-hash', key);
    expect(first).not.toBe(second);
    expect(first).not.toContain('anon-private-key');
    expect(await decryptNotificationKey(first, 'owner-hash', key)).toBe('anon-private-key');
  });

  it('binds the envelope to the owner and rejects a different server key', async () => {
    const envelope = await encryptNotificationKey('private', 'owner-a', key);
    await expect(decryptNotificationKey(envelope, 'owner-b', key)).rejects.toThrow();
    await expect(decryptNotificationKey(envelope, 'owner-a', Buffer.alloc(32, 43).toString('base64'))).rejects.toThrow();
  });

  it('rejects ciphertext tampering, invalid envelopes, and weak keys', async () => {
    const envelope = await encryptNotificationKey('private', 'owner', key);
    const parts = envelope.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    await expect(decryptNotificationKey(parts.join('.'), 'owner', key)).rejects.toThrow();
    await expect(decryptNotificationKey('v2.AA==.AA==', 'owner', key)).rejects.toThrow('FORMAT');
    await expect(encryptNotificationKey('private', 'owner', Buffer.alloc(16).toString('base64'))).rejects.toThrow('ENCRYPTION_KEY_INVALID');
  });
});
