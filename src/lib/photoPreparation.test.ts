import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPhotoPreparation, type PreparedPhoto } from './photoPreparation';

const photo = (id = 'one'): PreparedPhoto => ({ petId: 'pet', photoId: id, photoUrl: `https://image.test/${id}.jpg`, signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString() });
const fetchMock = vi.fn();
const revoke = vi.fn();
let decode: () => Promise<void>;
let sequence = 0;
beforeEach(() => {
  sequence = 0; revoke.mockReset();
  decode = async () => undefined;
  fetchMock.mockReset().mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }));
  vi.stubGlobal('fetch', fetchMock);
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL() { return `blob:photo-${++sequence}`; }
    static revokeObjectURL = revoke;
  });
  vi.stubGlobal('Image', class { src = ''; onload = null; onerror = null; decode() { return decode(); } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('one-encounter authorized photo buffer', () => {
  it('downloads and decodes once, reusing pixels only after matching final authorization', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    const load = vi.fn(async () => photo());
    buffer.prefetch(load); buffer.prefetch(load);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await buffer.resolve({ ...photo(), photoUrl: 'https://image.test/refreshed-url' })).toBe('blob:photo-1');
    expect(load).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce();
    buffer.dispose(); expect(revoke).toHaveBeenCalledWith('blob:photo-1');
  });
  it('does not show an old candidate when final photo selection changes', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    buffer.prefetch(async () => photo());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await buffer.resolve(photo('two'))).toBe('blob:photo-2');
    expect(fetchMock.mock.calls[1][0]).toBe(photo('two').photoUrl);
    buffer.dispose();
  });
  it('does not reuse expired preparation', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    buffer.prefetch(async () => ({ ...photo(), signedUrlExpiresAt: new Date(0).toISOString() }));
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    await buffer.resolve(photo()); expect(fetchMock).toHaveBeenCalledOnce(); buffer.dispose();
  });
  it('falls back after preparation API failure without preventing final loading', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    buffer.prefetch(async () => { throw new Error('old API'); });
    expect(await buffer.resolve(photo())).toBe('blob:photo-1'); buffer.dispose();
  });
  it('falls back to the final authorized URL after a speculative image download fails', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    buffer.prefetch(async () => photo());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await buffer.resolve({ ...photo(), photoUrl: 'https://image.test/refreshed-url' })).toBe('blob:photo-1');
    expect(fetchMock.mock.calls[1][0]).toBe('https://image.test/refreshed-url');
    buffer.dispose();
  });
  it('discards pixels prepared more than five minutes ago even with a valid signed URL', async () => {
    const now = Date.now();
    const buffer = createPhotoPreparation('pet', 'request');
    buffer.prefetch(async () => photo());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    vi.useFakeTimers(); vi.setSystemTime(now + 301_000);
    expect(await buffer.resolve(photo())).toBe('blob:photo-2');
    expect(revoke).toHaveBeenCalledWith('blob:photo-1');
    expect(fetchMock).toHaveBeenCalledTimes(2); buffer.dispose();
  });
  it.each([
    ['text/html', '3'], ['image/jpeg', String(9 * 1024 * 1024)],
  ])('rejects invalid or excessive response bytes: %s %s', async (mime, length) => {
    const buffer = createPhotoPreparation('pet', 'request');
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': mime, 'Content-Length': length } }));
    await expect(buffer.resolve(photo())).rejects.toThrow();
    expect(sequence).toBe(0); buffer.dispose();
  });
  it('silently ignores a different pet from a preparation response', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    buffer.prefetch(async () => ({ ...photo(), petId: 'wrong' }));
    await Promise.resolve(); expect(fetchMock).not.toHaveBeenCalled(); buffer.dispose();
  });
  it('automatically releases an unused preparation after five minutes without user input', async () => {
    vi.useFakeTimers();
    const buffer = createPhotoPreparation('pet', 'request');
    buffer.prefetch(async () => photo());
    await vi.waitFor(() => expect(sequence).toBe(1));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(revoke).toHaveBeenCalledWith('blob:photo-1');
    expect(await buffer.resolve(photo())).toBe('blob:photo-2'); buffer.dispose();
  });
  it('keeps a finally authorized displayed image alive until close, not preparation expiry', async () => {
    vi.useFakeTimers();
    const buffer = createPhotoPreparation('pet', 'request');
    buffer.prefetch(async () => photo());
    await vi.waitFor(() => expect(sequence).toBe(1));
    expect(await buffer.resolve(photo())).toBe('blob:photo-1');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(revoke).not.toHaveBeenCalled();
    buffer.dispose(); expect(revoke).toHaveBeenCalledWith('blob:photo-1');
  });
  it('rejects broken image downloads and releases resources', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    fetchMock.mockResolvedValue(new Response('failed', { status: 500 }));
    await expect(buffer.resolve(photo())).rejects.toThrow('사진을 불러오지 못했어요'); buffer.dispose();
  });
  it.each(['network', 'decode'])('gives a localized retry message for a native %s failure', async (stage) => {
    const buffer = createPhotoPreparation('pet', 'request');
    if (stage === 'network') fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    else decode = async () => { throw new DOMException('The source image cannot be decoded.', 'EncodingError'); };
    await expect(buffer.resolve(photo())).rejects.toThrow('사진을 불러오지 못했어요. 다시 불러와 주세요.');
    buffer.dispose();
    if (stage === 'decode') expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:photo-1');
  });
  it('reports a stalled decode as a retryable timeout and allows a fresh encounter buffer to recover', async () => {
    vi.useFakeTimers();
    decode = () => new Promise(() => undefined);
    const buffer = createPhotoPreparation('pet', 'request');
    const result = buffer.resolve(photo()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(sequence).toBe(1));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await result).toMatchObject({ name: 'Error', message: '사진을 불러오는 데 시간이 오래 걸려요. 다시 불러와 주세요.' });
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:photo-1');
    buffer.dispose();

    decode = async () => undefined;
    const retry = createPhotoPreparation('pet', 'request');
    expect(await retry.resolve(photo())).toBe('blob:photo-2');
    retry.dispose();
    expect(revoke.mock.calls).toEqual([['blob:photo-1'], ['blob:photo-2']]);
  });
  it('waits for actual decoding and cancels it on leaving', async () => {
    decode = () => new Promise(() => undefined);
    const buffer = createPhotoPreparation('pet', 'request');
    const result = buffer.resolve(photo()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(sequence).toBe(1));
    buffer.dispose(); expect(await result).toMatchObject({ name: 'AbortError' });
    expect(revoke).toHaveBeenCalledWith('blob:photo-1');
  });
  it('does not start an image download after a late preparation response on an abandoned encounter', async () => {
    let finish!: (value: PreparedPhoto) => void;
    const buffer = createPhotoPreparation('pet', 'request');
    buffer.prefetch(() => new Promise((resolve) => { finish = resolve; }));
    buffer.dispose(); finish(photo()); await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not retain late downloaded bytes after leaving even when fetch ignores the abort', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const buffer = createPhotoPreparation('pet', 'request');
    const result = buffer.resolve(photo()).catch((error: unknown) => error);
    buffer.dispose();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    finish(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }));
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(sequence).toBe(0);
    expect(revoke).not.toHaveBeenCalled();
  });
});
