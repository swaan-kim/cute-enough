import { describe, expect, it, vi } from 'vitest';
import { createPhotoAdditionApi, type PhotoAdditionClient, type PhotoAdditionStatus } from './photo-addition-api.ts';
import { createPhotoReceipt, verifyPhotoReceipts } from '../_shared/submission-photo-receipts.ts';

const ownerHash = 'a'.repeat(64);
const petId = '11111111-1111-4111-8111-111111111111';
const submissionId = '22222222-2222-4222-8222-222222222222';
const secret = 'photo-addition-test-only';
const body = { petId, submissionId };
const available: PhotoAdditionStatus = { petId, activePhotoCount: 2, pendingPhotoCount: 0, maxPhotoCount: 5,
  remainingCount: 3, canSubmit: true, found: false };
const submission = { submissionId, petId, status: 'pending' as const, photoCount: 1, createdAt: '2026-09-06T10:00:00Z' };
const committed: PhotoAdditionStatus = { ...available, pendingPhotoCount: 1, remainingCount: 2,
  canSubmit: false, found: true, unavailableReason: 'PHOTO_ADDITION_PENDING', submission };
const photo = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' as const };

function harness(options: {
  statuses?: PhotoAdditionStatus[]; prepareError?: string; submitError?: string;
  submitThrows?: boolean; uploadThrows?: boolean; uploadsEnabled?: boolean; recoveryFails?: boolean;
} = {}) {
  const statuses = [...(options.statuses ?? [available])];
  let statusCount = 0;
  const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
    if (name === 'get_pet_photo_addition_status') {
      statusCount++;
      if (statusCount > 1 && options.recoveryFails) throw new Error('recovery offline');
      return { data: statuses.shift() ?? available, error: null };
    }
    if (name === 'prepare_pet_photo_addition') return {
      data: options.prepareError ? null : available,
      error: options.prepareError ? { code: 'P0001', message: options.prepareError } : null,
    };
    if (name === 'submit_pet_photo_addition') {
      if (options.submitThrows) throw new Error('connection lost');
      return { data: options.submitError ? null : { submission, remainingCount: 2 },
        error: options.submitError ? { code: 'P0001', message: options.submitError } : null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const upload = vi.fn(async () => {
    if (options.uploadThrows) throw new Error('upload connection lost');
    return { error: null };
  });
  const remove = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }));
  const decodePhoto = vi.fn(() => photo);
  const client: PhotoAdditionClient = { rpc, from, storage: { from: () => ({ upload, remove }) } };
  const api = createPhotoAdditionApi(client, { secret: () => secret, uploadsEnabled: () => options.uploadsEnabled !== false, decodePhoto });
  return { api, rpc, upload, remove, from, decodePhoto };
}

async function receipt(overrides = {}) {
  return createPhotoReceipt({ version: 1, ownerHash, petId, submissionId, purpose: 'photo-addition', photoIndex: 0,
    storagePath: `${ownerHash}/${submissionId}/photo-addition/${petId}/staged/0-33333333-3333-4333-8333-333333333333.jpg`,
    sha256: 'f'.repeat(64), expiresAt: Date.now() + 60_000, ...overrides }, secret);
}

describe('existing dog owner photo addition boundary', () => {
  it('reads only owner-scoped status metadata with optional exact submission lookup', async () => {
    const h = harness({ statuses: [committed, available] });
    expect(await h.api.status(ownerHash, body)).toEqual({ ...committed,
      unavailableReason: '추가한 사진을 검수하고 있어요. 검수가 끝난 뒤 다시 추가해 주세요.' });
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'get_pet_photo_addition_status', {
      p_owner_hash: ownerHash, p_pet_id: petId, p_submission_id: submissionId,
    });
    await h.api.status(ownerHash, { petId });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'get_pet_photo_addition_status', {
      p_owner_hash: ownerHash, p_pet_id: petId, p_submission_id: null,
    });
    expect(h.from).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });
  it('checks eligibility before normalization then stages an isolated signed photo without a public row', async () => {
    const h = harness();
    const result = await h.api.upload(ownerHash, { ...body, photoIndex: 0, dataUri: 'data:image/jpeg;base64,AQID' });
    const verified = await verifyPhotoReceipts([result.photoReceipt], { ownerHash, ...body, purpose: 'photo-addition' }, secret);
    expect(verified[0].storagePath).toContain(`/photo-addition/${petId}/staged/0-`);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('prepare_pet_photo_addition', {
      p_owner_hash: ownerHash, p_pet_id: petId, p_submission_id: submissionId, p_photo_index: 0,
    });
    expect(h.rpc.mock.invocationCallOrder[0]).toBeLessThan(h.decodePhoto.mock.invocationCallOrder[0]);
    expect(h.decodePhoto).toHaveBeenCalledTimes(1);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.from).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
  it.each([
    ['PHOTO_ADDITION_PET_NOT_FOUND', 404], ['PHOTO_ADDITION_NOT_ALLOWED', 409],
    ['PHOTO_ADDITION_PENDING', 409], ['PHOTO_ADDITION_CAPACITY_REACHED', 409], ['PHOTO_ADDITION_ALREADY_SUBMITTED', 409],
  ])('blocks %s before decoding/uploading', async (code, status) => {
    const h = harness({ prepareError: String(code) });
    await expect(h.api.upload(ownerHash, { ...body, photoIndex: 0, dataUri: 'data:image/jpeg;base64,AQID' }))
      .rejects.toMatchObject({ code, status });
    expect(h.decodePhoto).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });
  it('keeps staged objects on transport errors without cleanup or public mutations', async () => {
    const h = harness({ uploadThrows: true });
    await expect(h.api.upload(ownerHash, { ...body, photoIndex: 0, dataUri: 'data:image/jpeg;base64,AQID' })).rejects.toThrow('upload connection lost');
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });
  it('submits verified compact paths/checksums without another normalization/upload/reward call', async () => {
    const h = harness();
    const token = await receipt();
    const claims = (await verifyPhotoReceipts([token], { ownerHash, ...body, purpose: 'photo-addition' }, secret))[0];
    expect(await h.api.submit(ownerHash, { ...body, photoReceipts: [token] })).toEqual({ submission, remainingCount: 2 });
    expect(h.rpc).toHaveBeenLastCalledWith('submit_pet_photo_addition', {
      p_owner_hash: ownerHash, p_pet_id: petId, p_submission_id: submissionId,
      p_storage_paths: [claims.storagePath], p_photo_sha256: [claims.sha256],
    });
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['get_pet_photo_addition_status', 'submit_pet_photo_addition']);
    expect(h.decodePhoto).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });
  it('returns the first immutable result after creator review even with expired receipts or disabled uploads', async () => {
    const reviewed = { ...committed, submission: { ...submission, status: 'rejected' as const, reviewNote: '다른 사진을 골라 주세요.' } };
    const h = harness({ statuses: [reviewed], uploadsEnabled: false });
    expect(await h.api.submit(ownerHash, { ...body, photoReceipts: ['expired'] }))
      .toEqual({ submission: reviewed.submission, remainingCount: 2 });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.upload).not.toHaveBeenCalled();
  });
  it.each([false, true])('retains all staged photos and recovers a lost commit response (throw=%j)', async (submitThrows) => {
    const h = harness({ statuses: [available, committed], submitThrows, submitError: 'gateway timeout' });
    expect(await h.api.submit(ownerHash, { ...body, photoReceipts: [await receipt()] })).toEqual({ submission, remainingCount: 2 });
    expect(h.remove).not.toHaveBeenCalled();
  });
  it('retains photos when both commit and reconciliation fail', async () => {
    const h = harness({ submitThrows: true, recoveryFails: true });
    await expect(h.api.submit(ownerHash, { ...body, photoReceipts: [await receipt()] })).rejects.toThrow('connection lost');
    expect(h.remove).not.toHaveBeenCalled();
  });
  it.each(['PET_PHOTO_MISSING', 'PHOTO_ADDITION_PENDING', 'PHOTO_ADDITION_CAPACITY_REACHED'])('maps %s and preserves photos', async (code) => {
    const h = harness({ submitError: code });
    await expect(h.api.submit(ownerHash, { ...body, photoReceipts: [await receipt()] })).rejects.toMatchObject({ code });
    expect(h.remove).not.toHaveBeenCalled();
  });
  it('rejects cross-owner/dog/purpose/expired receipts before finalizing', async () => {
    for (const override of [{ ownerHash: 'other' }, { petId: submissionId }, { purpose: 'registration' }, { expiresAt: 1 }]) {
      const h = harness();
      await expect(h.api.submit(ownerHash, { ...body, photoReceipts: [await receipt(override)] }))
        .rejects.toMatchObject({ code: override.expiresAt ? 'PHOTO_RECEIPT_EXPIRED' : 'INVALID_PHOTO_RECEIPT' });
      expect(h.rpc).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects profile/publication/reward changes and mixed or direct photo payloads', async () => {
    for (const changes of [{ name: '수정' }, { traits: {} }, { style: {} }, { status: 'approved' },
      { rewardGranted: true }, { requestedAccessory: {} }, { publishedDesign: {} }]) {
      const h = harness();
      await expect(h.api.submit(ownerHash, { ...body, ...changes, photoReceipts: [await receipt()] })).rejects.toBeDefined();
      expect(h.rpc).not.toHaveBeenCalled();
    }
    const h = harness();
    await expect(h.api.submit(ownerHash, { ...body, dataUri: 'direct' })).rejects.toMatchObject({ code: 'STAGED_UPLOAD_REQUIRED' });
    await expect(h.api.submit(ownerHash, { ...body, dataUri: 'direct', photoReceipts: [await receipt()] }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_PHOTOS' });
  });
});
