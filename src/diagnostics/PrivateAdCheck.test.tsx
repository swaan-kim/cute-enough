import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrivateAdCheck } from './PrivateAdCheck';
import type { RewardedAdStatus } from '../lib/rewardedAd';

const bridge = vi.hoisted(() => ({
  status: 'loaded' as RewardedAdStatus,
  listener: undefined as undefined | ((status: RewardedAdStatus) => void),
  preload: vi.fn(async () => undefined), show: vi.fn(), confirm: vi.fn(), dispose: vi.fn(),
}));
vi.mock('@toss/tds-mobile', async () => import('../web-preview/tds-mobile'));
vi.mock('../lib/rewardedAd', () => ({
  getRewardedAdStatus: () => bridge.status,
  preloadRewardedAd: bridge.preload, showRewardedAd: bridge.show,
  confirmRewardedAdReturn: bridge.confirm, disposeRewardedAd: bridge.dispose,
  subscribeRewardedAdStatus: (listener: (status: RewardedAdStatus) => void) => {
    bridge.listener = listener; listener(bridge.status); return () => { bridge.listener = undefined; };
  },
}));
vi.mock('../lib/nativeNavigation', () => ({ closeMiniApp: vi.fn(), subscribeNativeNavigation: () => () => undefined }));
vi.mock('../lib/safeArea', () => ({ subscribeSafeArea: () => () => undefined }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_AD_DIAGNOSTICS', 'true'); vi.stubEnv('VITE_APP_RUNTIME', 'private');
  vi.stubEnv('VITE_ADS_ENABLED', 'true'); vi.stubEnv('VITE_ADS_TEST_MODE', 'true');
  vi.stubEnv('VITE_REWARDED_AD_GROUP_ID', 'ait-ad-test-rewarded-id');
  bridge.status = 'loaded'; bridge.listener = undefined;
  bridge.preload.mockResolvedValue(undefined); bridge.show.mockResolvedValue(undefined);
  localStorage.setItem('cute-enough:allowance', '{"remaining":2}');
  localStorage.setItem('existing-album', 'do-not-reset');
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('starts with isolated zero tickets, preloads without auto showing, and preserves stored history', async () => {
  const storage = { ...localStorage };
  const fetchSpy = vi.spyOn(window, 'fetch');
  render(<PrivateAdCheck />);
  expect(screen.getByRole('region', { name: '테스트 티켓 0장' })).toBeInTheDocument();
  await waitFor(() => expect(bridge.preload).toHaveBeenCalledOnce());
  expect(bridge.show).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect({ ...localStorage }).toEqual(storage);
});

it('requires an earned callback and lets the user finish when dismissed is missing', async () => {
  let earned!: () => void;
  let finish!: () => void;
  bridge.show.mockImplementation((_signal, callback) => {
    earned = callback;
    return new Promise<void>(resolve => { finish = resolve; });
  });
  bridge.confirm.mockImplementation(() => { finish(); return true; });
  render(<PrivateAdCheck />);
  fireEvent.click(screen.getByRole('button', { name: '테스트 광고 보기' }));
  fireEvent.click(screen.getByRole('button', { name: '테스트 광고 보기' }));
  expect(bridge.show).toHaveBeenCalledOnce();
  act(() => { earned(); bridge.listener?.('reward-earned'); });
  expect(screen.getByText('확인됐어요 ✓')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '광고를 닫고 돌아왔어요' }));
  expect(await screen.findByText('광고 연결과 시청 완료 신호를 확인했어요.')).toBeInTheDocument();
  expect(localStorage.getItem('cute-enough:allowance')).toBe('{"remaining":2}');
});

it('does not claim a reward after a close without earned event', async () => {
  render(<PrivateAdCheck />);
  fireEvent.click(screen.getByRole('button', { name: '테스트 광고 보기' }));
  expect(await screen.findByText('시청 완료 신호는 아직 없어요.')).toBeInTheDocument();
  expect(screen.getByText('아직 없어요')).toBeInTheDocument();
});

it('can retry unsupported/load failures without a pet or server session', async () => {
  bridge.status = 'unsupported';
  bridge.preload.mockRejectedValue(new Error('unsupported'));
  render(<PrivateAdCheck />);
  await screen.findByRole('alert');
  bridge.preload.mockImplementation(async () => { bridge.listener?.('loaded'); });
  fireEvent.click(screen.getByRole('button', { name: '광고 준비 다시 확인' }));
  expect(await screen.findByRole('button', { name: '테스트 광고 보기' })).toBeEnabled();
  expect(bridge.show).not.toHaveBeenCalled();
});

it.each([
  ['VITE_APP_RUNTIME', 'production'], ['VITE_AD_DIAGNOSTICS', 'false'],
  ['VITE_ADS_TEST_MODE', 'false'], ['VITE_ADS_ENABLED', 'false'],
  ['VITE_REWARDED_AD_GROUP_ID', 'ait.v2.live.anything'],
])('fails closed for unsafe %s=%s', (key, value) => {
  vi.stubEnv(key, value);
  render(<PrivateAdCheck />);
  expect(screen.getByRole('alert')).toHaveTextContent('별도 테스트 파일');
  expect(bridge.preload).not.toHaveBeenCalled();
  expect(bridge.show).not.toHaveBeenCalled();
});
