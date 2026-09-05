const HOUR = 3_600_000;
const KST_OFFSET = 9 * HOUR;

export const RECHARGE_NOTIFICATION_COPY = {
  title: '이용권 충전',
  body: '강아지 이용권이 충전됐어요.',
} as const;

/** Earliest allowed send time, preserving 08:00 inclusive and 21:00 exclusive. */
export function notificationNotBefore(chargeAt: Date): Date {
  const local = new Date(chargeAt.getTime() + KST_OFFSET);
  const hour = local.getUTCHours();
  if (hour >= 8 && hour < 21) return new Date(chargeAt);
  if (hour >= 21) local.setUTCDate(local.getUTCDate() + 1);
  local.setUTCHours(8, 0, 0, 0);
  return new Date(local.getTime() - KST_OFFSET);
}

export function notificationKstDate(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET).toISOString().slice(0, 10);
}

/** Only the first natural recharge after the balance became zero creates a job. */
export function nextZeroBalanceCharge(balance: number, lastRefillAt: Date): Date | null {
  return balance === 0 ? new Date(lastRefillAt.getTime() + 3 * HOUR) : null;
}

export type NotificationEligibility = {
  now: Date;
  chargeAt: Date;
  consented: boolean;
  freeRemaining: number;
  lastVisitAt?: Date;
  completedToday: boolean;
  attemptedToday: boolean;
};

export function notificationSuppressionReason(input: NotificationEligibility): string | null {
  if (!input.consented) return 'opted_out';
  if (input.now < input.chargeAt) return 'not_charged';
  if (input.now < notificationNotBefore(input.now)) return 'quiet_hours';
  if (input.freeRemaining <= 0) return 'already_used';
  if (input.lastVisitAt && input.lastVisitAt >= input.chargeAt) return 'visited_since_charge';
  if (input.completedToday) return 'daily_complete';
  if (input.attemptedToday) return 'daily_limit';
  return null;
}
