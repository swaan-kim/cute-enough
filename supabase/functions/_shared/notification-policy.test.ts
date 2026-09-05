import { describe, expect, it } from 'vitest';
import { nextZeroBalanceCharge, notificationKstDate, notificationNotBefore, notificationSuppressionReason } from './notification-policy';

describe('recharge reminder boundaries', () => {
  it.each([
    ['2026-09-05T07:59:59+09:00', '2026-09-05T08:00:00+09:00'],
    ['2026-09-05T08:00:00+09:00', '2026-09-05T08:00:00+09:00'],
    ['2026-09-05T20:59:59+09:00', '2026-09-05T20:59:59+09:00'],
    ['2026-09-05T21:00:00+09:00', '2026-09-06T08:00:00+09:00'],
    ['2026-09-05T23:59:59+09:00', '2026-09-06T08:00:00+09:00'],
  ])('defers only quiet hours: %s', (charge, expected) => {
    expect(notificationNotBefore(new Date(charge)).toISOString()).toBe(new Date(expected).toISOString());
  });

  it('schedules only 0→1 from the natural anchor, even near midnight', () => {
    expect(nextZeroBalanceCharge(0, new Date('2026-09-05T23:30:00+09:00'))?.toISOString()).toBe('2026-09-05T17:30:00.000Z');
    expect(nextZeroBalanceCharge(1, new Date())).toBeNull();
    expect(nextZeroBalanceCharge(2, new Date())).toBeNull();
    expect(notificationKstDate(new Date('2026-09-05T15:00:00Z'))).toBe('2026-09-06');
  });

  const ready = { now: new Date('2026-09-06T08:00:00+09:00'), chargeAt: new Date('2026-09-05T23:00:00+09:00'), consented: true, freeRemaining: 2, completedToday: false, attemptedToday: false };
  it('allows an unvisited overnight recharge at 08:00 without requiring a second charge event', () => {
    expect(notificationSuppressionReason(ready)).toBeNull();
  });
  it.each([
    [{ consented: false }, 'opted_out'],
    [{ freeRemaining: 0 }, 'already_used'],
    [{ lastVisitAt: new Date('2026-09-05T23:00:00+09:00') }, 'visited_since_charge'],
    [{ completedToday: true }, 'daily_complete'],
    [{ attemptedToday: true }, 'daily_limit'],
    [{ now: new Date('2026-09-06T07:59:59+09:00') }, 'quiet_hours'],
  ])('rechecks suppression before an overnight send: %j', (patch, reason) => {
    expect(notificationSuppressionReason({ ...ready, ...patch })).toBe(reason);
  });
});
