import { closeView, getSchemeUri, graniteEvent } from '@apps-in-toss/web-framework';
import { getSharedPetId, getSharedPetIdFromUri } from './deepLink';

export function getInitialSharedPetId(
  readSchemeUri: () => string = getSchemeUri,
  location: Pick<Location, 'pathname' | 'search'> = window.location,
): string | undefined {
  try {
    const sharedPetId = getSharedPetIdFromUri(readSchemeUri());
    if (sharedPetId) return sharedPetId;
  } catch {
    // A standalone browser does not expose the Apps in Toss bridge.
  }
  return getSharedPetId(location);
}

export function subscribeNativeNavigation({ onBack, onHome }: {
  onBack: () => void;
  onHome: () => void;
}): () => void {
  const cleanups: Array<() => void> = [];
  try {
    cleanups.push(graniteEvent.addEventListener('backEvent', { onEvent: onBack }));
  } catch {
    // Native navigation events are unavailable in a standalone browser preview.
  }
  try {
    cleanups.push(graniteEvent.addEventListener('homeEvent', { onEvent: onHome }));
  } catch {
    // Native navigation events are unavailable in a standalone browser preview.
  }
  return () => cleanups.forEach((cleanup) => {
    try { cleanup(); } catch { /* already detached by the native host */ }
  });
}

export function closeMiniApp(): Promise<void> {
  return closeView();
}
