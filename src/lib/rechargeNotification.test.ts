import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@apps-in-toss/web-framework', () => ({ requestNotificationAgreement: Object.assign(vi.fn(), { isSupported: () => true }) }));
import { requestRechargeNotificationAgreement, type NotificationAgreementBridge } from './rechargeNotification';

afterEach(() => vi.useRealTimers());
describe('explicit recharge notification agreement', () => {
  it.each(['newAgreement', 'alreadyAgreed'])('accepts %s and cleans up synchronous callbacks', async (type) => {
    const cleanup = vi.fn();
    const bridge = { isSupported: () => true, request: vi.fn((input) => { input.onEvent({ type }); return cleanup; }) };
    await expect(requestRechargeNotificationAgreement('approved-template', undefined, bridge)).resolves.toBe('granted');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(bridge.request.mock.calls[0][0].options.templateCode).toBe('approved-template');
  });
  it('returns denied without enabling or leaving callbacks registered', async () => {
    const cleanup = vi.fn();
    const bridge: NotificationAgreementBridge = { isSupported: () => true, request: (input) => { input.onEvent({ type: 'agreementRejected' }); return cleanup; } };
    await expect(requestRechargeNotificationAgreement('code', undefined, bridge)).resolves.toBe('denied');
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('does not invoke the bridge when unsupported or no approved template exists', async () => {
    const request = vi.fn();
    await expect(requestRechargeNotificationAgreement('', undefined, { isSupported: () => true, request })).resolves.toBe('unsupported');
    await expect(requestRechargeNotificationAgreement('code', undefined, { isSupported: () => false, request })).resolves.toBe('unsupported');
    expect(request).not.toHaveBeenCalled();
  });
  it('releases listeners on abort and ignores a late success callback', async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    let event: (event: { type: string }) => void = () => undefined;
    const pending = requestRechargeNotificationAgreement('code', controller.signal, { isSupported: () => true, request: (input) => { event = input.onEvent; return cleanup; } });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    event({ type: 'newAgreement' });
    await assertion;
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('bounds a bridge that never responds', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const pending = requestRechargeNotificationAgreement('code', undefined, { isSupported: () => true, request: () => cleanup });
    const assertion = expect(pending).rejects.toThrow('늦어지고');
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
