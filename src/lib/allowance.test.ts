import { consumeAllowance, emptyAllowance, getKstDate, grantUploadCredit, nextUnlockMethod, remainingCount } from './allowance';

describe('daily allowance', () => {
  it('starts with one free and three rewarded reveals', () => {
    const value = emptyAllowance(new Date('2026-08-23T00:00:00Z'));
    expect(nextUnlockMethod(value)).toBe('FREE');
    expect(remainingCount(value)).toBe(4);
  });

  it('requires rewarded unlock after free reveal', () => {
    const afterFree = consumeAllowance(emptyAllowance(), 'FREE');
    expect(nextUnlockMethod(afterFree)).toBe('REWARDED');
    expect(remainingCount(afterFree)).toBe(3);
  });

  it('stops after three rewarded reveals', () => {
    let value = consumeAllowance(emptyAllowance(), 'FREE');
    value = consumeAllowance(value, 'REWARDED');
    value = consumeAllowance(value, 'REWARDED');
    value = consumeAllowance(value, 'REWARDED');
    expect(nextUnlockMethod(value)).toBeNull();
    expect(remainingCount(value)).toBe(0);
    expect(() => consumeAllowance(value, 'REWARDED')).toThrow();
  });

  it('grants exactly one extra reveal after a photo upload', () => {
    let value = consumeAllowance(emptyAllowance(), 'FREE');
    value = grantUploadCredit(value);
    expect(nextUnlockMethod(value)).toBe('UPLOAD');
    expect(remainingCount(value)).toBe(4);
    value = consumeAllowance(value, 'UPLOAD');
    expect(nextUnlockMethod(value)).toBe('REWARDED');
    expect(() => consumeAllowance(value, 'UPLOAD')).toThrow();
  });

  it('uses the Korea date boundary', () => {
    expect(getKstDate(new Date('2026-08-22T15:01:00Z'))).toBe('2026-08-23');
  });
});
