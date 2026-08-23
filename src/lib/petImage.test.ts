import { describe, expect, it } from 'vitest';
import { analyzePixelColors } from './petImage';

function solid(r: number, g: number, b: number, count = 20) {
  return new Uint8ClampedArray(Array.from({ length: count }, () => [r, g, b, 255]).flat());
}

describe('local pet image color analysis', () => {
  it('classifies warm mid-tone pixels as caramel', () => {
    expect(analyzePixelColors(solid(172, 105, 50)).baseColor).toBe('caramel');
  });

  it('classifies low-luminance pixels as black and reports brightness', () => {
    const result = analyzePixelColors(solid(25, 24, 23));
    expect(result.baseColor).toBe('black');
    expect(result.brightness).toBeLessThan(40);
  });

  it('rejects fully transparent images', () => {
    expect(() => analyzePixelColors(new Uint8ClampedArray([10, 20, 30, 0]))).toThrow('색상을 읽지 못했어요');
  });
});
