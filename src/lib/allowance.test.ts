import {
  consumeAllowance,
  emptyAllowance,
  getKstDate,
  grantUploadCredit,
  hasUploadBonus,
  nextUnlockMethod,
  readAllowance,
  regularRemainingCount,
  remainingCount,
} from './allowance';

describe('daily allowance', () => {
  it('starts with one free and two rewarded reveals', () => {
    const value = emptyAllowance(new Date('2026-08-23T00:00:00Z'));
    expect(nextUnlockMethod(value)).toBe('FREE');
    expect(remainingCount(value)).toBe(3);
  });

  it('requires rewarded unlock after free reveal', () => {
    const afterFree = consumeAllowance(emptyAllowance(), 'FREE');
    expect(nextUnlockMethod(afterFree)).toBe('REWARDED');
    expect(remainingCount(afterFree)).toBe(2);
  });

  it('does not offer rewarded entries before ads are approved', () => {
    const afterFree = consumeAllowance(emptyAllowance(), 'FREE');
    expect(nextUnlockMethod(afterFree, undefined, false)).toBeNull();
    expect(regularRemainingCount(afterFree, false)).toBe(0);
  });

  it('stops after two rewarded reveals', () => {
    let value = consumeAllowance(emptyAllowance(), 'FREE');
    value = consumeAllowance(value, 'REWARDED');
    value = consumeAllowance(value, 'REWARDED');
    expect(nextUnlockMethod(value)).toBeNull();
    expect(remainingCount(value)).toBe(0);
    expect(() => consumeAllowance(value, 'REWARDED')).toThrow();
  });

  it('grants exactly one extra reveal after a photo upload', () => {
    let value = consumeAllowance(emptyAllowance(), 'FREE');
    value = grantUploadCredit(value, 'my-dog');
    expect(nextUnlockMethod(value, 'another-dog')).toBe('REWARDED');
    expect(nextUnlockMethod(value, 'my-dog')).toBe('UPLOAD');
    expect(remainingCount(value)).toBe(3);
    expect(regularRemainingCount(value)).toBe(2);
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
    expect(afterUpload.freeUsed).toBe(false);
    expect(nextUnlockMethod(afterUpload, 'public-dog')).toBe('FREE');
  });

  it('uses the Korea date boundary', () => {
    expect(getKstDate(new Date('2026-08-22T15:01:00Z'))).toBe('2026-08-23');
  });

  it('normalizes an older saved rewarded count to the new daily limit', () => {
    const now = new Date('2026-08-23T00:00:00Z');
    const storage = {
      getItem: () => JSON.stringify({
        date: getKstDate(now), freeUsed: true, rewardedUsed: 3, uploadCredit: false, uploadUsed: false,
      }),
    };
    const value = readAllowance(storage, now);
    expect(value.rewardedUsed).toBe(2);
    expect(remainingCount(value)).toBe(0);
  });
});
