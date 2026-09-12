import type { ShareCloseSummary } from '../types';

const STORAGE_KEY = 'cute-enough:reward-recovery:v1';
const START_KEY = 'cute-enough:reward-starts:v1';
const ACTIVE_KEY = 'cute-enough:reward-native-sessions:v1';
const AD_START_KEY = 'cute-enough:reward-ad-starts:v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type RewardRecoveryJob =
  | { kind: 'adComplete'; requestId: string; sessionId: string; petId: string }
  | { kind: 'adCancel'; requestId: string; sessionId: string }
  | { kind: 'shareReward'; requestId: string; sessionId: string; rewardAmount: number; eventSequence: number }
  | { kind: 'shareClose'; requestId: string; sessionId: string; summary: ShareCloseSummary | null };

export type ActiveRewardSession = { kind: 'ad' | 'share'; sessionId: string };

export type PendingAdStart =
  | { petId: string; requestId: string; phase: 'starting' }
  | { petId: string; requestId: string; phase: 'native'; sessionId: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readRewardStartRequests(storage: StorageLike): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(START_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isNonEmptyString(value)));
  } catch { return {}; }
}

/** Includes starts left by older versions which only saved ad:<petId> request IDs. */
export function readPendingAdStarts(storage: StorageLike = localStorage): PendingAdStart[] {
  const starts: PendingAdStart[] = [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(AD_START_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (!item || typeof item !== 'object' || !isNonEmptyString(item.petId) || !isNonEmptyString(item.requestId)) continue;
        if (item.phase !== 'starting' && (item.phase !== 'native' || !isNonEmptyString(item.sessionId))) continue;
        const existing = starts.findIndex((start) => start.petId === item.petId && start.requestId === item.requestId);
        const start: PendingAdStart = item.phase === 'native'
          ? { petId: item.petId, requestId: item.requestId, phase: 'native', sessionId: item.sessionId }
          : { petId: item.petId, requestId: item.requestId, phase: 'starting' };
        if (existing < 0) starts.push(start);
        else if (start.phase === 'native') starts[existing] = start;
      }
    }
  } catch { /* The legacy request map can still recover an interrupted start. */ }
  for (const [key, requestId] of Object.entries(readRewardStartRequests(storage))) {
    if (!key.startsWith('ad:') || !isNonEmptyString(key.slice(3))) continue;
    const petId = key.slice(3);
    if (!starts.some((start) => start.petId === petId && start.requestId === requestId)) {
      starts.push({ petId, requestId, phase: 'starting' });
    }
  }
  return starts;
}

/** Must finish before the start request is sent. A failed second write retains the legacy ID. */
export function rememberPendingAdStart(petId: string, storage: StorageLike = localStorage): PendingAdStart {
  if (!isNonEmptyString(petId)) throw new Error('광고를 시작할 친구를 확인하지 못했어요.');
  const requests = readRewardStartRequests(storage);
  const starts = readPendingAdStarts(storage);
  const existing = starts.find((item) => item.petId === petId && item.requestId === requests[`ad:${petId}`])
    ?? starts.find((item) => item.petId === petId);
  const start: PendingAdStart = existing ?? { petId, requestId: crypto.randomUUID(), phase: 'starting' };
  requests[`ad:${petId}`] = start.requestId;
  storage.setItem(START_KEY, JSON.stringify(requests));
  if (!existing) starts.push(start);
  storage.setItem(AD_START_KEY, JSON.stringify(starts));
  return start;
}

/** Records native eligibility; recovery may retire this session but must never show an ad. */
export function markPendingAdStartNative(petId: string, requestId: string, sessionId: string, storage: StorageLike = localStorage): void {
  if (![petId, requestId, sessionId].every(isNonEmptyString)) throw new Error('광고 시작 기록을 확인하지 못했어요.');
  const starts = readPendingAdStarts(storage).filter((item) => item.petId !== petId || item.requestId !== requestId);
  storage.setItem(AD_START_KEY, JSON.stringify([...starts, { petId, requestId, phase: 'native', sessionId }]));
}

/** Clear only after a terminal job is durable or the server confirms a terminal result. */
export function forgetPendingAdStart(petId: string, requestId: string, storage: StorageLike = localStorage): void {
  const starts = readRewardStartRequests(storage);
  if (starts[`ad:${petId}`] === requestId) delete starts[`ad:${petId}`];
  // Remove the fallback first: an interrupted cleanup may replay an old ID, never create a new one.
  storage.setItem(START_KEY, JSON.stringify(starts));
  storage.setItem(AD_START_KEY, JSON.stringify(readPendingAdStarts(storage)
    .filter((item) => item.petId !== petId || item.requestId !== requestId)));
}

export function readActiveRewardSessions(storage: StorageLike = localStorage): ActiveRewardSession[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(ACTIVE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is ActiveRewardSession => Boolean(item && typeof item === 'object'
      && ['ad', 'share'].includes(item.kind) && typeof item.sessionId === 'string')) : [];
  } catch { return []; }
}

/** Persist before opening native UI so a process restart can retire an interrupted session. */
export function rememberActiveRewardSession(session: ActiveRewardSession, storage: StorageLike = localStorage): void {
  const sessions = readActiveRewardSessions(storage).filter((item) => item.sessionId !== session.sessionId);
  storage.setItem(ACTIVE_KEY, JSON.stringify([...sessions, session]));
}

export function forgetActiveRewardSession(sessionId: string, storage: StorageLike = localStorage): void {
  storage.setItem(ACTIVE_KEY, JSON.stringify(readActiveRewardSessions(storage).filter((item) => item.sessionId !== sessionId)));
}

export function readRewardRecovery(storage: StorageLike = localStorage): RewardRecoveryJob[] {
  try {
    const jobs: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(jobs)) return [];
    const valid = jobs.filter((job): job is RewardRecoveryJob => job && typeof job === 'object'
      && ['adComplete', 'adCancel', 'shareReward', 'shareClose'].includes(job.kind)
      && typeof job.sessionId === 'string' && typeof job.requestId === 'string');
    const earned = new Set(valid.filter((job) => job.kind === 'adComplete').map((job) => job.sessionId));
    return valid.filter((job) => job.kind !== 'adCancel' || !earned.has(job.sessionId));
  } catch { return []; }
}

/** Must succeed before starting a native reward flow; otherwise recovery is unavailable. */
export function assertRewardStorage(storage: StorageLike = localStorage): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(readRewardRecovery(storage))); }
  catch { throw new Error('보상을 안전하게 저장하지 못했어요. 앱을 다시 열어 주세요.'); }
}

export function enqueueRewardRecovery(job: RewardRecoveryJob, storage: StorageLike = localStorage): void {
  let jobs = readRewardRecovery(storage);
  if (job.kind === 'adCancel' && jobs.some((item) => item.kind === 'adComplete' && item.sessionId === job.sessionId)) return;
  if (job.kind === 'adComplete') jobs = jobs.filter((item) => item.kind !== 'adCancel' || item.sessionId !== job.sessionId);
  if (!jobs.some((item) => item.requestId === job.requestId)) jobs.push(job);
  try { storage.setItem(STORAGE_KEY, JSON.stringify(jobs)); }
  catch { throw new Error('보상 기록을 저장하지 못했어요. 이 화면을 닫지 말고 다시 시도해 주세요.'); }
}

export function acknowledgeRewardRecovery(requestId: string, storage: StorageLike = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(readRewardRecovery(storage).filter((job) => job.requestId !== requestId)));
}

export function canReplayRewardJob(job: RewardRecoveryJob, jobs: RewardRecoveryJob[]): boolean {
  if (job.kind === 'adCancel') {
    return jobs.some((other) => other.kind === 'adCancel' && other.requestId === job.requestId && other.sessionId === job.sessionId)
      && !jobs.some((other) => other.kind === 'adComplete' && other.sessionId === job.sessionId);
  }
  return job.kind !== 'shareClose' || !jobs.some((other) => other.kind === 'shareReward' && other.sessionId === job.sessionId);
}

/** Retry an uncertain session creation with the same request, without opening native UI automatically. */
export function getRewardStartRequest(key: string, storage: StorageLike = localStorage): string {
  const starts = readRewardStartRequests(storage);
  if (!Object.hasOwn(starts, key)) starts[key] = crypto.randomUUID();
  storage.setItem(START_KEY, JSON.stringify(starts));
  return starts[key];
}

export function acknowledgeRewardStart(key: string, storage: StorageLike = localStorage): void {
  const starts = readRewardStartRequests(storage);
  delete starts[key];
  storage.setItem(START_KEY, JSON.stringify(starts));
}
