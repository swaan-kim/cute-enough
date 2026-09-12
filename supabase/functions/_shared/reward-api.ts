import { ApiError } from './api-error.ts';
import { requireUuid } from './validation.ts';

export const SHARE_REWARD_MODULE_ID = 'e5de3e72-cbfb-4b50-a050-9fd71fb4368b';
export const SHARE_REWARD_UNIT = '티켓';
// Preserve queued close reports from clients using the former display unit.
const isTicketRewardUnit = (unit: unknown) => unit === SHARE_REWARD_UNIT || unit === '강아지 티켓';

export interface RewardDatabaseState {
  bonusTickets: number;
  adsCompletedToday: number;
  adsRemainingToday: number;
  adsEnabled: boolean;
  shareEnabled: boolean;
  adRewards: Array<{ sessionId: string; petId: string; status: string; canRebind?: boolean }>;
  shareSessions?: Array<{ sessionId: string; reconciliationRequired?: boolean }>;
  shareSession?: { sessionId: string; reconciliationRequired?: boolean } | null;
  rewardPendingReview?: boolean;
  serverNow?: string;
  sessionId?: string;
}

export function rewardAllowance<T extends object>(allowance: T, state: RewardDatabaseState) {
  return {
    ...allowance,
    bonusTickets: Math.max(0, state.bonusTickets || 0),
    rewardedUsed: state.adsCompletedToday,
    rewardedLimit: 2,
    rewardedRemaining: Math.max(0, state.adsRemainingToday),
  };
}

export function rewardStatusPayload<T extends object>(
  state: RewardDatabaseState,
  allowance: T,
  flags: { ads: boolean; share: boolean },
) {
  return {
    allowance: rewardAllowance(allowance, state),
    capabilities: { ads: flags.ads && state.adsEnabled, share: flags.share && state.shareEnabled },
    adCredits: (state.adRewards ?? []).filter((row) => row.status === 'completed')
      .map(({ sessionId, petId, canRebind }) => ({ sessionId, petId, canRebind })),
    serverNow: state.serverNow ?? new Date().toISOString(),
  };
}

function positiveInteger(value: unknown, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ApiError('INVALID_REWARD_INPUT', 400, `${label}을 다시 확인해 주세요.`);
  }
  return value;
}

export function rewardRpcRequest(action: string, body: Record<string, unknown>, ownerHash: string) {
  const owner = { p_owner_hash: ownerHash };
  if (action === 'rewardStatus') return {
    name: body.albumVersion === 1 || body.albumVersion === 2 ? 'get_pet_album_reward_state' : 'get_pet_reward_state',
    args: owner,
  };
  if (action === 'rewardStart') return {
    name: body.albumVersion === 1 || body.albumVersion === 2 ? 'start_pet_album_ad_reward' : 'start_pet_ad_reward',
    args: { ...owner, p_session_id: requireUuid(body.requestId), p_pet_id: requireUuid(body.petId) },
  };
  if (action === 'shareStart') return {
    name: 'start_pet_share_reward', args: { ...owner, p_session_id: requireUuid(body.requestId) },
  };
  const session = { ...owner, p_session_id: requireUuid(body.sessionId) };
  if (action === 'rewardComplete') return { name: 'complete_pet_ad_reward', args: session };
  if (action === 'rewardCancel') return { name: 'cancel_pet_ad_reward', args: session };
  if (action === 'rewardRebind') return {
    name: body.albumVersion === 1 || body.albumVersion === 2 ? 'rebind_pet_album_ad_reward' : 'rebind_pet_ad_reward',
    args: { ...session, p_pet_id: requireUuid(body.petId) },
  };
  if (action === 'shareReward') return {
    name: 'record_pet_share_reward',
    args: {
      ...session, p_request_id: requireUuid(body.requestId),
      p_event_sequence: positiveInteger(body.eventSequence, 1_000_000, '공유 순서'),
      p_reward_amount: positiveInteger(body.rewardAmount, 1_000, '공유 보상'),
    },
  };
  if (action === 'shareClose') {
    // A restarted app can abandon a native sheet whose close callback was lost.
    // An unknown total must remain unknown: SQL closes the session and marks it
    // for reconciliation without minting tickets from an invented zero/count.
    if (body.abandoned === true && body.summary === null) return {
      name: 'close_pet_share_reward', args: { ...session, p_total_reward_amount: null },
    };
    const summary = body.summary as Record<string, unknown> | undefined;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)
      || !Number.isSafeInteger(summary.sentRewardsCount) || Number(summary.sentRewardsCount) < 0
      || Number(summary.sentRewardsCount) > 1_000_000
      || (summary.rewardUnit !== undefined && !isTicketRewardUnit(summary.rewardUnit))
      || (summary.sentRewardAmount !== undefined && (!Number.isSafeInteger(summary.sentRewardAmount)
        || Number(summary.sentRewardAmount) < 0 || Number(summary.sentRewardAmount) > 1_000_000))) {
      throw new ApiError('INVALID_REWARD_INPUT', 400, '공유 결과를 다시 확인해 주세요.');
    }
    // One ticket per recipient. Missing or inconsistent native totals are never used to mint tickets.
    const total = summary.sentRewardAmount ?? summary.sentRewardsCount;
    return {
      name: 'close_pet_share_reward',
      args: { ...session, p_total_reward_amount: total === summary.sentRewardsCount ? total : null },
    };
  }
  throw new ApiError('INVALID_ACTION', 404, '알 수 없는 보상 요청이에요.');
}

export function rewardRpcError(error: { message?: string; code?: string }): ApiError {
  const message = error.message ?? '';
  const known: Array<[string, number, string]> = [
    ['ADS_DISABLED', 403, '광고 만남은 잠시 준비 중이에요.'],
    ['REWARDED_ADS_DISABLED', 403, '광고 만남은 잠시 준비 중이에요.'],
    ['SHARE_REWARDS_DISABLED', 403, '친구 초대 보상은 잠시 준비 중이에요.'],
    ['REWARDED_LIMIT_REACHED', 409, '오늘의 광고 보상을 모두 받았어요. 티켓 충전을 기다려 주세요.'],
    ['FREE_ALLOWANCE_AVAILABLE', 409, '충전된 티켓으로 먼저 만나보세요.'],
    ['BONUS_TICKETS_AVAILABLE', 409, '보너스 티켓으로 먼저 만나보세요.'],
    ['BONUS_ALLOWANCE_AVAILABLE', 409, '보너스 티켓으로 먼저 만나보세요.'],
    ['FREE_ALLOWANCE_EMPTY', 409, '티켓이 없어요. 공유하거나 충전을 기다려 주세요.'],
    ['BONUS_TICKETS_EMPTY', 409, '사용할 보너스 티켓이 없어요.'],
    ['REWARD_SESSION_ACTIVE', 409, '진행 중인 보상을 먼저 확인해 주세요.'],
    ['AD_SESSION_ACTIVE', 409, '진행 중인 광고 결과를 먼저 확인해 주세요.'],
    ['SHARE_SESSION_ACTIVE', 409, '진행 중인 친구 초대를 먼저 닫아 주세요.'],
    ['AD_REWARD_RESELECT_UNAVAILABLE', 409, '이 광고 보상은 현재 선택한 친구에게 사용할 수 있어요.'],
    ['AD_REWARD_AVAILABLE', 409, '이미 받은 광고 보상으로 이 친구를 만나보세요.'],
    ['AD_REWARD_UNAVAILABLE', 409, '사용할 광고 보상을 아직 확인하지 못했어요. 다시 확인해 주세요.'],
    ['REWARD_NOT_COMPLETED', 409, '광고 보상을 아직 확인하고 있어요. 다시 확인해 주세요.'],
    ['PET_NOT_AVAILABLE', 404, '이 친구는 지금 만날 수 없어요.'],
    ['OWNER_PHOTO_FREE', 409, '내 강아지는 티켓 없이 바로 볼 수 있어요.'],
    ['PET_REVISIT_ACTIVE', 409, '이미 만난 친구예요. 사진을 다시 열어 주세요.'],
    ['PHOTO_NOT_REVEALABLE', 404, '이 친구는 지금 만날 수 없어요.'],
    ['REQUEST_MISMATCH', 409, '이전 요청과 다른 내용이에요. 다시 선택해 주세요.'],
    ['REVEAL_REQUEST_CONFLICT', 409, '이전 사진 요청과 다른 내용이에요. 다시 선택해 주세요.'],
    ['REWARD_REQUEST_CONFLICT', 409, '이전 보상 요청과 다른 내용이에요. 보상 내역을 다시 확인해 주세요.'],
    ['REWARD_SESSION_CONFLICT', 409, '이전 보상 세션과 다른 내용이에요. 다시 선택해 주세요.'],
    ['SHARE_CLOSE_CONFLICT', 409, '공유 결과가 이전 기록과 달라요. 보상 내역을 다시 확인해 주세요.'],
    ['REWARD_SESSION_NOT_FOUND', 404, '보상 기록을 찾지 못했어요.'],
    ['AD_SESSION_NOT_FOUND', 404, '광고 보상 기록을 찾지 못했어요.'],
    ['SHARE_SESSION_NOT_FOUND', 404, '친구 초대 기록을 찾지 못했어요.'],
    ['INVALID_REVEAL_DATE', 409, '날짜가 바뀌었어요. 집을 새로 불러와 주세요.'],
    ['PET_REVISIT_EXPIRED', 403, '다시 만날 수 있는 시간이 지났어요. 티켓으로 다시 만나주세요.'],
  ];
  for (const [code, status, copy] of known) if (message.includes(code)) return new ApiError(code, status, copy);
  if (/INVALID_|MISMATCH|NOT_OWNED|FORBIDDEN/.test(message)) return new ApiError('INVALID_REWARD_INPUT', 400, '보상 요청을 다시 확인해 주세요.');
  return new ApiError('REWARD_UNAVAILABLE', 503, '보상 결과를 아직 확인하지 못했어요. 다시 확인해 주세요.');
}
