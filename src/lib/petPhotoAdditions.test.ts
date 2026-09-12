import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_PETS } from '../data/samplePets';
import { readPreviewMyPets, savePreviewSubmission } from './previewPetStore';
import { fetchPhotoAdditionStatus, submitPhotoAddition } from './petPhotoAdditions';
import { PetApiError } from './api';
import type { PhotoAdditionStatus } from '../types';

const harness = vi.hoisted(() => ({ preview: true, invoke: vi.fn() }));
vi.mock('./runtime', () => ({ get isPreviewRuntime() { return harness.preview; } }));
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), invokePetApi: harness.invoke }));

const jpeg = (index: number) => `data:image/jpeg;base64,PHOTO${index}`;
const submission = (petId = 'existing', submissionId = 'addition') => ({ petId, submissionId,
  status: 'pending' as const, photoCount: 2, createdAt: '2026-09-06T00:00:00Z' });
const status = (overrides: Partial<PhotoAdditionStatus> = {}): PhotoAdditionStatus => ({ petId: 'existing',
  activePhotoCount: 3, pendingPhotoCount: 0, maxPhotoCount: 5, remainingCount: 2, canSubmit: true, ...overrides });
function owner(photoCount = 3, approvalStatus: 'approved' | 'pending' | 'paused' = 'approved') {
  const pet = { ...SAMPLE_PETS[0], id: 'existing', name: '구르미', isMine: true, approvalStatus,
    photoUrl: '/original-0.jpg', photoUrls: Array.from({ length: photoCount }, (_, index) => `/original-${index}.jpg`) };
  savePreviewSubmission('original-dog-submission', { pet, rewardGranted: false });
  return pet;
}
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  harness.preview = true;
  harness.invoke.mockReset();
});

describe('existing dog photo addition preview', () => {
  it('keeps original identity, photos, appearance, album and tickets unchanged while queuing one batch', async () => {
    owner();
    localStorage.setItem('existing-album', 'original collection');
    localStorage.setItem('cute-enough:allowance', 'original tickets');
    const before = new Map(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]));
    const original = readPreviewMyPets();
    const result = await submitPhotoAddition({ petId: 'existing', submissionId: 'addition', dataUris: [jpeg(0), jpeg(1)] });
    expect(result).toMatchObject({ submission: { petId: 'existing', photoCount: 2, status: 'pending' }, remainingCount: 0 });
    expect(readPreviewMyPets()).toEqual(original);
    for (const [key, value] of before) expect(localStorage.getItem(key)).toBe(value);
    const pending = localStorage.getItem('cute-enough:preview-photo-additions:v1')!;
    expect(pending).not.toContain('data:image');
    expect(await fetchPhotoAdditionStatus('existing')).toMatchObject({ activePhotoCount: 3, pendingPhotoCount: 2, canSubmit: false });
  });

  it('returns the immutable first result for simultaneous and later same-ID retries', async () => {
    owner();
    const input = { petId: 'existing', submissionId: 'same-attempt', dataUris: [jpeg(0)] };
    const [a, b] = await Promise.all([submitPhotoAddition(input), submitPhotoAddition({ ...input, dataUris: [jpeg(1), jpeg(2)] })]);
    expect(a.submission).toEqual(b.submission);
    expect(b.submission.photoCount).toBe(1);
    expect((await fetchPhotoAdditionStatus('existing', input.submissionId))).toMatchObject({ found: true, pendingPhotoCount: 1 });
  });

  it('counts pending photos and blocks another batch while review is pending', async () => {
    owner(1, 'pending');
    await submitPhotoAddition({ petId: 'existing', submissionId: 'first', dataUris: [jpeg(0)] });
    await expect(submitPhotoAddition({ petId: 'existing', submissionId: 'second', dataUris: [jpeg(1)] })).rejects.toMatchObject({ code: 'PHOTO_ADDITION_UNAVAILABLE' });
    expect(await fetchPhotoAdditionStatus('existing')).toMatchObject({ activePhotoCount: 1, pendingPhotoCount: 1, remainingCount: 3, canSubmit: false });
  });

  it('rejects photos beyond remaining capacity and preserves historical dogs above five', async () => {
    owner(4);
    await expect(submitPhotoAddition({ petId: 'existing', submissionId: 'too-many', dataUris: [jpeg(0), jpeg(1)] })).rejects.toMatchObject({ code: 'PHOTO_ADDITION_LIMIT_REACHED' });
    owner(7);
    expect(await fetchPhotoAdditionStatus('existing')).toMatchObject({ activePhotoCount: 7, remainingCount: 0, canSubmit: false });
    expect(readPreviewMyPets()[0].photoUrls).toHaveLength(7);
  });

  it('allows only the current owner and blocks paused dogs', async () => {
    owner(2, 'paused');
    await expect(fetchPhotoAdditionStatus('another-dog')).rejects.toMatchObject({ status: 403 });
    await expect(submitPhotoAddition({ petId: 'existing', submissionId: 'paused', dataUris: [jpeg(0)] })).rejects.toMatchObject({ code: 'PHOTO_ADDITION_UNAVAILABLE' });
    expect(await fetchPhotoAdditionStatus('existing', 'not-committed')).toMatchObject({ canSubmit: false, found: false });
  });
});

describe('photo addition production wire contract', () => {
  beforeEach(() => { harness.preview = false; });
  it('sends separate one-photo requests then only receipts without dog design, name or rewards', async () => {
    const requestId = crypto.randomUUID();
    harness.invoke.mockImplementation(async (body) => body.action === 'photoAdditionUpload'
      ? { photoReceipt: `receipt-${body.photoIndex}` } : { submission: submission('existing', requestId), remainingCount: 0 });
    await submitPhotoAddition({ petId: 'existing', submissionId: requestId, dataUris: [jpeg(0), jpeg(1)] });
    expect(harness.invoke.mock.calls.map(([body]) => body)).toEqual([
      { action: 'photoAdditionUpload', petId: 'existing', submissionId: requestId, photoIndex: 0, dataUri: jpeg(0) },
      { action: 'photoAdditionUpload', petId: 'existing', submissionId: requestId, photoIndex: 1, dataUri: jpeg(1) },
      { action: 'photoAdditionSubmit', petId: 'existing', submissionId: requestId, photoReceipts: ['receipt-0', 'receipt-1'] },
    ]);
  });

  it('resumes a failed stage without reuploading completed photos', async () => {
    const requestId = crypto.randomUUID();
    let fail = true;
    harness.invoke.mockImplementation(async (body) => {
      if (body.action === 'photoAdditionUpload') {
        if (body.photoIndex === 1 && fail) { fail = false; throw new PetApiError('offline', 'NETWORK_ERROR', 'unknown'); }
        return { photoReceipt: `receipt-${body.photoIndex}` };
      }
      return { submission: submission('existing', requestId), remainingCount: 0 };
    });
    const input = { petId: 'existing', submissionId: requestId, dataUris: [jpeg(0), jpeg(1)] };
    await expect(submitPhotoAddition(input)).rejects.toMatchObject({ outcome: 'unknown' });
    await submitPhotoAddition(input);
    expect(harness.invoke.mock.calls.filter(([body]) => body.action === 'photoAdditionUpload').map(([body]) => body.photoIndex)).toEqual([0, 1, 1]);
  });

  it.each(['INVALID_PHOTO_RECEIPT', 'PHOTO_RECEIPT_EXPIRED', 'PET_PHOTO_MISSING'])('reuploads after confirmed %s', async (code) => {
    const requestId = crypto.randomUUID();
    let fail = true;
    harness.invoke.mockImplementation(async (body) => {
      if (body.action === 'photoAdditionUpload') return { photoReceipt: `receipt-${body.photoIndex}` };
      if (fail) { fail = false; throw new PetApiError('retry', code, 'definite'); }
      return { submission: submission('existing', requestId), remainingCount: 0 };
    });
    const input = { petId: 'existing', submissionId: requestId, dataUris: [jpeg(0), jpeg(1)] };
    await expect(submitPhotoAddition(input)).rejects.toMatchObject({ code });
    await submitPhotoAddition(input);
    expect(harness.invoke.mock.calls.filter(([body]) => body.action === 'photoAdditionUpload')).toHaveLength(4);
  });

  it('reconciles an already committed addition without creating a second one', async () => {
    const requestId = crypto.randomUUID();
    harness.invoke.mockRejectedValueOnce(new PetApiError('committed', 'PHOTO_ADDITION_ALREADY_SUBMITTED', 'definite', 409))
      .mockResolvedValueOnce(status({ pendingPhotoCount: 2, remainingCount: 0, canSubmit: false, found: true, submission: submission('existing', requestId) }));
    const result = await submitPhotoAddition({ petId: 'existing', submissionId: requestId, dataUris: [jpeg(0), jpeg(1)] });
    expect(result.submission.submissionId).toBe(requestId);
    expect(harness.invoke.mock.calls.map(([body]) => body.action)).toEqual(['photoAdditionUpload', 'photoAdditionStatus']);
  });

  it('does not unlock a known committed addition if reconciliation fails', async () => {
    harness.invoke.mockRejectedValueOnce(new PetApiError('committed', 'PHOTO_ADDITION_ALREADY_SUBMITTED', 'definite', 409))
      .mockRejectedValueOnce(new PetApiError('offline', 'NETWORK_ERROR', 'unknown'));
    await expect(submitPhotoAddition({ petId: 'existing', submissionId: crypto.randomUUID(), dataUris: [jpeg(0)] })).rejects.toMatchObject({ outcome: 'unknown' });
  });

  it.each([
    { petId: 'different' }, { remainingCount: 5 }, { activePhotoCount: -1 },
    { pendingPhotoCount: 1, remainingCount: 1, canSubmit: true }, { maxPhotoCount: 16 },
  ])('rejects inconsistent or cross-pet status: %j', async (invalid) => {
    harness.invoke.mockResolvedValue(status(invalid as Partial<PhotoAdditionStatus>));
    await expect(fetchPhotoAdditionStatus('existing')).rejects.toMatchObject({ code: 'INVALID_PHOTO_ADDITION_RESPONSE' });
  });

  it('does not pass private photo fields from status responses into app state', async () => {
    harness.invoke.mockResolvedValue({ ...status(), storagePath: 'private/path', photoUrl: 'private-url' });
    expect(await fetchPhotoAdditionStatus('existing')).toEqual(status());
  });
});
