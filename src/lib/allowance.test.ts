import {
  consumeAllowance,
  emptyAllowance,
  getKstDate,
  grantUploadCredit,
  hasUploadBonus,
  isAllowanceForToday,
  millisecondsUntilNextKstDay,
  millisecondsUntilNextFreeRecharge,
  nextUnlockMethod,
  readAllowance,
  refreshAllowance,
  regularRemainingCount,
  remainingCount,
} from './allowance';

describe('three-hour free allowance', () => {
  it('starts with two free reveals without counting future ads as charged allowance', () => {
    const value = emptyAllowance(new Date('2026-08-23T00:00:00Z'));
    expect(nextUnlockMethod(value)).toBe('FREE');
    expect(regularRemainingCount(value)).toBe(2);
    expect(remainingCount(value)).toBe(2);
  });

  it('uses both free reveals before requiring a rewarded unlock', () => {
    const now = new Date('2026-08-28T00:00:00Z');
    const afterFirst = consumeAllowance(emptyAllowance(now), 'FREE', now);
    expect(nextUnlockMethod(afterFirst)).toBe('FREE');
    expect(regularRemainingCount(afterFirst)).toBe(1);
    const afterSecond = consumeAllowance(afterFirst, 'FREE', now);
    expect(nextUnlockMethod(afterSecond)).toBe('REWARDED');
    expect(regularRemainingCount(afterSecond)).toBe(0);
    expect(() => consumeAllowance(afterSecond, 'FREE', now)).toThrow('이용권은 3시간마다 한 마리씩 충전돼요.');
  });

  it('recharges one after three hours and never stores more than two', () => {
    const start = new Date('2026-08-28T00:00:00Z');
    let value = consumeAllowance(emptyAllowance(start), 'FREE', start);
    value = consumeAllowance(value, 'FREE', start);

    expect(regularRemainingCount(value, new Date('2026-08-28T02:59:59Z'))).toBe(0);
    expect(millisecondsUntilNextFreeRecharge(value, start)).toBe(3 * 60 * 60 * 1000);

    const afterThreeHours = refreshAllowance(value, new Date('2026-08-28T03:00:00Z'));
    expect(regularRemainingCount(afterThreeHours, new Date('2026-08-28T03:00:00Z'))).toBe(1);
    expect(afterThreeHours.nextChargeAt).toBe('2026-08-28T06:00:00.000Z');

    const afterLongAbsence = refreshAllowance(afterThreeHours, new Date('2026-08-28T12:00:00Z'));
    expect(regularRemainingCount(afterLongAbsence, new Date('2026-08-28T12:00:00Z'))).toBe(2);
    expect(afterLongAbsence.nextChargeAt).toBeUndefined();
  });

  it('does not offer rewarded entries before ads are approved', () => {
    const afterFirst = consumeAllowance(emptyAllowance(), 'FREE');
    const afterSecond = consumeAllowance(afterFirst, 'FREE');
    expect(nextUnlockMethod(afterSecond, undefined, false)).toBeNull();
    expect(regularRemainingCount(afterSecond)).toBe(0);
  });

  it('each completed ad unlocks one extra reveal and stops after two rewarded reveals', () => {
    let value = consumeAllowance(emptyAllowance(), 'FREE');
    value = consumeAllowance(value, 'FREE');
    value = consumeAllowance(value, 'REWARDED');
    expect(nextUnlockMethod(value)).toBe('REWARDED');
    value = consumeAllowance(value, 'REWARDED');
    expect(nextUnlockMethod(value)).toBeNull();
    expect(remainingCount(value)).toBe(0);
    expect(() => consumeAllowance(value, 'REWARDED')).toThrow();
  });

  it('grants exactly one extra reveal after a photo upload', () => {
    let value = consumeAllowance(emptyAllowance(), 'FREE');
    value = consumeAllowance(value, 'FREE');
    value = grantUploadCredit(value, 'my-dog');
    expect(nextUnlockMethod(value, 'another-dog')).toBe('REWARDED');
    expect(nextUnlockMethod(value, 'my-dog')).toBe('UPLOAD');
    expect(remainingCount(value)).toBe(1);
    expect(regularRemainingCount(value)).toBe(0);
    expect(hasUploadBonus(value)).toBe(true);
    value = consumeAllowance(value, 'UPLOAD');
    expect(hasUploadBonus(value)).toBe(false);
    expect(nextUnlockMethod(value)).toBe('REWARDED');
    expect(() => consumeAllowance(value, 'UPLOAD')).toThrow();
  });

  it('uses the uploaded dogs reward before preserving the regular free reveal', () => {
    const value = grantUploadCredit(emptyAllowance(), 'my-dog');
    expect(nextUnlockMethod(value, 'my-dog')).toBe('UPLOAD');
    expect(nextUnlockMethod(value, 'public-dog')).toBe('FREE');
    const afterUpload = consumeAllowance(value, 'UPLOAD');
    expect(afterUpload.freeUsed).toBe(0);
    expect(nextUnlockMethod(afterUpload, 'public-dog')).toBe('FREE');
  });

  it('uses the Korea date boundary', () => {
    expect(getKstDate(new Date('2026-08-22T15:01:00Z'))).toBe('2026-08-23');
    expect(millisecondsUntilNextKstDay(new Date('2026-08-23T14:59:59Z'))).toBe(1000);
  });

  it('resets daily ad/upload fields at KST midnight without gifting free tickets', () => {
    const now = new Date('2026-08-23T15:00:01Z');
    const storage = {
      getItem: () => JSON.stringify({
        date: '2026-08-23',
        freeUsed: 2,
        remaining: 0,
        nextChargeAt: '2026-08-23T17:00:00.000Z',
        rewardedUsed: 2,
        uploadCredit: true,
        uploadUsed: false,
        uploadRewardPetId: 'my-dog',
      }),
    };
    const value = readAllowance(storage, now);
    expect(isAllowanceForToday(value, now)).toBe(true);
    expect(value).toMatchObject({
      date: '2026-08-24', freeUsed: 2, remaining: 0, rewardedUsed: 0,
      uploadCredit: false, uploadUsed: false,
    });
    expect(value.uploadRewardPetId).toBeUndefined();
    expect(regularRemainingCount(value, now)).toBe(0);
  });

  it('normalizes older boolean free usage and saved rewarded count', () => {
    const now = new Date('2026-08-23T00:00:00Z');
    const storage = {
      getItem: () => JSON.stringify({
        date: getKstDate(now), freeUsed: true, rewardedUsed: 3, uploadCredit: false, uploadUsed: false,
      }),
    };
    const value = readAllowance(storage, now);
    expect(value.freeUsed).toBe(1);
    expect(value.rewardedUsed).toBe(2);
    expect(regularRemainingCount(value, now)).toBe(1);
  });
});
