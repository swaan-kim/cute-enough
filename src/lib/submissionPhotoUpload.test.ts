import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetSubmissionPhotos, uploadSubmissionPhotos } from './submissionPhotoUpload';

const id = 'staged-test';
afterEach(() => { forgetSubmissionPhotos(id); vi.useRealTimers(); });

describe('staged photo upload', () => {
  it('sends one photo at a time and preserves receipt order', async () => {
    let inFlight = 0;
    const upload = vi.fn(async ({ photoIndex }) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      await Promise.resolve();
      inFlight -= 1;
      return { photoReceipt: `r${photoIndex}` };
    });
    expect(await uploadSubmissionPhotos(id, ['a', 'b', 'c', 'd', 'e'], upload)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(upload.mock.calls.map(([input]) => input)).toEqual(['a', 'b', 'c', 'd', 'e'].map((dataUri, photoIndex) => ({ action: 'submitPhoto', submissionId: id, dataUri, photoIndex })));
  });

  it('retries only unfinished photos after a connection failure', async () => {
    const upload = vi.fn().mockResolvedValueOnce({ photoReceipt: 'first' }).mockRejectedValueOnce(new Error('offline'));
    await expect(uploadSubmissionPhotos(id, ['a', 'b'], upload)).rejects.toThrow('offline');
    upload.mockResolvedValue({ photoReceipt: 'second' });
    expect(await uploadSubmissionPhotos(id, ['a', 'b'], upload)).toEqual(['first', 'second']);
    expect(upload.mock.calls.map(([input]) => input.photoIndex)).toEqual([0, 1, 1]);
  });

  it('does not reuse a receipt for a different image or position', async () => {
    const upload = vi.fn(async ({ photoIndex, dataUri }) => ({ photoReceipt: `${photoIndex}:${dataUri}` }));
    await uploadSubmissionPhotos(id, ['a', 'b'], upload);
    expect(await uploadSubmissionPhotos(id, ['a', 'c'], upload)).toEqual(['0:a', '1:c']);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(await uploadSubmissionPhotos(id, ['c', 'a'], upload)).toEqual(['0:c', '1:a']);
    expect(upload).toHaveBeenCalledTimes(5);
  });

  it('refreshes expired in-memory receipts instead of persisting them to storage', async () => {
    vi.useFakeTimers();
    const before = { ...localStorage };
    const upload = vi.fn().mockResolvedValueOnce({ photoReceipt: 'old' }).mockResolvedValueOnce({ photoReceipt: 'new' });
    await uploadSubmissionPhotos(id, ['a'], upload);
    vi.setSystemTime(Date.now() + 3600001);
    expect(await uploadSubmissionPhotos(id, ['a'], upload)).toEqual(['new']);
    expect({ ...localStorage }).toEqual(before);
  });

  it('does not invent a receipt after a malformed upload response', async () => {
    await expect(uploadSubmissionPhotos(id, ['a'], vi.fn().mockResolvedValue({}))).rejects.toThrow('사진 전송 결과');
  });
});
