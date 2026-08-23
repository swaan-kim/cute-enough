import {
  fetchAlbumItems,
  getAnonymousKey,
  loadFullScreenAd,
  showFullScreenAd,
} from '@apps-in-toss/web-framework';

const AD_GROUP_ID = import.meta.env.VITE_REWARDED_AD_GROUP_ID || 'ait-ad-test-rewarded-id';
let rewardedAdState: 'idle' | 'loading' | 'loaded' = 'idle';
let rewardedAdLoad: Promise<void> | undefined;
let unregisterRewardedLoad: (() => void) | undefined;

function isRewardedAdSupported(): boolean {
  try {
    return loadFullScreenAd.isSupported() && showFullScreenAd.isSupported();
  } catch {
    return false;
  }
}

export async function getUserHash(): Promise<string> {
  try {
    const result = await getAnonymousKey();
    if (result && typeof result === 'object' && result.type === 'HASH') return result.hash;
  } catch { /* browser preview */ }
  let preview = localStorage.getItem('cute-enough:preview-user');
  if (!preview) {
    preview = crypto.randomUUID();
    localStorage.setItem('cute-enough:preview-user', preview);
  }
  return preview;
}

export async function pickOnePhoto(): Promise<string | null> {
  try {
    const items = await fetchAlbumItems({ types: ['PHOTO'], maxCount: 1, maxWidth: 1024, base64: true });
    return items[0]?.dataUri ?? null;
  } catch { /* use the browser picker in local preview */ }
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

export function preloadRewardedAd(): Promise<void> {
  if (!isRewardedAdSupported()) {
    return Promise.resolve();
  }

  if (rewardedAdState === 'loaded') return Promise.resolve();
  if (rewardedAdState === 'loading' && rewardedAdLoad) return rewardedAdLoad;

  rewardedAdState = 'loading';
  rewardedAdLoad = new Promise((resolve, reject) => {
    unregisterRewardedLoad?.();
    unregisterRewardedLoad = loadFullScreenAd({
      options: { adGroupId: AD_GROUP_ID },
      onEvent: (event) => {
        if (event.type !== 'loaded') return;
        rewardedAdState = 'loaded';
        resolve();
      },
      onError: (error) => {
        rewardedAdState = 'idle';
        rewardedAdLoad = undefined;
        reject(error);
      },
    });
  });
  return rewardedAdLoad;
}

export async function showRewardedAd(): Promise<void> {
  if (!isRewardedAdSupported()) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return;
  }

  await preloadRewardedAd();
  return new Promise((resolve, reject) => {
    let rewarded = false;
    const unregisterShow = showFullScreenAd({
      options: { adGroupId: AD_GROUP_ID },
      onEvent: (event) => {
        if (event.type === 'userEarnedReward') rewarded = true;
        if (event.type === 'failedToShow') {
          rewardedAdState = 'idle';
          unregisterShow();
          reject(new Error('광고를 보여드리지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
        }
        if (event.type === 'dismissed') {
          rewardedAdState = 'idle';
          rewardedAdLoad = undefined;
          unregisterShow();
          void preloadRewardedAd().catch(() => undefined);
          if (rewarded) resolve();
          else reject(new Error('광고 시청을 완료해야 사진을 볼 수 있어요.'));
        }
      },
      onError: (error) => {
        rewardedAdState = 'idle';
        rewardedAdLoad = undefined;
        unregisterShow();
        reject(error);
      },
    });
  });
}
