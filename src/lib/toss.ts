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

const PHOTO_OPTIONS = { maxCount: 2, maxWidth: 1024, base64: true } as const;

export class PhotoPickerUnavailableError extends Error {
  readonly useBrowserFallback = true;
}

export function isPhotoPickerUnavailableError(error: unknown): error is PhotoPickerUnavailableError {
  return error instanceof PhotoPickerUnavailableError
    || Boolean(error && typeof error === 'object' && 'useBrowserFallback' in error
      && (error as { useBrowserFallback?: unknown }).useBrowserFallback === true);
}

function normalizePickedPhoto(dataUri: unknown): string | null {
  if (dataUri == null) return null;
  if (typeof dataUri !== 'string' || dataUri.trim().length === 0) throw new Error('INVALID_DATA');
  const value = dataUri.trim();
  if (value.startsWith('data:image/')) return value;
  if (value.startsWith('data:')) throw new Error('INVALID_DATA');
  return `data:image/jpeg;base64,${value}`;
}

export function pickOnePhotoFromBrowser(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.style.display = 'none';
    let settled = false;
    const finish = (value: string | null, error?: Error) => {
      if (settled) return;
      settled = true;
      input.remove();
      if (error) reject(error);
      else resolve(value);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      if (file.type && !['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
        finish(null, new Error('JPG, PNG 또는 WEBP 사진만 올릴 수 있어요.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => finish(String(reader.result).replace(/^data:image\/jpg;/i, 'data:image/jpeg;'));
      reader.onerror = () => finish(null, new Error('선택한 사진을 읽지 못했어요. 다른 사진을 골라 주세요.'));
      reader.readAsDataURL(file);
    };
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export async function pickOnePhoto(): Promise<string | null> {
  if (isPreviewRuntime) return pickOnePhotoFromBrowser();

  let modernPickerError: unknown;
  try {
    // getAlbumItems is the current, selection-focused API. Unlike getPhotos it
    // does not make a hidden requestPermission bridge call before the picker.
    // Android's multi-photo contract rejects maxCount=1 before showing its UI,
    // so request the smallest valid multi-select count and consume only item 0.
    if (Device.getAlbumItems.isSupported()) {
      try {
        const items = await Device.getAlbumItems({ ...PHOTO_OPTIONS, types: ['PHOTO'] });
        return normalizePickedPhoto(items[0]?.dataUri);
      } catch (error) {
        const details = bridgeErrorCode(error);
        if (isPhotoPickerCanceled(details)) return null;
        if (!shouldTryLegacyPhotoPicker(details)) throw error;
        modernPickerError = error;
      }
    }

    // Keep the permission-wrapped photo-only API for older Toss versions and
    // as a recovery path when the modern bridge cannot request album access.
    const items = await pickWithPermissionWrappedPhotoPicker();
    return normalizePickedPhoto(items[0]?.dataUri);
  } catch (error) {
    const details = bridgeErrorCode(error);
    if (isPhotoPickerCanceled(details)) return null;

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

async function pickWithPermissionWrappedPhotoPicker() {
  try {
    return await Device.getPhotos(PHOTO_OPTIONS);
  } catch (error) {
    const details = bridgeErrorCode(error);
    if (!isPhotoPermissionError(details)) throw error;

    try {
      const permission = await Device.getPhotos.openPermissionDialog();
      if (permission === 'allowed') return await Device.getPhotos(PHOTO_OPTIONS);
    } catch {
      // Preserve the original permission error so the caller can show one
      // consistent recovery message instead of exposing a bridge error.
    }
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
  const message = `${petName ?? '귀여운 강아지'}가 기다리고 있어요 🐶\n${url}`;
  try {
    await Share.sendMessage({ message });
  }
  catch {
    if (!isPreviewRuntime) throw new Error('공유 화면을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    if (navigator.share) return navigator.share({ title: '오늘의 강아지', text: `${petName ?? '귀여운 강아지'}가 기다리고 있어요 🐶`, url });
    await navigator.clipboard.writeText(url);
    throw new Error('링크를 복사했어요.');
  }
}
