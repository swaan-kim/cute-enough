import { describe, expect, it } from 'vitest';
import { createPhotoReceipt, PHOTO_RECEIPT_TTL_MS, verifyPhotoReceipts, type PhotoReceipt } from './submission-photo-receipts.ts';

const secret = 'test-secret-only';
const now = 1_800_000_000_000;
const ownerHash = 'a'.repeat(64);
const submissionId = '12345678-1234-4234-8234-123456789abc';
const expected = { ownerHash, submissionId };
function claims(photoIndex = 0, overrides: Partial<PhotoReceipt> = {}): PhotoReceipt {
  return { version: 1, ...expected, photoIndex,
    storagePath: `${ownerHash}/${submissionId}/staged/${photoIndex}-11111111-1111-4111-8111-111111111111.jpg`,
    sha256: 'f'.repeat(64), expiresAt: now + PHOTO_RECEIPT_TTL_MS, ...overrides };
}

describe('private staged photo receipts', () => {
  it('accepts five ordered authenticated receipts bound to this submission', async () => {
    const photos = Array.from({ length: 5 }, (_, i) => claims(i));
    const tokens = await Promise.all(photos.map((photo) => createPhotoReceipt(photo, secret)));
    expect(await verifyPhotoReceipts(tokens, expected, secret, now)).toEqual(photos);
  });
  it('rejects owner, submission, index, path, checksum, and version mismatches', async () => {
    for (const override of [
      { ownerHash: 'other-owner' }, { submissionId: 'other-submission' }, { photoIndex: 1 },
      { storagePath: 'other-owner/photo.jpg' }, { sha256: '' }, { version: 2 as 1 },
      { expiresAt: now + PHOTO_RECEIPT_TTL_MS * 2 },
    ]) {
      const token = await createPhotoReceipt(claims(0, override), secret);
      await expect(verifyPhotoReceipts([token], expected, secret, now))
        .rejects.toMatchObject({ code: 'INVALID_PHOTO_RECEIPT', status: 400 });
    }
  });
  it('detects tampered payloads and signatures, incorrect keys, and malformed receipts', async () => {
    const token = await createPhotoReceipt(claims(), secret);
    const [payload, signature] = token.split('.');
    for (const invalid of [`${payload.slice(0, -1)}A.${signature}`, `${payload}.AAAA`, '', null, 'x'.repeat(2049)]) {
      await expect(verifyPhotoReceipts([invalid], expected, secret, now))
        .rejects.toMatchObject({ code: 'INVALID_PHOTO_RECEIPT' });
    }
    await expect(verifyPhotoReceipts([token], expected, 'different-key', now))
      .rejects.toMatchObject({ code: 'INVALID_PHOTO_RECEIPT' });
  });
  it('requires reupload on expiration and rejects duplicate/reordered/too many receipts', async () => {
    const expired = await createPhotoReceipt(claims(0, { expiresAt: now }), secret);
    await expect(verifyPhotoReceipts([expired], expected, secret, now))
      .rejects.toMatchObject({ code: 'PHOTO_RECEIPT_EXPIRED', status: 400 });
    const first = await createPhotoReceipt(claims(0), secret);
    const second = await createPhotoReceipt(claims(1), secret);
    for (const value of [[first, first], [second, first]]) {
      await expect(verifyPhotoReceipts(value, expected, secret, now)).rejects.toMatchObject({ code: 'INVALID_PHOTO_RECEIPT' });
    }
    for (const value of [[], Array(6).fill(first), null]) {
      await expect(verifyPhotoReceipts(value, expected, secret, now)).rejects.toMatchObject({ code: 'INVALID_PHOTO_COUNT' });
    }
  });
  it('binds additions to their purpose and dog while retaining old registration receipts', async () => {
    const petId = '11111111-1111-4111-8111-111111111111';
    const additionScope = { ...expected, purpose: 'photo-addition' as const, petId };
    const addition = claims(0, { purpose: 'photo-addition', petId,
      storagePath: `${ownerHash}/${submissionId}/photo-addition/${petId}/staged/0-11111111-1111-4111-8111-111111111111.jpg` });
    const token = await createPhotoReceipt(addition, secret);
    expect(await verifyPhotoReceipts([token], additionScope, secret, now)).toEqual([addition]);
    await expect(verifyPhotoReceipts([token], expected, secret, now)).rejects.toMatchObject({ code: 'INVALID_PHOTO_RECEIPT' });
    await expect(verifyPhotoReceipts([token], { ...additionScope, petId: 'another-pet' }, secret, now))
      .rejects.toMatchObject({ code: 'INVALID_PHOTO_RECEIPT' });
    for (const purpose of [undefined, 'registration' as const]) {
      const original = await createPhotoReceipt(claims(0, { purpose }), secret);
      expect(await verifyPhotoReceipts([original], expected, secret, now)).toHaveLength(1);
      await expect(verifyPhotoReceipts([original], additionScope, secret, now)).rejects.toMatchObject({ code: 'INVALID_PHOTO_RECEIPT' });
    }
    // Purpose alone is insufficient: both path scope and exact dog must match.
    for (const override of [{ purpose: undefined }, { petId: undefined },
      { storagePath: claims().storagePath }, { storagePath: addition.storagePath.replace('/staged/0-', '/staged/0-extra/0-') }]) {
      const invalid = await createPhotoReceipt({ ...addition, ...override }, secret);
      await expect(verifyPhotoReceipts([invalid], additionScope, secret, now)).rejects.toMatchObject({ code: 'INVALID_PHOTO_RECEIPT' });
    }
    const forgedRegistrationPath = await createPhotoReceipt(claims(0, { purpose: 'photo-addition', petId }), secret);
    await expect(verifyPhotoReceipts([forgedRegistrationPath], expected, secret, now)).rejects.toMatchObject({ code: 'INVALID_PHOTO_RECEIPT' });
  });
});
