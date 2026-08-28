import {
  Device,
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

export async function pickOnePhoto(): Promise<string | null> {
  try {
    // The photo-only API performs its own permission request and is available on
    // older Toss versions too. A separate permission bridge call can fail before
    // the native picker is presented on some hosts.
    const items = await Device.getPhotos({ maxCount: 1, maxWidth: 2048, base64: true });
    return items[0]?.dataUri ?? null;
  } catch (error) {
    const code = bridgeErrorCode(error);
    if (hasBridgeErrorCode(code, 'CANCELED') || hasBridgeErrorCode(code, 'CANCELLED') || hasBridgeErrorCode(code, 'USER_CANCELED')) return null;
    if (!isPreviewRuntime) {
      if (hasBridgeErrorCode(code, 'UNSUPPORTED_APP_VERSION')) throw new Error('사진 선택을 사용하려면 토스앱을 최신 버전으로 업데이트해 주세요.');
      if (
        hasBridgeErrorCode(code, 'NOT_ALLOWED')
        || hasBridgeErrorCode(code, 'NOTALLOWEDERROR')
        || hasBridgeErrorCode(code, 'PERMISSION')
        || hasBridgeErrorCode(code, 'DENIED')
      ) throw new Error('강아지 사진을 고르려면 사진 접근을 허용해 주세요.');
      if (hasBridgeErrorCode(code, 'INVALID_REQUEST')) throw new Error('사진 선택 요청을 처리하지 못했어요. 앱을 다시 열고 시도해 주세요.');
      if (hasBridgeErrorCode(code, 'INVALID_DATA')) throw new Error('선택한 사진을 읽지 못했어요. 다른 사진을 골라 주세요.');
      throw new Error('사진을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

function bridgeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? '').toUpperCase();
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  return [candidate.code, candidate.message, candidate.name]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.toUpperCase())
    .join('|');
}

function hasBridgeErrorCode(details: string, expected: string): boolean {
  const normalized = details.replace(/[\s-]+/g, '_');
  return normalized.split('|').some((part) => part === expected || part.includes(expected));
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
