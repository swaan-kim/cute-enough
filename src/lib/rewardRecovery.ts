import type { ShareCloseSummary } from '../types';

const STORAGE_KEY = 'cute-enough:reward-recovery:v1';
const START_KEY = 'cute-enough:reward-starts:v1';
const ACTIVE_KEY = 'cute-enough:reward-native-sessions:v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type RewardRecoveryJob =
  | { kind: 'adComplete'; requestId: string; sessionId: string; petId: string }
  | { kind: 'adCancel'; requestId: string; sessionId: string }
  | { kind: 'shareReward'; requestId: string; sessionId: string; rewardAmount: number; eventSequence: number }
  | { kind: 'shareClose'; requestId: string; sessionId: string; summary: ShareCloseSummary | null };

export type ActiveRewardSession = { kind: 'ad' | 'share'; sessionId: string };

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
    return jobs.filter((job): job is RewardRecoveryJob => job && typeof job === 'object'
      && ['adComplete', 'adCancel', 'shareReward', 'shareClose'].includes(job.kind)
      && typeof job.sessionId === 'string' && typeof job.requestId === 'string');
  } catch { return []; }
}

/** Must succeed before starting a native reward flow; otherwise recovery is unavailable. */
export function assertRewardStorage(storage: StorageLike = localStorage): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(readRewardRecovery(storage))); }
  catch { throw new Error('보상을 안전하게 저장하지 못했어요. 앱을 다시 열어 주세요.'); }
}

export function enqueueRewardRecovery(job: RewardRecoveryJob, storage: StorageLike = localStorage): void {
  const jobs = readRewardRecovery(storage);
  if (!jobs.some((item) => item.requestId === job.requestId)) jobs.push(job);
  try { storage.setItem(STORAGE_KEY, JSON.stringify(jobs)); }
  catch { throw new Error('보상 기록을 저장하지 못했어요. 이 화면을 닫지 말고 다시 시도해 주세요.'); }
}

export function acknowledgeRewardRecovery(requestId: string, storage: StorageLike = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(readRewardRecovery(storage).filter((job) => job.requestId !== requestId)));
}

export function canReplayRewardJob(job: RewardRecoveryJob, jobs: RewardRecoveryJob[]): boolean {
  return job.kind !== 'shareClose' || !jobs.some((other) => other.kind === 'shareReward' && other.sessionId === job.sessionId);
}

/** Retry an uncertain session creation with the same request, without opening native UI automatically. */
export function getRewardStartRequest(key: string, storage: StorageLike = localStorage): string {
  let starts: Record<string, string> = {};
  try {
    const parsed = JSON.parse(storage.getItem(START_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) starts = parsed;
  } catch { /* A new request is safe when no valid pending start was recorded. */ }
  if (typeof starts[key] !== 'string') starts[key] = crypto.randomUUID();
  storage.setItem(START_KEY, JSON.stringify(starts));
  return starts[key];
}

export function acknowledgeRewardStart(key: string, storage: StorageLike = localStorage): void {
  const starts = JSON.parse(storage.getItem(START_KEY) ?? '{}') as Record<string, string>;
  delete starts[key];
  storage.setItem(START_KEY, JSON.stringify(starts));
}
