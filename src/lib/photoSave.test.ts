import { describe, expect, it } from 'vitest';
import { buildBrandedPhotoFileName, getBrandedPhotoLabel } from './photoSave';

describe('branded photo filename', () => {
  it('uses the Korea date and keeps the short pet name', () => {
    expect(buildBrandedPhotoFileName('하늘', new Date('2026-08-27T15:00:01Z')))
      .toBe('하늘-20260828.jpg');
  });

  it('removes unsafe filename characters and limits the name to four characters', () => {
    expect(buildBrandedPhotoFileName('구/르:미멍멍', new Date('2026-08-27T00:00:00Z')))
      .toBe('구르미멍-20260827.jpg');
  });

  it('uses the pet name instead of a service word in the photo label', () => {
    expect(getBrandedPhotoLabel('하늘')).toBe('하늘');
    expect(getBrandedPhotoLabel()).toBe('강아지');
  });
});
