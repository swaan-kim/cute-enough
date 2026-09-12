import { ApiError } from './api-error.ts';
import { MAX_SUBMISSION_PHOTOS } from './submission-photos.ts';

export const PHOTO_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
export type PhotoReceipt = {
  version: 1;
  ownerHash: string;
  submissionId: string;
  photoIndex: number;
  storagePath: string;
  sha256: string;
  expiresAt: number;
  purpose?: 'registration' | 'photo-addition';
  petId?: string;
};
export type PhotoReceiptScope = { purpose?: 'registration'; petId?: never }
  | { purpose: 'photo-addition'; petId: string };

export function photoReceiptPathPrefix(input: { ownerHash: string; submissionId: string } & PhotoReceiptScope): string {
  return input.purpose === 'photo-addition'
    ? `${input.ownerHash}/${input.submissionId}/photo-addition/${input.petId}/staged/`
    : `${input.ownerHash}/${input.submissionId}/staged/`;
}
const encoder = new TextEncoder();
const invalid = () => new ApiError('INVALID_PHOTO_RECEIPT', 400, '저장한 사진을 확인하지 못했어요. 사진을 다시 골라 주세요.');
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decodeBase64Url = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));

async function receiptKey(secret: string) {
  if (!secret) throw new Error('Photo receipt signing key is not configured');
  return crypto.subtle.importKey('raw', encoder.encode(`pet-submission-photo-receipt-v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createPhotoReceipt(claims: PhotoReceipt, secret: string): Promise<string> {
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign('HMAC', await receiptKey(secret), encoder.encode(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifyPhotoReceipts(
  value: unknown,
  expected: { ownerHash: string; submissionId: string } & PhotoReceiptScope,
  secret: string,
  now = Date.now(),
): Promise<PhotoReceipt[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SUBMISSION_PHOTOS) {
    throw new ApiError('INVALID_PHOTO_COUNT', 400, '사진은 1장부터 5장까지 골라 주세요.');
  }
  const key = await receiptKey(secret);
  const photos: PhotoReceipt[] = [];
  for (const [index, token] of value.entries()) {
    if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw invalid();
    let claims: PhotoReceipt;
    try {
      const [payload, signature] = token.split('.');
      if (!await crypto.subtle.verify('HMAC', key, decodeBase64Url(signature), encoder.encode(payload))) throw invalid();
      claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as PhotoReceipt;
    } catch { throw invalid(); }
    const scopeMatches = expected.purpose === 'photo-addition'
      ? claims?.purpose === 'photo-addition' && claims.petId === expected.petId
      : (claims?.purpose === undefined || claims.purpose === 'registration') && claims.petId === undefined;
    const prefix = photoReceiptPathPrefix(expected);
    if (!claims || !scopeMatches || claims.version !== 1 || claims.ownerHash !== expected.ownerHash
      || claims.submissionId !== expected.submissionId || claims.photoIndex !== index
      || typeof claims.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(claims.sha256)
      || typeof claims.storagePath !== 'string'
      || !claims.storagePath.startsWith(`${prefix}${index}-`)
      || !/^[0-4]-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jpg$/.test(claims.storagePath.slice(prefix.length))
      || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt > now + PHOTO_RECEIPT_TTL_MS + 60_000) throw invalid();
    if (claims.expiresAt <= now) {
      throw new ApiError('PHOTO_RECEIPT_EXPIRED', 400, '사진 저장 시간이 지나 사진을 다시 골라야 해요.');
    }
    photos.push(claims);
  }
  return photos;
}
