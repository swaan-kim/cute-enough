import {
  Device,
  FetchAlbumPhotosPermissionError,
  getSchemeUri,
  User,
  Share,
} from '@apps-in-toss/web-framework';
import { isPreviewRuntime, runtimeEnvironment, shareOgUrl } from './runtime';
import { getPrivateDeploymentIdFromUri } from './deepLink';

export async function getUserHash(): Promise<string> {
  try {
    if (!User.getAnonymousKey.isSupported()) throw new Error('UNSUPPORTED_APP_VERSION');
    const result: unknown = await User.getAnonymousKey();
    if (!result) throw new Error('UNSUPPORTED_APP_VERSION');
    if (result === 'INVALID_CATEGORY') throw new Error('INVALID_CATEGORY');
    if (result === 'ERROR') throw new Error('USER_KEY_ERROR');
    if (typeof result === 'object' && 'type' in result && 'hash' in result
      && result.type === 'HASH' && typeof result.hash === 'string' && result.hash) return result.hash;
    throw new Error('UNKNOWN_ERROR');
  } catch (error) {
    if (!isPreviewRuntime) {
      const code = bridgeErrorCode(error);
      if (hasBridgeErrorCode(code, 'UNSUPPORTED_APP_VERSION')) throw new Error('토스앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.');
      if (hasBridgeErrorCode(code, 'INVALID_CATEGORY')) throw new Error('앱 설정을 확인하고 있어요. 잠시 뒤 다시 시도해 주세요.');
      throw new Error('사용자 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }
  let preview = localStorage.getItem('cute-enough:preview-user');
  if (!preview) {
    preview = crypto.randomUUID();
    localStorage.setItem('cute-enough:preview-user', preview);
  }
  return preview;
}

const PHOTO_OPTIONS = { maxWidth: 1024, base64: true } as const;
const MAX_PHOTO_COUNT = 5;
const PHOTO_FORMAT_ERROR = 'JPG, PNG 또는 WEBP 사진만 올릴 수 있어요.';
const PHOTO_READ_ERROR = '선택한 사진을 읽지 못했어요. 다른 사진을 골라 주세요.';

class PhotoSelectionError extends Error {}

function photoSelectionLimit(maxCount: number): number {
  if (!Number.isInteger(maxCount) || maxCount < 1) {
    throw new PhotoSelectionError('사진은 1장 이상, 최대 5장까지 선택할 수 있어요.');
  }
  return Math.min(maxCount, MAX_PHOTO_COUNT);
}

function validatePhotoCount(count: number, maxCount: number): void {
  if (count > maxCount) {
    throw new PhotoSelectionError(`사진은 최대 ${maxCount}장까지 선택할 수 있어요. 다시 골라 주세요.`);
  }
}

export class PhotoPickerUnavailableError extends Error {
  readonly useBrowserFallback = true;
}

export function isPhotoPickerUnavailableError(error: unknown): error is PhotoPickerUnavailableError {
  return error instanceof PhotoPickerUnavailableError
    || Boolean(error && typeof error === 'object' && 'useBrowserFallback' in error
      && (error as { useBrowserFallback?: unknown }).useBrowserFallback === true);
}

function normalizePickedPhoto(dataUri: unknown): string {
  if (typeof dataUri !== 'string' || dataUri.trim().length === 0) throw new Error('INVALID_DATA');
  const value = dataUri.trim();
  if (value.startsWith('data:image/')) return value;
  if (value.startsWith('data:')) throw new Error('INVALID_DATA');
  return `data:image/jpeg;base64,${value}`;
}

function normalizePickedPhotos(items: { dataUri: string }[], maxCount: number): string[] {
  if (!Array.isArray(items)) throw new Error('INVALID_DATA');
  validatePhotoCount(items.length, maxCount);
  return items.map((item) => normalizePickedPhoto(item?.dataUri));
}

function browserPhotoMimeType(file: File): string {
  const type = file.type.toLowerCase().replace(/^image\/jpg$/, 'image/jpeg');
  if (['image/jpeg', 'image/png', 'image/webp'].includes(type)) return type;
  // Some browsers do not provide a MIME type. Only known image extensions are
  // accepted in that case; an explicit unsupported MIME type is never ignored.
  if (!type) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'png') return 'image/png';
    if (extension === 'webp') return 'image/webp';
  }
  throw new PhotoSelectionError(PHOTO_FORMAT_ERROR);
}

export async function pickPhotosFromBrowser(maxCount = MAX_PHOTO_COUNT): Promise<string[]> {
  const limit = photoSelectionLimit(maxCount);
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = true;
    input.style.display = 'none';
    const readers = new Set<FileReader>();
    let settled = false;
    let reading = false;
    const finish = (value: string[], error?: Error) => {
      if (settled) return;
      settled = true;
      input.onchange = null;
      input.removeEventListener('cancel', cancel);
      input.remove();
      for (const reader of readers) {
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
        if (reader.readyState === FileReader.LOADING) reader.abort();
      }
      readers.clear();
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => finish([]);
    input.onchange = () => {
      if (settled || reading) return;
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return finish([]);
      let mimeTypes: string[];
      try {
        validatePhotoCount(files.length, limit);
        mimeTypes = files.map(browserPhotoMimeType);
      } catch (error) {
        finish([], error instanceof Error ? error : new Error(PHOTO_FORMAT_ERROR));
        return;
      }
      reading = true;
      const photos = new Array<string>(files.length);
      let remaining = files.length;
      try {
        files.forEach((file, index) => {
          if (settled) return;
          const reader = new FileReader();
          readers.add(reader);
          reader.onload = () => {
            if (settled) return;
            if (typeof reader.result !== 'string' || !/^data:[^,]*;base64,.+/i.test(reader.result)) {
              finish([], new Error(PHOTO_READ_ERROR));
              return;
            }
            photos[index] = reader.result.replace(/^data:[^;]*;/i, `data:${mimeTypes[index]};`);
            remaining -= 1;
            if (remaining === 0) finish(photos);
          };
          reader.onerror = () => finish([], new Error(PHOTO_READ_ERROR));
          reader.onabort = () => finish([], new Error(PHOTO_READ_ERROR));
          reader.readAsDataURL(file);
        });
      } catch {
        finish([], new Error(PHOTO_READ_ERROR));
      }
    };
    input.addEventListener('cancel', cancel, { once: true });
    document.body.appendChild(input);
    try {
      input.click();
    } catch {
      finish([], new Error('기기 사진 선택창을 열지 못했어요. 다시 시도해 주세요.'));
    }
  });
}

export async function pickOnePhotoFromBrowser(): Promise<string | null> {
  return (await pickPhotosFromBrowser(1))[0] ?? null;
}

export async function pickPhotos(maxCount = MAX_PHOTO_COUNT): Promise<string[]> {
  const limit = photoSelectionLimit(maxCount);
  if (isPreviewRuntime) return pickPhotosFromBrowser(limit);

  const options = { ...PHOTO_OPTIONS, maxCount: Math.max(2, limit) };

  let modernPickerError: unknown;
  try {
    // getAlbumItems is the current, selection-focused API. Unlike getPhotos it
    // does not make a hidden requestPermission bridge call before the picker.
    // Some Android versions reject maxCount=1 before showing the picker. Ask
    // for at least two, then reject any selection exceeding the actual limit.
    if (Device.getAlbumItems.isSupported()) {
      try {
        const items = await Device.getAlbumItems({ ...options, types: ['PHOTO'] });
        return normalizePickedPhotos(items, limit);
      } catch (error) {
        if (error instanceof PhotoSelectionError) throw error;
        const details = bridgeErrorCode(error);
        if (isPhotoPickerCanceled(details)) return [];
        if (!shouldTryLegacyPhotoPicker(details)) throw error;
        modernPickerError = error;
      }
    }

    // Keep the permission-wrapped photo-only API for older Toss versions and
    // as a recovery path when the modern bridge cannot request album access.
    const items = await pickWithPermissionWrappedPhotoPicker(options.maxCount);
    return normalizePickedPhotos(items, limit);
  } catch (error) {
    if (error instanceof PhotoSelectionError) throw error;
    const details = bridgeErrorCode(error);
    if (isPhotoPickerCanceled(details)) return [];

    const modernDetails = bridgeErrorCode(modernPickerError);
    console.warn('[photo-picker]', [modernDetails, details].filter(Boolean).join(' -> ') || 'UNKNOWN_ERROR');
    if (error instanceof FetchAlbumPhotosPermissionError || isPhotoPermissionError(details)) {
      throw new PhotoPickerUnavailableError('사진 접근이 꺼져 있어요. 한 번 더 눌러 기기 사진을 골라주세요.');
    }
    if (hasBridgeErrorCode(details, 'UNSUPPORTED_APP_VERSION') || hasBridgeErrorCode(details, 'METHOD_NOT_FOUND')) {
      throw new PhotoPickerUnavailableError('토스 사진 선택 기능을 열지 못했어요. 한 번 더 눌러 기기 사진을 골라주세요.');
    }
    if (hasBridgeErrorCode(details, 'INVALID_DATA')) {
      throw new PhotoPickerUnavailableError('선택한 사진을 읽지 못했어요. 한 번 더 눌러 다른 사진을 골라주세요.');
    }
    throw new PhotoPickerUnavailableError('토스 사진 선택창을 열지 못했어요. 한 번 더 눌러 기기 사진을 골라주세요.');
  }
}

export async function pickOnePhoto(): Promise<string | null> {
  return (await pickPhotos(1))[0] ?? null;
}

async function pickWithPermissionWrappedPhotoPicker(maxCount: number) {
  const options = { ...PHOTO_OPTIONS, maxCount };
  try {
    return await Device.getPhotos(options);
  } catch (error) {
    const details = bridgeErrorCode(error);
    if (!isPhotoPermissionError(details)) throw error;

    let permission: 'allowed' | 'denied';
    try {
      permission = await Device.getPhotos.openPermissionDialog();
    } catch (permissionError) {
      if (isPhotoPickerCanceled(bridgeErrorCode(permissionError))) throw permissionError;
      // Preserve the original permission error so the caller can show one
      // consistent recovery message instead of exposing a bridge error.
      throw error;
    }
    if (permission === 'allowed') return await Device.getPhotos(options);
    throw error;
  }
}

function isPhotoPickerCanceled(details: string): boolean {
  return hasBridgeErrorCode(details, 'CANCELED')
    || hasBridgeErrorCode(details, 'CANCELLED')
    || hasBridgeErrorCode(details, 'USER_CANCELED');
}

function shouldTryLegacyPhotoPicker(details: string): boolean {
  return isPhotoPermissionError(details)
    || hasBridgeErrorCode(details, 'UNSUPPORTED_APP_VERSION')
    || hasBridgeErrorCode(details, 'METHOD_NOT_FOUND')
    || hasBridgeErrorCode(details, 'BRIDGE_UNAVAILABLE')
    || hasBridgeErrorCode(details, 'INVALID_REQUEST')
    || hasBridgeErrorCode(details, 'MAX_ITEMS');
}

function bridgeErrorCode(error: unknown, depth = 0): string {
  if (!error || typeof error !== 'object') return String(error ?? '').toUpperCase();
  const candidate = error as { code?: unknown; errorCode?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  const causeDetails = depth < 2 && candidate.cause !== error ? bridgeErrorCode(candidate.cause, depth + 1) : '';
  return [candidate.code, candidate.errorCode, candidate.message, candidate.name, causeDetails]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.toUpperCase())
    .join('|');
}

function hasBridgeErrorCode(details: string, expected: string): boolean {
  const normalized = details.replace(/[\s-]+/g, '_');
  return normalized.split('|').some((part) => part === expected || part.includes(expected));
}

function isPhotoPermissionError(details: string): boolean {
  return ['NOT_ALLOWED', 'NOTALLOWEDERROR', 'NO_PERMISSION', 'PERMISSION', 'DENIED', 'AUTHORIZATION', '권한', '허용'].some(
    (code) => hasBridgeErrorCode(details, code),
  );
}

export async function sharePet(petId: string, petName?: string): Promise<void> {
  const webUrl = `${window.location.origin}/pet/${encodeURIComponent(petId)}`;
  let url: string;
  if (isPreviewRuntime) {
    url = webUrl;
  } else {
    if (!shareOgUrl) throw new Error('공유 이미지 설정을 확인하고 있어요. 잠시 뒤 다시 시도해 주세요.');
    const scheme = runtimeEnvironment === 'private' ? 'intoss-private' : 'intoss';
    let privateQuery = '';
    if (runtimeEnvironment === 'private') {
      let deploymentId: string | undefined;
      try { deploymentId = getPrivateDeploymentIdFromUri(getSchemeUri()); } catch { deploymentId = undefined; }
      if (!deploymentId) throw new Error('비공개 테스트 링크 정보를 불러오지 못했어요. QR로 앱을 다시 열어 주세요.');
      privateQuery = `?_deploymentId=${encodeURIComponent(deploymentId)}`;
    }
    try {
      url = await Share.createLink({
        path: `${scheme}://cute-enough/pet/${encodeURIComponent(petId)}${privateQuery}`,
        ogImageUrl: shareOgUrl,
      });
    } catch {
      throw new Error('공유 링크를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }
  const shareText = `${petName?.trim() || '귀여운'} 강아지가 놀러왔어요 🐶`;
  const message = `${shareText}\n${url}`;
  try {
    await Share.sendMessage({ message });
  }
  catch {
    if (!isPreviewRuntime) throw new Error('공유 화면을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    if (navigator.share) return navigator.share({ title: '옆집 강아지', text: shareText, url });
    await navigator.clipboard.writeText(url);
    throw new Error('링크를 복사했어요.');
  }
}
