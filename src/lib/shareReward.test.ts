import { openShareReward, SHARE_REWARD_MODULE_ID, type ShareRewardBridge } from './shareReward';

function bridge() {
  let params: Parameters<ShareRewardBridge['open']>[0] | undefined;
  const cleanup = vi.fn();
  const value: ShareRewardBridge = {
    isSupported: () => true,
    open: vi.fn((args) => { params = args; return cleanup; }),
  };
  return { value, cleanup, event: (event: Parameters<NonNullable<typeof params>['onEvent']>[0]) => params?.onEvent(event) };
}

describe('contact invite rewards', () => {
  it('records every earned amount immediately with a stable sequence before close', async () => {
    const native = bridge();
    const onReward = vi.fn();
    const onClose = vi.fn();
    const pending = openShareReward({ onReward, onClose }, native.value);
    expect(native.value.open).toHaveBeenCalledWith(expect.objectContaining({ moduleId: SHARE_REWARD_MODULE_ID }));
    native.event({ type: 'sendViral', data: { rewardAmount: 1, rewardUnit: '강아지 티켓' } });
    expect(onReward).toHaveBeenLastCalledWith(1, 1, '강아지 티켓');
    native.event({ type: 'sendViral', data: { rewardAmount: 2, rewardUnit: '강아지 티켓' } });
    expect(onReward).toHaveBeenLastCalledWith(2, 2, '강아지 티켓');
    expect(onClose).not.toHaveBeenCalled();
    native.event({ type: 'close', data: { sentRewardsCount: 3, sentRewardAmount: 3 } });
    await pending;
    expect(onReward).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledWith({ sentRewardsCount: 3, sentRewardAmount: 3 });
    expect(native.cleanup).toHaveBeenCalledOnce();
  });

  it('does not grant a ticket for closing, cancelling, or a late callback', async () => {
    const native = bridge();
    const onReward = vi.fn();
    const pending = openShareReward({ onReward, onClose: vi.fn() }, native.value);
    native.event({ type: 'close', data: { sentRewardsCount: 0 } });
    native.event({ type: 'sendViral', data: { rewardAmount: 1, rewardUnit: '강아지 티켓' } });
    await pending;
    expect(onReward).not.toHaveBeenCalled();
  });

  it('rejects a mismatched module unit without requesting a grant', async () => {
    const native = bridge();
    const onReward = vi.fn();
    const pending = openShareReward({ onReward, onClose: vi.fn() }, native.value);
    native.event({ type: 'sendViral', data: { rewardAmount: 1, rewardUnit: '포인트' } });
    await expect(pending).rejects.toThrow('설정');
    expect(onReward).not.toHaveBeenCalled();
  });

  it('does not open native UI when unsupported', async () => {
    const native = bridge();
    native.value.isSupported = () => false;
    await expect(openShareReward({ onReward: vi.fn(), onClose: vi.fn() }, native.value)).rejects.toThrow('업데이트');
    expect(native.value.open).not.toHaveBeenCalled();
  });
});
