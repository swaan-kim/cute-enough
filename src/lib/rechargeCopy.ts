const MINUTE_MS = 60_000;

/**
 * 다음 무료 이용권 충전 시각을 홈 카드에 보여줄 짧은 문구로 만든다.
 * 초 단위를 노출하지 않고 남은 분을 올림해, 시간이 거꾸로 가는 느낌을 피한다.
 */
export function formatRechargeCountdown(nextChargeAt: string | undefined, now = new Date()): string | undefined {
  if (!nextChargeAt) return undefined;
  const target = new Date(nextChargeAt).getTime();
  if (!Number.isFinite(target)) return undefined;

  const remainingMs = Math.max(0, target - now.getTime());
  if (remainingMs < MINUTE_MS) return '곧 1개 충전';

  const totalMinutes = Math.ceil(remainingMs / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}분 뒤 1개 충전`;
  if (minutes === 0) return `${hours}시간 뒤 1개 충전`;
  return `${hours}시간 ${minutes}분 뒤 1개 충전`;
}

export const RECHARGE_COPY_REFRESH_MS = MINUTE_MS;
export const FREE_ALLOWANCE_DISPLAY_CAPACITY = 2;
