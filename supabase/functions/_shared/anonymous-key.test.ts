import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAnonymousKeyVerificationSuccess, verifyAnonymousKey } from './anonymous-key.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('anonymous key verification response parser', () => {
  it.each([true, 'true'])('accepts a SUCCESS response with success=%j', (success) => {
    expect(parseAnonymousKeyVerificationSuccess({ resultType: 'SUCCESS', success })).toBe(true);
  });

  it.each([
    null,
    {},
    { resultType: 'SUCCESS', success: false },
    { resultType: 'SUCCESS', success: 'false' },
    { resultType: 'SUCCESS', success: 1 },
    { resultType: 'FAIL', success: true },
  ])('rejects a non-success response: %j', (payload) => {
    expect(parseAnonymousKeyVerificationSuccess(payload)).toBe(false);
  });
});

describe('anonymous key verification failures', () => {
  function setup(status: number) {
    const close = vi.fn();
    vi.stubGlobal('Deno', {
      env: { get: (key: string) => key.startsWith('AIT_MTLS_') ? 'test-certificate-placeholder' : undefined },
      createHttpClient: () => ({ close }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return close;
  }

  it.each([429, 500, 503])('does not tell the user to relogin for upstream HTTP %s', async (status) => {
    const close = setup(status);
    await expect(verifyAnonymousKey(`upstream-${status}`)).rejects.toMatchObject({
      code: 'IDENTITY_VERIFY_UNAVAILABLE', status: 503,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('distinguishes a rejected user key from a temporary provider failure', async () => {
    const close = setup(401);
    await expect(verifyAnonymousKey('rejected-key')).rejects.toMatchObject({ code: 'INVALID_ANONYMOUS_KEY', status: 401 });
    expect(close).toHaveBeenCalledOnce();
  });

  it('classifies an unavailable mTLS client as a server issue without exposing certificate errors', async () => {
    vi.stubGlobal('Deno', {
      env: { get: () => 'test-placeholder' },
      createHttpClient: () => { throw new Error('certificate detail must stay private'); },
    });
    await expect(verifyAnonymousKey('mtls-failure')).rejects.toMatchObject({ code: 'IDENTITY_VERIFY_UNAVAILABLE', status: 503 });
  });
});
