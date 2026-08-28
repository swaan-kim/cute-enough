import { describe, expect, it } from 'vitest';
import { orderDailyPets, prioritizeRevealedPets } from './daily-pool.ts';

const candidates = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id }));

describe('server daily pet pool', () => {
  it('is stable across requests and input query order for one user and KST date', () => {
    const first = orderDailyPets(candidates, 'owner-a', '2026-08-28');
    const reopened = orderDailyPets([...candidates].reverse(), 'owner-a', '2026-08-28');
    expect(reopened).toEqual(first);
  });

  it('changes its order for the next KST date without dropping candidates', () => {
    const today = orderDailyPets(candidates, 'owner-a', '2026-08-28');
    const tomorrow = orderDailyPets(candidates, 'owner-a', '2026-08-29');
    expect(tomorrow).not.toEqual(today);
    expect(new Set(tomorrow.map(({ id }) => id))).toEqual(new Set(candidates.map(({ id }) => id)));
  });

  it('keeps revealed pets ahead of unrevealed pets without disturbing either daily order', () => {
    const ordered = [
      { id: 'new-a', revealedToday: false },
      { id: 'seen-a', revealedToday: true },
      { id: 'new-b', revealedToday: false },
      { id: 'seen-b', revealedToday: true },
    ];

    expect(prioritizeRevealedPets(ordered).map(({ id }) => id))
      .toEqual(['seen-a', 'seen-b', 'new-a', 'new-b']);
  });
});
