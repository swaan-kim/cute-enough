import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPhotoPreparation } from './photoPreparation';

const photo = (id = 'one') => ({ petId: 'pet', photoId: id, photoUrl: `https://image.test/${id}.jpg`, signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString() });
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
  it('does no work before authorization and downloads/decodes the final URL once', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    expect(fetchMock).not.toHaveBeenCalled();
    expect('prefetch' in buffer).toBe(false);
    const first = buffer.resolve(photo());
    const duplicate = buffer.resolve(photo());
    expect(await first).toBe('blob:photo-1');
    expect(await duplicate).toBe('blob:photo-1');
    expect(fetchMock).toHaveBeenCalledOnce();
    buffer.dispose(); expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:photo-1');
  });
  it('releases the previous image when a refreshed authorized URL arrives', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    await buffer.resolve(photo());
    expect(await buffer.resolve(photo('two'))).toBe('blob:photo-2');
    expect(revoke).toHaveBeenCalledWith('blob:photo-1');
    buffer.dispose();
  });
  it.each([
    ['text/html', '3'], ['image/jpeg', String(9 * 1024 * 1024)],
  ])('rejects invalid or excessive response bytes: %s %s', async (mime, length) => {
    const buffer = createPhotoPreparation('pet', 'request');
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': mime, 'Content-Length': length } }));
    await expect(buffer.resolve(photo())).rejects.toThrow();
    expect(sequence).toBe(0); buffer.dispose();
  });
  it('keeps an authorized displayed image alive until close', async () => {
    vi.useFakeTimers();
    const buffer = createPhotoPreparation('pet', 'request');
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
  it('rejects authorization arriving after leaving without downloading', async () => {
    const buffer = createPhotoPreparation('pet', 'request');
    buffer.dispose();
    await expect(buffer.resolve(photo())).rejects.toMatchObject({ name: 'AbortError' });
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
