import { ApiError } from './api-error.ts';

export async function hashUser(raw: string): Promise<string> {
  const salt = Deno.env.get('USER_HASH_SALT');
  if (!salt) throw new Error('USER_HASH_SALT is not configured');
  const bytes = new TextEncoder().encode(`${salt}:${raw}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function kstDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[2] !== 0xFF) return undefined;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xFF) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xD8 || marker === 0xD9) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + length + 2 > bytes.length) return undefined;
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += length + 2;
  }
  return undefined;
}

export function decodeDataUri(dataUri: unknown): { bytes: Uint8Array; mime: 'image/jpeg' } {
  if (typeof dataUri !== 'string') throw new ApiError('INVALID_IMAGE', 400, '사진을 다시 골라주세요.');
  const match = /^data:(image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUri);
  if (!match) throw new ApiError('INVALID_IMAGE_FORMAT', 400, '사진을 다시 골라 안전한 형식으로 변환해 주세요.');
  let binary: string;
  try { binary = atob(match[2]); }
  catch { throw new ApiError('INVALID_IMAGE', 400, '올바른 사진 파일이 아니에요.'); }
  if (binary.length > 4 * 1024 * 1024) throw new ApiError('IMAGE_TOO_LARGE', 413, '사진 용량이 너무 커요. 다른 사진을 골라주세요.');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const dimensions = jpegDimensions(bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new ApiError('INVALID_IMAGE', 400, '올바른 사진 파일이 아니에요.');
  if (Math.max(dimensions.width, dimensions.height) > 1024) throw new ApiError('IMAGE_DIMENSIONS_TOO_LARGE', 413, '사진을 다시 골라 크기를 줄여주세요.');
  return { bytes, mime: 'image/jpeg' };
}
