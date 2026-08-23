import { describe, expect, it } from 'vitest';
import { getPetExpression } from './petExpression';

describe('getPetExpression', () => {
  it('keeps the same expression for the same dog', () => {
    expect(getPetExpression('approved-dog-42')).toEqual(getPetExpression('approved-dog-42'));
  });

  it('uses the planned expressions for the sample dogs', () => {
    expect(getPetExpression('sample-bori')).toEqual({ browStyle: 'caterpillar', tongueShape: 'round' });
    expect(getPetExpression('sample-mandu')).toEqual({ browStyle: 'none', tongueShape: 'drop' });
    expect(getPetExpression('sample-kong')).toEqual({ browStyle: 'soft', tongueShape: 'side' });
    expect(getPetExpression('sample-dubu')).toEqual({ browStyle: 'angled', tongueShape: 'wide' });
    expect(getPetExpression('sample-maru')).toEqual({ browStyle: 'soft', tongueShape: 'round' });
  });

  it('covers all planned brow and tongue variants across the sample dogs', () => {
    const expressions = ['sample-bori', 'sample-mandu', 'sample-kong', 'sample-dubu', 'sample-maru'].map(getPetExpression);
    expect(new Set(expressions.map(({ browStyle }) => browStyle))).toEqual(new Set(['none', 'soft', 'caterpillar', 'angled']));
    expect(new Set(expressions.map(({ tongueShape }) => tongueShape))).toEqual(new Set(['drop', 'round', 'wide', 'side']));
  });

  it('falls back safely when a preview has no pet id yet', () => {
    expect(getPetExpression()).toEqual({ browStyle: 'none', tongueShape: 'drop' });
  });
});
