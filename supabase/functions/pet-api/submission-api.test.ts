import { describe, expect, it, vi } from 'vitest';
import { registerSubmissionPhotos, registerSubmissionPhotoPaths, uploadSubmissionPhoto, type SubmissionClient } from './submission-api.ts';
import { verifyPhotoReceipts } from '../_shared/submission-photo-receipts.ts';

const args = { p_owner_hash: 'owner', p_submission_id: 'submission', p_pet_id: 'attempt' };
const photos = Array.from({ length: 5 }, (_, i) => ({ bytes: new Uint8Array([i]), mime: 'image/jpeg' as const }));
const paths = photos.map((_, i) => `owner/submission/attempt/${i}.jpg`);
const committed = { pet: { id: 'original' }, rewardGranted: true };
function harness(options: {
  uploadFailsAt?: number; rpcError?: { code?: string; message: string }; rpcThrows?: boolean;
  petId?: string; references?: Record<string, string[]>; referenceFails?: boolean;
} = {}) {
  let uploadCount = 0;
  const upload = vi.fn(async (_path: string, _bytes: Uint8Array, _options: unknown) => {
    uploadCount += 1;
    return { error: options.uploadFailsAt === uploadCount ? new Error('upload failed') : null };
  });
  const remove = vi.fn(async () => ({ error: null }));
  const readReferences = vi.fn(async (table: string) => ({
    data: (options.references?.[table] ?? []).map((storage_path) => ({ storage_path })),
    error: options.referenceFails ? new Error('database unavailable') : null,
  }));
  const single = vi.fn(async () => {
    if (options.rpcThrows) throw new Error('connection lost');
    return { data: options.rpcError ? null : { pet_id: options.petId ?? 'attempt', reward_granted: true }, error: options.rpcError ?? null };
  });
  const rpc = vi.fn(() => ({ single }));
  const client: SubmissionClient = {
    storage: { from: () => ({ upload, remove }) }, rpc,
    from: (table) => ({ select: () => ({ in: () => readReferences(table) }) }),
  };
  return { client, upload, remove, rpc, readReferences };
}

describe('atomic submission photo lifecycle', () => {
  it('stages one normalized photo with an authenticated receipt without registering or rewarding', async () => {
    const h = harness();
    const input = { ownerHash: 'owner', submissionId: 'submission', photoIndex: 0 };
    const result = await uploadSubmissionPhoto(h.client, input, photos[0], 'test-key');
    const receipts = await verifyPhotoReceipts([result.photoReceipt], input, 'test-key');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(h.upload).toHaveBeenCalledExactlyOnceWith(receipts[0].storagePath, photos[0].bytes, expect.objectContaining({ upsert: false }));
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
  it('does not issue a receipt or register after a staged upload failure, and uncertain cleanup retains the object', async () => {
    const h = harness({ uploadFailsAt: 1, referenceFails: true });
    await expect(uploadSubmissionPhoto(h.client, { ownerHash: 'owner', submissionId: 'submission', photoIndex: 0 }, photos[0], 'test-key'))
      .rejects.toThrow('upload failed');
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
  it('finalizes verified receipt paths with no second upload or normalization', async () => {
    const h = harness();
    expect(await registerSubmissionPhotoPaths(h.client, args, paths, async () => null))
      .toEqual({ registration: { pet_id: 'attempt', reward_granted: true } });
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('register_pet_submission_v4', { ...args, p_storage_paths: paths });
  });
  it('uploads five immutable ordered objects then sends exactly one registration RPC', async () => {
    const h = harness();
    const recover = vi.fn();
    expect(await registerSubmissionPhotos(h.client, args, photos, recover))
      .toEqual({ registration: { pet_id: 'attempt', reward_granted: true } });
    expect(h.upload.mock.calls.map(([path]) => path)).toEqual(paths);
    expect(h.upload).toHaveBeenCalledWith(paths[4], photos[4].bytes, expect.objectContaining({ upsert: false }));
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('register_pet_submission_v4', { ...args, p_storage_paths: paths });
    expect(h.remove).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });
  it('does not create a partial dog when the third upload fails and checks references before cleanup', async () => {
    const h = harness({ uploadFailsAt: 3, references: { pets: [paths[0]], pet_photos: [paths[1]] } });
    await expect(registerSubmissionPhotos(h.client, args, photos, async () => null)).rejects.toThrow('upload failed');
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.readReferences.mock.calls.map(([table]) => table)).toEqual(['pets', 'pet_photos']);
    expect(h.remove).toHaveBeenCalledExactlyOnceWith([paths[2]]);
  });
  it('retains files if either reference check is unavailable', async () => {
    const h = harness({ uploadFailsAt: 3, referenceFails: true });
    await expect(registerSubmissionPhotos(h.client, args, photos, async () => null)).rejects.toThrow();
    expect(h.remove).not.toHaveBeenCalled();
  });
  it('cleans all nonreferenced attempt photos after a confirmed capacity rollback', async () => {
    const h = harness({ rpcError: { code: 'P0001', message: 'UPLOAD_CAPACITY_REACHED' } });
    await expect(registerSubmissionPhotos(h.client, args, photos, async () => null))
      .rejects.toMatchObject({ code: 'UPLOAD_CAPACITY_REACHED', status: 503 });
    expect(h.remove).toHaveBeenCalledExactlyOnceWith(paths);
  });
  it('an incomplete final receipt set with missing Storage objects fails as a whole', async () => {
    const h = harness({ rpcError: { code: 'P0001', message: 'PET_PHOTO_MISSING' } });
    await expect(registerSubmissionPhotoPaths(h.client, args, paths, async () => null))
      .rejects.toMatchObject({ code: 'PET_PHOTO_MISSING', status: 503 });
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.readReferences).not.toHaveBeenCalled();
  });
  it('retains shared staged receipt objects after a known rejection or losing retry because another finalization may still commit', async () => {
    for (const options of [{ rpcError: { code: 'P0001', message: 'UPLOAD_CAPACITY_REACHED' } }, { petId: 'original' }]) {
      const h = harness(options);
      const result = registerSubmissionPhotoPaths(h.client, args, paths, async () => options.petId ? committed : null);
      if (options.petId) expect(await result).toEqual({ recovered: committed });
      else await expect(result).rejects.toMatchObject({ code: 'UPLOAD_CAPACITY_REACHED' });
      expect(h.remove).not.toHaveBeenCalled();
      expect(h.readReferences).not.toHaveBeenCalled();
    }
  });
  it.each([false, true])('retains files on uncertain RPC outcome (transport throw: %j)', async (rpcThrows) => {
    const h = harness({ rpcThrows, rpcError: { message: 'gateway timeout' } });
    await expect(registerSubmissionPhotos(h.client, args, photos, async () => null)).rejects.toBeDefined();
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.readReferences).not.toHaveBeenCalled();
  });
  it('recovers a lost response without deleting any committed objects', async () => {
    const h = harness({ rpcThrows: true });
    const recovered = { pet: { id: 'attempt' }, rewardGranted: true };
    expect(await registerSubmissionPhotos(h.client, args, photos, async () => recovered)).toEqual({ recovered });
    expect(h.remove).not.toHaveBeenCalled();
  });
  it('a concurrent losing retry returns the first result and cleans only unlinked attempt objects', async () => {
    const h = harness({ petId: 'original', references: { pet_photos: [paths[3]] } });
    expect(await registerSubmissionPhotos(h.client, args, photos, async () => committed)).toEqual({ recovered: committed });
    expect(h.remove).toHaveBeenCalledExactlyOnceWith(paths.filter((path) => path !== paths[3]));
  });
  it('retains all photos if RPC and recovery both fail', async () => {
    const h = harness({ rpcThrows: true });
    await expect(registerSubmissionPhotos(h.client, args, photos, async () => { throw new Error('lookup failed'); }))
      .rejects.toThrow('connection lost');
    expect(h.remove).not.toHaveBeenCalled();
  });
});
