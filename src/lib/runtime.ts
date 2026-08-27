export type AppRuntimeEnvironment = 'preview' | 'private' | 'production';

function environmentFromHost(hostname: string): AppRuntimeEnvironment {
  if (hostname === 'cute-enough.private-web.tossmini.com') return 'private';
  if (hostname === 'cute-enough.private-apps.tossmini.com') return 'private';
  if (hostname === 'cute-enough.web.tossmini.com') return 'production';
  if (hostname === 'cute-enough.apps.tossmini.com') return 'production';
  return 'preview';
}

export function resolveRuntimeEnvironment(
  configured = import.meta.env.VITE_APP_RUNTIME,
  hostname = typeof window === 'undefined' ? '' : window.location.hostname,
): AppRuntimeEnvironment {
  if (configured === 'preview' || configured === 'private' || configured === 'production') return configured;
  return environmentFromHost(hostname);
}

export const runtimeEnvironment = resolveRuntimeEnvironment();
export const isPreviewRuntime = runtimeEnvironment === 'preview';
export const rewardedAdsEnabled = !isPreviewRuntime && import.meta.env.VITE_ADS_ENABLED === 'true';
export const shareOgUrl = import.meta.env.VITE_SHARE_OG_URL;
