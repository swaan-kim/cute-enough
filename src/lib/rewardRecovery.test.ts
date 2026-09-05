import { acknowledgeRewardRecovery, acknowledgeRewardStart, assertRewardStorage, canReplayRewardJob, enqueueRewardRecovery, getRewardStartRequest, readRewardRecovery, type RewardRecoveryJob } from './rewardRecovery';

describe('durable reward recovery', () => {
  beforeEach(() => localStorage.clear());

  it('retains the exact request ID and event sequence through reload/retry', () => {
    const job: RewardRecoveryJob = { kind: 'shareReward', sessionId: 'session', requestId: 'request', rewardAmount: 2, eventSequence: 3 };
    enqueueRewardRecovery(job);
    enqueueRewardRecovery(job);
    expect(readRewardRecovery()).toEqual([job]);
    acknowledgeRewardRecovery('request');
    expect(readRewardRecovery()).toEqual([]);
  });

  it('keeps a close summary behind unconfirmed rewards from its own session', () => {
    const earned: RewardRecoveryJob = { kind: 'shareReward', sessionId: 'session', requestId: 'earned', rewardAmount: 1, eventSequence: 1 };
    const closed: RewardRecoveryJob = { kind: 'shareClose', sessionId: 'session', requestId: 'close', summary: { sentRewardsCount: 1 } };
    enqueueRewardRecovery(earned);
    enqueueRewardRecovery(closed);
    expect(canReplayRewardJob(closed, readRewardRecovery())).toBe(false);
    acknowledgeRewardRecovery('earned');
    expect(canReplayRewardJob(closed, readRewardRecovery())).toBe(true);
    expect(readRewardRecovery()).toEqual([closed]);
  });

  it('checks durable storage before allowing a reward flow to start', () => {
    expect(() => assertRewardStorage({ getItem: () => null, setItem: () => { throw new Error('quota'); } })).toThrow('저장');
  });

  it('retries an uncertain session start with its original ID and clears only on acknowledgement', () => {
    const first = getRewardStartRequest('share');
    expect(getRewardStartRequest('share')).toBe(first);
    acknowledgeRewardStart('share');
    expect(getRewardStartRequest('share')).not.toBe(first);
  });
});
