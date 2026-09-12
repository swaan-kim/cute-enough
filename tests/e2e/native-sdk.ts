// A native-host fixture, deliberately independent of RewardedAdController.
type Callback = { onEvent: (event: { type: string }) => void; onError: (error: unknown) => void };
type Entry = { name: string; at: number; detail?: unknown };
const events: Entry[] = [];
const navigation = new Map<string, Set<() => void>>();
let load: Callback | undefined;
let show: Callback | undefined;
const note = (name: string, detail?: unknown) => events.push({ name, at: performance.now(), detail });
const fixture = {
  events,
  autoLoad: (window as unknown as { __nativeAutoLoad?: boolean }).__nativeAutoLoad ?? true,
  emitLoad(type = 'loaded') { note(`load:${type}`); load?.onEvent({ type }); },
  failLoad() { note('load:error'); load?.onError({ code: 'NO_FILL', message: '로컬 광고 준비 실패' }); },
  emitShow(type: string) { note(`show:${type}`); show?.onEvent({ type }); },
  failShow() { note('show:error'); show?.onError({ code: 'NETWORK_ERROR' }); },
  navigate(type: 'backEvent' | 'homeEvent') { for (const listener of navigation.get(type) ?? []) listener(); },
};
Object.assign(window, { __nativeFixture: fixture });
const unsupported = Object.assign(async () => { throw new Error('E2E_UNEXPECTED_NATIVE_ACTION'); }, { isSupported: () => false });
export const loadFullScreenAd = Object.assign((args: Callback & { options: unknown }) => {
  note('load', args.options); load = args;
  if (fixture.autoLoad) queueMicrotask(() => args.onEvent({ type: 'loaded' }));
  return () => { note('load:cleanup'); if (load === args) load = undefined; };
}, { isSupported: () => true });
export const showFullScreenAd = Object.assign((args: Callback & { options: unknown }) => {
  note('show', args.options); show = args;
  return () => { note('show:cleanup'); if (show === args) show = undefined; };
}, { isSupported: () => true });
export const User = { getAnonymousKey: Object.assign(async () => ({ type: 'HASH',
  hash: (window as unknown as { __nativeUserHash?: string }).__nativeUserHash ?? 'browser-flow-fixture-user' }), { isSupported: () => true }) };
export const Analytics = { log: (entry: unknown) => { note('analytics', entry); } };
export const Device = { triggerHaptic: async () => undefined, getAlbumItems: unsupported, getPhotos: unsupported };
export const SafeArea = { get: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), subscribe: () => () => undefined };
export const getSafeAreaInsets = SafeArea.get;
export const graniteEvent = { addEventListener: (type: string, { onEvent }: { onEvent: () => void }) => {
  const listeners = navigation.get(type) ?? new Set(); listeners.add(onEvent); navigation.set(type, listeners);
  return () => listeners.delete(onEvent);
} };
export const getSchemeUri = () => '';
export const getAppsInTossGlobals = () => ({ brandPrimaryColor: '#FF6B8A' });
export const closeView = async () => { note('closeView'); };
export const Share = { createLink: unsupported, sendMessage: unsupported };
export const File = { saveBase64: unsupported };
export const Promotion = { openContactsInvite: unsupported };
export class FetchAlbumPhotosPermissionError extends Error {}
export const requestNotificationAgreement = unsupported;
