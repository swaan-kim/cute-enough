import { describe, expect, it } from 'vitest';
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
});
