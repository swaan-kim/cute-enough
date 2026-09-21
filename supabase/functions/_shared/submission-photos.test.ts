import { describe, expect, it, vi } from 'vitest';
import { MAX_PET_API_REQUEST_BYTES, MAX_SOURCE_IMAGE_BYTES, readPetApiBody, requireDirectSubmissionDataUri, requireSubmissionDataUris, requireSubmissionPhotoIndex, requirePhotoUploadInput, hasSubmissionPhotoReceipts } from './submission-photos.ts';

describe('submission photo contract', () => {
  it('accepts one legacy photo, one canonical photo, and five ordered photos', () => {
    expect(requireSubmissionDataUris({ dataUri: 'first' })).toEqual(['first']);
    expect(requireSubmissionDataUris({ dataUris: ['first'] })).toEqual(['first']);
    const photos = ['a', 'b', 'c', 'd', 'e'];
    expect(requireSubmissionDataUris({ dataUris: photos })).toEqual(photos);
    expect(requireSubmissionDataUris({ dataUris: photos, dataUri: 'a' })).toEqual(photos);
  });
  it.each([[], ['a', 'b', 'c', 'd', 'e', 'f'], null, 'a', undefined])('rejects an invalid array %j', (dataUris) => {
    expect(() => requireSubmissionDataUris({ dataUris, dataUri: 'fallback' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PHOTO_COUNT' }));
  });
  it('never silently discards contradictory photos or malformed elements', () => {
    expect(() => requireSubmissionDataUris({ dataUris: ['a', 'b'], dataUri: 'b' }))
      .toThrowError(expect.objectContaining({ code: 'AMBIGUOUS_PHOTOS' }));
    for (const body of [{}, { dataUris: ['a', null] }, { dataUris: [''] }]) {
      expect(() => requireSubmissionDataUris(body)).toThrowError(expect.objectContaining({ code: 'INVALID_IMAGE' }));
    }
  });
  it('requires staging before any bulk JPEG normalization and validates stage order', () => {
    expect(requireDirectSubmissionDataUri({ dataUri: 'legacy' })).toBe('legacy');
    expect(requireDirectSubmissionDataUri({ dataUris: ['single'] })).toBe('single');
    expect(() => requireDirectSubmissionDataUri({ dataUris: ['a', 'b'] }))
      .toThrowError(expect.objectContaining({ code: 'STAGED_UPLOAD_REQUIRED' }));
    for (const index of [0, 1, 2, 3, 4]) expect(requireSubmissionPhotoIndex(index)).toBe(index);
    for (const index of [-1, 5, 1.5, '0', null]) {
      expect(() => requireSubmissionPhotoIndex(index)).toThrowError(expect.objectContaining({ code: 'INVALID_PHOTO_INDEX' }));
    }
  });
  it('rejects mixed finalization inputs and arrays on the one-photo staging endpoint', () => {
    expect(hasSubmissionPhotoReceipts({ photoReceipts: ['signed'] })).toBe(true);
    expect(hasSubmissionPhotoReceipts({ dataUri: 'legacy' })).toBe(false);
    for (const extra of [{ dataUri: 'raw' }, { dataUris: ['raw'] }, { dataUri: undefined }]) {
      expect(() => hasSubmissionPhotoReceipts({ photoReceipts: ['signed'], ...extra }))
        .toThrowError(expect.objectContaining({ code: 'AMBIGUOUS_PHOTOS' }));
    }
    expect(requirePhotoUploadInput({ photoIndex: 4, dataUri: 'photo' })).toEqual({ photoIndex: 4, dataUri: 'photo' });
    for (const extra of [{ dataUris: ['a'] }, { photoReceipts: ['token'] }]) {
      expect(() => requirePhotoUploadInput({ photoIndex: 0, dataUri: 'photo', ...extra }))
        .toThrowError(expect.objectContaining({ code: 'AMBIGUOUS_PHOTOS' }));
    }
  });
});

describe('bounded registration body', () => {
  it('fits one maximum source JPEG and its permitted matching legacy field', () => {
    const encodedPhoto = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(MAX_SOURCE_IMAGE_BYTES / 3) * 4);
    const length = JSON.stringify({ action: 'submit', dataUris: [encodedPhoto], dataUri: encodedPhoto }).length;
    expect(length).toBeLessThan(MAX_PET_API_REQUEST_BYTES);
  });
  it('reads JSON without a Content-Length header and counts UTF-8 bytes', async () => {
    const body = JSON.stringify({ name: '구르미' });
    expect(await readPetApiBody(new Request('http://localhost', { method: 'POST', body }))).toEqual({ name: '구르미' });
    await expect(readPetApiBody(new Request('http://localhost', { method: 'POST', body }), body.length))
      .rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE', status: 413 });
  });
  it('rejects a dishonest length and cancels an oversized chunked stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"text":"over limit"}')); },
      cancel() { cancelled = true; },
    });
    const request = new Request('http://localhost', {
      method: 'POST', headers: { 'Content-Length': '1' }, body: stream, duplex: 'half',
    } as RequestInit);
    await expect(readPetApiBody(request, 10)).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });
  it('rejects oversized declared bodies before parsing and nonobject JSON', async () => {
    await expect(readPetApiBody(new Request('http://localhost', {
      method: 'POST', body: '{}', headers: { 'Content-Length': '100' },
    }), 10)).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' });
    for (const body of ['[]', 'null', '{']) {
      await expect(readPetApiBody(new Request('http://localhost', { method: 'POST', body })))
        .rejects.toMatchObject({ code: 'INVALID_JSON' });
    }
  });
  it.each(['resolved', 'rejected', 'pending'] as const)('cancels a pending read on abort even when source cleanup is %s', async (cleanup) => {
    const abortController = new AbortController();
    const cancel = vi.fn(() => {
      if (cleanup === 'rejected') return Promise.reject(new Error('Source cleanup failed'));
      if (cleanup === 'pending') return new Promise<void>(() => undefined);
    });
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    let notifyPendingRead!: () => void;
    const pendingRead = new Promise<void>((resolve) => { notifyPendingRead = resolve; });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode('{"action":"submit"}'));
      },
      pull() { notifyPendingRead(); },
      cancel,
    }, { highWaterMark: 0 });
    const request = new Request('http://localhost', {
      method: 'POST', body: stream, duplex: 'half',
    } as RequestInit);
    // This suite uses jsdom's AbortController with Node's Request implementation.
    Object.defineProperty(request, 'signal', { value: abortController.signal });
    const addListener = vi.spyOn(request.signal, 'addEventListener');
    const removeListener = vi.spyOn(request.signal, 'removeEventListener');
    const outcome = readPetApiBody(request).then((body) => ({ body }), (error: unknown) => ({ error }));
    await pendingRead;
    abortController.abort();
    // One event-loop turn exposes a stalled reader without hanging the test suite.
    let turnTimer!: ReturnType<typeof setTimeout>;
    const afterAbort = await Promise.race([
      outcome,
      new Promise<'still pending'>((resolve) => { turnTimer = setTimeout(() => resolve('still pending'), 0); }),
    ]);
    try {
      expect(afterAbort).toMatchObject({ error: { code: 'REQUEST_CANCELLED', status: 408 } });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', addListener.mock.calls[0][1]);
    } finally {
      clearTimeout(turnTimer);
      if (cancel.mock.calls.length === 0) streamController.close();
      await outcome;
    }
  });
  it('cancels an already-aborted body before acquiring a reader or parsing JSON', async () => {
    const abortController = new AbortController();
    abortController.abort();
    const request = new Request('http://localhost', { method: 'POST', body: '{"action":"submit"}' });
    Object.defineProperty(request, 'signal', { value: abortController.signal });
    const cancel = vi.spyOn(request.body!, 'cancel');
    const getReader = vi.spyOn(request.body!, 'getReader');
    const addListener = vi.spyOn(request.signal, 'addEventListener');

    await expect(readPetApiBody(request)).rejects.toMatchObject({ code: 'REQUEST_CANCELLED', status: 408 });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(getReader).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(request.body!.locked).toBe(false);
  });
  it.each(['valid', 'invalid', 'read failure', 'oversized'] as const)('releases the reader and abort listener after a %s body', async (kind) => {
    const body = kind === 'read failure'
      ? new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('Read failed')); } })
      : kind === 'invalid' ? '{' : '{"ok":true}';
    const request = new Request('http://localhost', { method: 'POST', body, duplex: 'half' } as RequestInit);
    const addListener = vi.spyOn(request.signal, 'addEventListener');
    const removeListener = vi.spyOn(request.signal, 'removeEventListener');
    const result = readPetApiBody(request, kind === 'oversized' ? 1 : undefined);

    if (kind === 'valid') await expect(result).resolves.toEqual({ ok: true });
    else await expect(result).rejects.toMatchObject({ code: kind === 'oversized' ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON' });
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', addListener.mock.calls[0][1]);
    expect(request.body!.locked).toBe(false);
  });
});
