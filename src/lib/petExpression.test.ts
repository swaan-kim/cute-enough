import { describe, expect, it } from 'vitest';
import { getPetExpression } from './petExpression';

describe('getPetExpression', () => {
  it('keeps the same expression for the same dog', () => {
    expect(getPetExpression('approved-dog-42')).toEqual(getPetExpression('approved-dog-42'));
  });

  it('uses the planned expressions for the sample dogs', () => {
    expect(getPetExpression('sample-haneul')).toEqual({ browStyle: 'none', tongueShape: 'wide' });
    expect(getPetExpression('sample-gureumi')).toEqual({ browStyle: 'soft', tongueShape: 'round' });
  });

  it('keeps the same expressions after the initial dogs are seeded with UUIDs', () => {
    expect(getPetExpression('d5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf003')).toEqual(getPetExpression('sample-haneul'));
    expect(getPetExpression('d5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001')).toEqual(getPetExpression('sample-gureumi'));
  });

  it('falls back safely when a preview has no pet id yet', () => {
    expect(getPetExpression()).toEqual({ browStyle: 'none', tongueShape: 'drop' });
  });
});
