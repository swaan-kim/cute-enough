import { describe, expect, it } from 'vitest';
import { rewardRpcError, rewardRpcRequest, rewardStatusPayload, SHARE_REWARD_UNIT, type RewardDatabaseState } from './reward-api';

const sessionId = '582b1dc1-bdb2-4f98-8e74-8202712d234c';
const requestId = 'a43d71c0-a6cf-4be3-a60a-c72b0dcc8f81';
const petId = 'b937ec21-3cce-4254-8fa7-c779b47e1b78';

describe('reward API boundary', () => {
  it.each([1, 2])('uses album-aware reward status for album version %s', (albumVersion) => {
    expect(rewardRpcRequest('rewardStatus', { albumVersion }, 'verified-viewer')).toEqual({
      name: 'get_pet_album_reward_state', args: { p_owner_hash: 'verified-viewer' },
    });
  });

  it.each([undefined, 0, 3, '2'])('preserves legacy reward status for album version %j', (albumVersion) => {
    expect(rewardRpcRequest('rewardStatus', { albumVersion }, 'verified-viewer')).toEqual({
      name: 'get_pet_reward_state', args: { p_owner_hash: 'verified-viewer' },
    });
  });

  it.each(['티켓', '강아지 티켓'])('accepts console and legacy queued close unit %s without granting from close', (rewardUnit) => {
    expect(SHARE_REWARD_UNIT).toBe('티켓');
    expect(rewardRpcRequest('shareClose', { sessionId,
      summary: { sentRewardsCount: 1, sentRewardAmount: 1, rewardUnit },
    }, 'verified-viewer')).toEqual({ name: 'close_pet_share_reward', args: {
      p_owner_hash: 'verified-viewer', p_session_id: sessionId, p_total_reward_amount: 1,
    } });
  });

  it.each(['', '포인트', '티켓 ', 'ticket', '강아지티켓', null, 1])('rejects malformed close unit %j', (rewardUnit) => {
    expect(() => rewardRpcRequest('shareClose', { sessionId,
      summary: { sentRewardsCount: 1, sentRewardAmount: 1, rewardUnit },
    }, 'verified-viewer')).toThrow(expect.objectContaining({ code: 'INVALID_REWARD_INPUT', status: 400 }));
  });

  it('uses the verified owner instead of any owner or module supplied by the client', () => {
    const request = rewardRpcRequest('shareReward', {
      ownerHash: 'another-viewer', moduleId: 'another-module', sessionId, requestId,
      eventSequence: 2, rewardAmount: 3,
    }, 'verified-viewer');
    expect(request.args).toEqual({ p_owner_hash: 'verified-viewer', p_session_id: sessionId,
      p_request_id: requestId, p_event_sequence: 2, p_reward_amount: 3 });
  });

  it('rejects malformed event amounts and sequences before reaching the database', () => {
    for (const override of [{ rewardAmount: 0 }, { rewardAmount: -1 }, { rewardAmount: 1.5 },
      { rewardAmount: '1' }, { rewardAmount: 1001 }, { eventSequence: 0 }, { eventSequence: Infinity }]) {
      expect(() => rewardRpcRequest('shareReward', {
        sessionId, requestId, eventSequence: 1, rewardAmount: 1, ...override,
      }, 'verified-viewer')).toThrow(expect.objectContaining({ code: 'INVALID_REWARD_INPUT', status: 400 }));
    }
  });

  it('reconciles consistent one-ticket totals and holds inconsistent close reports', () => {
    const close = (summary: Record<string, unknown>) => rewardRpcRequest('shareClose', { sessionId, summary }, 'viewer').args;
    expect(close({ sentRewardsCount: 3, sentRewardAmount: 3, rewardUnit: '강아지 티켓' }))
      .toMatchObject({ p_total_reward_amount: 3 });
    expect(close({ sentRewardsCount: 3 })).toMatchObject({ p_total_reward_amount: 3 });
    expect(close({ sentRewardsCount: 0 })).toMatchObject({ p_total_reward_amount: 0 });
    expect(close({ sentRewardsCount: 3, sentRewardAmount: 6 }))
      .toMatchObject({ p_total_reward_amount: null });
    for (const summary of [{}, { sentRewardsCount: -1 }, { sentRewardsCount: '1' },
      { sentRewardsCount: 1, rewardUnit: '포인트' }]) {
      expect(() => close(summary)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  it('preserves earned balances and credits when new reward starts are disabled', () => {
    const state: RewardDatabaseState = {
      bonusTickets: 7, adsCompletedToday: 2, adsRemainingToday: 0,
      adsEnabled: false, shareEnabled: false, serverNow: '2026-09-05T03:00:00.000Z',
      adRewards: [{ sessionId, petId, status: 'completed', canRebind: true },
        { sessionId: requestId, petId, status: 'started' }],
    };
    const status = rewardStatusPayload(state, { remaining: 2, nextChargeAt: null }, { ads: true, share: true });
    expect(status.capabilities).toEqual({ ads: false, share: false });
    expect(status.allowance).toMatchObject({ remaining: 2, bonusTickets: 7, rewardedUsed: 2, rewardedRemaining: 0 });
    expect(status.adCredits).toEqual([{ sessionId, petId, canRebind: true }]);
    expect(status.serverNow).toBe(state.serverNow);
  });

  it('abandons a lost native close with an explicitly unknown total rather than a fabricated reward count', () => {
    const request = rewardRpcRequest('shareClose', { sessionId, abandoned: true, summary: null }, 'verified-viewer');
    expect(request).toEqual({ name: 'close_pet_share_reward',
      args: { p_owner_hash: 'verified-viewer', p_session_id: sessionId, p_total_reward_amount: null } });
    for (const body of [{ sessionId, summary: null }, { sessionId, abandoned: false, summary: null },
      { sessionId, abandoned: 'true', summary: null }, { sessionId, abandoned: true }]) {
      expect(() => rewardRpcRequest('shareClose', body, 'verified-viewer'))
        .toThrow(expect.objectContaining({ code: 'INVALID_REWARD_INPUT', status: 400 }));
    }
  });

  it('returns actionable conflict errors for mixed old/new AIT requests', () => {
    expect(rewardRpcError({ message: 'REWARDED_LIMIT_REACHED' }))
      .toMatchObject({ status: 409, code: 'REWARDED_LIMIT_REACHED' });
    expect(rewardRpcError({ message: 'ADS_DISABLED' })).toMatchObject({ status: 403, code: 'ADS_DISABLED' });
    expect(rewardRpcError({ message: 'AD_REWARD_UNAVAILABLE' }))
      .toMatchObject({ status: 409, code: 'AD_REWARD_UNAVAILABLE' });
  });

  it('does not expose internal database errors in user copy', () => {
    const error = rewardRpcError({ message: 'connection failed internal-db-host password details' });
    expect(error).toMatchObject({ status: 503, code: 'REWARD_UNAVAILABLE' });
    expect(error.message).not.toContain('internal-db-host');
  });
});
