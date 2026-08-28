import { describe, expect, it } from 'vitest';
import { formatRechargeCountdown } from './rechargeCopy';

describe('formatRechargeCountdown', () => {
  const now = new Date('2026-08-28T00:00:00.000Z');

  it('시간과 분을 짧게 표시한다', () => {
    expect(formatRechargeCountdown('2026-08-28T02:34:00.000Z', now))
      .toBe('2시간 34분 뒤 1개 충전');
  });

  it('한 시간 미만은 분만 표시한다', () => {
    expect(formatRechargeCountdown('2026-08-28T00:17:01.000Z', now))
      .toBe('18분 뒤 1개 충전');
  });

  it('충전이 임박했거나 이미 지난 경우 공통 문구를 쓴다', () => {
    expect(formatRechargeCountdown('2026-08-28T00:00:30.000Z', now)).toBe('곧 1개 충전');
    expect(formatRechargeCountdown('2026-08-27T23:59:00.000Z', now)).toBe('곧 1개 충전');
  });

  it('시각이 없거나 잘못되면 문구를 만들지 않는다', () => {
    expect(formatRechargeCountdown(undefined, now)).toBeUndefined();
    expect(formatRechargeCountdown('invalid', now)).toBeUndefined();
  });
});
