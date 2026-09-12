import { acknowledgeRewardRecovery, acknowledgeRewardStart, assertRewardStorage, canReplayRewardJob, enqueueRewardRecovery, forgetPendingAdStart, getRewardStartRequest, markPendingAdStartNative, readPendingAdStarts, readRewardRecovery, rememberPendingAdStart, type RewardRecoveryJob } from './rewardRecovery';

const START_KEY = 'cute-enough:reward-starts:v1';
const AD_START_KEY = 'cute-enough:reward-ad-starts:v1';
const RECOVERY_KEY = 'cute-enough:reward-recovery:v1';

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

  it('persists the pet and request before a network start and retains them through native entry', () => {
    const pending = rememberPendingAdStart('pet-a');
    expect(pending).toEqual({ petId: 'pet-a', requestId: expect.any(String), phase: 'starting' });
    expect(JSON.parse(localStorage.getItem(AD_START_KEY)!)).toEqual([pending]);
    expect(getRewardStartRequest('ad:pet-a')).toBe(pending.requestId);
    expect(rememberPendingAdStart('pet-a')).toEqual(pending);

    markPendingAdStartNative(pending.petId, pending.requestId, 'session-a');
    expect(readPendingAdStarts()).toEqual([{ ...pending, phase: 'native', sessionId: 'session-a' }]);
    expect(rememberPendingAdStart('pet-a')).toEqual({ ...pending, phase: 'native', sessionId: 'session-a' });
    forgetPendingAdStart(pending.petId, pending.requestId);
    expect(readPendingAdStarts()).toEqual([]);
    expect(getRewardStartRequest('ad:pet-a')).not.toBe(pending.requestId);
  });

  it('discovers legacy ad starts without altering the share request', () => {
    localStorage.setItem(START_KEY, JSON.stringify({ 'ad:pet-a': 'legacy-a', 'ad:pet-b': 'legacy-b', share: 'share-request' }));
    expect(readPendingAdStarts()).toEqual([
      { petId: 'pet-a', requestId: 'legacy-a', phase: 'starting' },
      { petId: 'pet-b', requestId: 'legacy-b', phase: 'starting' },
    ]);
    expect(rememberPendingAdStart('pet-a').requestId).toBe('legacy-a');
    forgetPendingAdStart('pet-a', 'legacy-a');
    expect(readPendingAdStarts()).toEqual([{ petId: 'pet-b', requestId: 'legacy-b', phase: 'starting' }]);
    expect(getRewardStartRequest('share')).toBe('share-request');
  });

  it('does not erase a newer request when an older start is acknowledged', () => {
    const older = rememberPendingAdStart('pet-a');
    markPendingAdStartNative(older.petId, older.requestId, 'older-session');
    localStorage.setItem(START_KEY, JSON.stringify({ 'ad:pet-a': 'newer-request', share: 'share-request' }));
    forgetPendingAdStart(older.petId, older.requestId);
    expect(readPendingAdStarts()).toEqual([{ petId: 'pet-a', requestId: 'newer-request', phase: 'starting' }]);
    expect(getRewardStartRequest('share')).toBe('share-request');
  });

  it('recovers the legacy request when writing detailed start metadata fails', () => {
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => {
        if (key === AD_START_KEY) throw new Error('quota');
        localStorage.setItem(key, value);
      },
    };
    expect(() => rememberPendingAdStart('pet-a', storage)).toThrow('quota');
    const [pending] = readPendingAdStarts();
    expect(pending).toEqual({ petId: 'pet-a', requestId: expect.any(String), phase: 'starting' });
    expect(rememberPendingAdStart('pet-a').requestId).toBe(pending.requestId);
  });

  it('retains a replayable native marker if detailed cleanup fails', () => {
    const pending = rememberPendingAdStart('pet-a');
    markPendingAdStartNative(pending.petId, pending.requestId, 'session-a');
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => {
        if (key === AD_START_KEY) throw new Error('quota');
        localStorage.setItem(key, value);
      },
    };
    expect(() => forgetPendingAdStart(pending.petId, pending.requestId, storage)).toThrow('quota');
    expect(readPendingAdStarts()).toEqual([{ ...pending, phase: 'native', sessionId: 'session-a' }]);
    expect(rememberPendingAdStart('pet-a')).toEqual({ ...pending, phase: 'native', sessionId: 'session-a' });
    forgetPendingAdStart(pending.petId, pending.requestId);
    expect(readPendingAdStarts()).toEqual([]);
  });

  it.each(['{broken', 'null', '[]', '42'])('handles malformed legacy start map %s', (value) => {
    localStorage.setItem(START_KEY, value);
    expect(readPendingAdStarts()).toEqual([]);
    expect(() => acknowledgeRewardStart('share')).not.toThrow();
    expect(rememberPendingAdStart('pet-a')).toEqual({ petId: 'pet-a', requestId: expect.any(String), phase: 'starting' });
  });

  it('ignores malformed detailed starts and preserves valid legacy IDs', () => {
    localStorage.setItem(START_KEY, JSON.stringify({ 'ad:pet-a': 'legacy-a', 'ad:': 'empty-pet', 'ad:bad': {}, 'ad:empty': '', share: 'share-request' }));
    localStorage.setItem(AD_START_KEY, JSON.stringify([
      null, 3, {}, { petId: 'pet-a', requestId: 'legacy-a', phase: 'native' },
      { petId: 'pet-b', requestId: 'request-b', phase: 'unknown' },
      { petId: '', requestId: 'request-b', phase: 'starting' },
      { petId: 'pet-c', requestId: 'request-c', phase: 'native', sessionId: 'session-c' },
    ]));
    expect(readPendingAdStarts()).toEqual([
      { petId: 'pet-c', requestId: 'request-c', phase: 'native', sessionId: 'session-c' },
      { petId: 'pet-a', requestId: 'legacy-a', phase: 'starting' },
    ]);
    localStorage.setItem(AD_START_KEY, '{broken');
    expect(readPendingAdStarts()).toEqual([{ petId: 'pet-a', requestId: 'legacy-a', phase: 'starting' }]);
    expect(() => rememberPendingAdStart('')).toThrow();
    expect(() => markPendingAdStartNative('pet-a', 'legacy-a', '')).toThrow();
  });

  it('prefers native state when duplicate detailed start records are stored', () => {
    const starting = { petId: 'pet-a', requestId: 'request-a', phase: 'starting' };
    const native = { ...starting, phase: 'native', sessionId: 'session-a' };
    localStorage.setItem(AD_START_KEY, JSON.stringify([starting, native, starting]));
    expect(readPendingAdStarts()).toEqual([native]);
  });

  it('lets an earned ad replace a queued cancellation while retaining other sessions', () => {
    const cancel: RewardRecoveryJob = { kind: 'adCancel', requestId: 'cancel-a', sessionId: 'session-a' };
    const otherCancel: RewardRecoveryJob = { kind: 'adCancel', requestId: 'cancel-b', sessionId: 'session-b' };
    const complete: RewardRecoveryJob = { kind: 'adComplete', requestId: 'complete-a', sessionId: 'session-a', petId: 'pet-a' };
    enqueueRewardRecovery(cancel);
    enqueueRewardRecovery(otherCancel);
    const staleSnapshot = readRewardRecovery();
    enqueueRewardRecovery(complete);
    expect(readRewardRecovery()).toEqual([otherCancel, complete]);
    expect(canReplayRewardJob(staleSnapshot[0], readRewardRecovery())).toBe(false);
    expect(canReplayRewardJob(otherCancel, readRewardRecovery())).toBe(true);
    expect(canReplayRewardJob(complete, readRewardRecovery())).toBe(true);
    enqueueRewardRecovery({ ...cancel, requestId: 'late-cancel-a' });
    expect(readRewardRecovery()).toEqual([otherCancel, complete]);
    acknowledgeRewardRecovery(complete.requestId);
    expect(canReplayRewardJob(cancel, readRewardRecovery())).toBe(false);
  });

  it('normalizes legacy ad queues so completing a reward cannot expose its old cancel', () => {
    const complete: RewardRecoveryJob = { kind: 'adComplete', requestId: 'complete-a', sessionId: 'session-a', petId: 'pet-a' };
    const cancel: RewardRecoveryJob = { kind: 'adCancel', requestId: 'cancel-a', sessionId: 'session-a' };
    localStorage.setItem(RECOVERY_KEY, JSON.stringify([complete, cancel]));
    expect(readRewardRecovery()).toEqual([complete]);
    expect(canReplayRewardJob(cancel, [cancel, complete])).toBe(false);
    acknowledgeRewardRecovery(complete.requestId);
    expect(readRewardRecovery()).toEqual([]);
    expect(canReplayRewardJob(cancel, readRewardRecovery())).toBe(false);
  });
});
