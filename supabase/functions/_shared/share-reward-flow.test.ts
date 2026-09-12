import { describe, expect, it, vi } from 'vitest';
import { openShareReward, type ShareRewardBridge } from '../../../src/lib/shareReward';
import { acknowledgeRewardRecovery, canReplayRewardJob, enqueueRewardRecovery, readRewardRecovery } from '../../../src/lib/rewardRecovery';
import { rewardRpcRequest } from './reward-api';

describe('console share reward contract across client and API', () => {
  it.each(['티켓', '강아지 티켓'])('carries %s through durable recovery and server close validation', async (rewardUnit) => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const sessionId = '582b1dc1-bdb2-4f98-8e74-8202712d234c';
    let params: Parameters<ShareRewardBridge['open']>[0] | undefined;
    const bridge: ShareRewardBridge = { isSupported: () => true, open(args) { params = args; return vi.fn(); } };
    const pending = openShareReward({
      onReward(rewardAmount, eventSequence) {
        enqueueRewardRecovery({ kind: 'shareReward', requestId: crypto.randomUUID(), sessionId, rewardAmount, eventSequence }, storage);
      },
      onClose(summary) {
        enqueueRewardRecovery({ kind: 'shareClose', requestId: crypto.randomUUID(), sessionId, summary }, storage);
      },
    }, bridge);
    params!.onEvent({ type: 'sendViral', data: { rewardAmount: 1, rewardUnit } });
    params!.onEvent({ type: 'close', data: { sentRewardsCount: 1, sentRewardAmount: 1, rewardUnit } });
    await pending;
    const jobs = readRewardRecovery(storage);
    expect(jobs).toHaveLength(2);
    const reward = jobs[0];
    const close = jobs[1];
    expect(reward.kind).toBe('shareReward');
    expect(close.kind).toBe('shareClose');
    expect(canReplayRewardJob(close, jobs)).toBe(false);
    const firstRequest = rewardRpcRequest('shareReward', reward, 'verified-viewer');
    expect(firstRequest).toMatchObject({ name: 'record_pet_share_reward', args: { p_reward_amount: 1 } });
    // An uncertain retry keeps its request ID; only an acknowledgement removes it.
    expect(rewardRpcRequest('shareReward', readRewardRecovery(storage)[0], 'verified-viewer')).toEqual(firstRequest);
    acknowledgeRewardRecovery(reward.requestId, storage);
    expect(canReplayRewardJob(close, readRewardRecovery(storage))).toBe(true);
    expect(rewardRpcRequest('shareClose', close, 'verified-viewer')).toMatchObject({
      name: 'close_pet_share_reward', args: { p_total_reward_amount: 1 },
    });
    acknowledgeRewardRecovery(close.requestId, storage);
    expect(readRewardRecovery(storage)).toEqual([]);
  });
});
