import { describe, expect, it } from 'vitest';
import type { OwnedPetSummary, PetSummary } from '../types';
import { composeHousePets, HOUSE_PET_LIMIT, orderDailyPets, prioritizeRevealedPets } from './housePets';

const traits = { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 } as const;
const owned = (id: string, approvalStatus: OwnedPetSummary['approvalStatus'] = 'pending'): OwnedPetSummary => ({ id, traits, approvalStatus, photoUrl: `/${id}.jpg` });
const approved = (id: string, revealedToday = false): PetSummary => ({ id, traits, approvalStatus: 'approved', revealedToday, photoAvailable: true });

describe('composeHousePets', () => {
  it('keeps the latest owner pet visible independently of its upload bonus', () => {
    const result = composeHousePets([owned('mine-new'), owned('mine-old')], [approved('a'), approved('b'), approved('c'), approved('d')]);
    expect(result).toHaveLength(HOUSE_PET_LIMIT);
    expect(result[0]).toMatchObject({ id: 'mine-new', isMine: true, ownerPinned: true });
    expect(result.some(({ id }) => id === 'mine-old')).toBe(false);
  });

  it('fills five stable slots while retaining the revealed flag for direct revisit', () => {
    const result = composeHousePets([owned('mine')], [approved('seen', true), approved('mine'), approved('a'), approved('b'), approved('c'), approved('d')]);
    expect(result.map(({ id }) => id)).toEqual(['mine', 'seen', 'a', 'b', 'c']);
    expect(result.find(({ id }) => id === 'seen')).toMatchObject({ revealedToday: true });
    expect(new Set(result.map(({ id }) => id)).size).toBe(HOUSE_PET_LIMIT);
  });

  it('moves revealed dogs ahead while preserving their relative daily order', () => {
    const result = composeHousePets([], [approved('seen-a', true), approved('new'), approved('seen-b', true)]);
    expect(result.map(({ id }) => id)).toEqual(['seen-a', 'seen-b', 'new']);
    expect(result.filter(({ revealedToday }) => revealedToday)).toHaveLength(2);
  });

  it('keeps a revealed dog that would otherwise fall out when an owner upload takes one slot', () => {
    const publicPets = [
      approved('new-a'),
      approved('new-b'),
      approved('new-c'),
      approved('new-d'),
      approved('seen-last', true),
    ];

    const result = composeHousePets([owned('mine-new')], publicPets);

    expect(result).toHaveLength(HOUSE_PET_LIMIT);
    expect(result[0]).toMatchObject({ id: 'mine-new', ownerPinned: true });
    expect(result.map(({ id }) => id)).toContain('seen-last');
    expect(result.map(({ id }) => id)).not.toContain('new-d');
  });

  it('keeps stable relative order within revealed and unrevealed groups', () => {
    const result = prioritizeRevealedPets([
      approved('new-a'),
      approved('seen-a', true),
      approved('new-b'),
      approved('seen-b', true),
    ]);

    expect(result.map(({ id }) => id)).toEqual(['seen-a', 'seen-b', 'new-a', 'new-b']);
  });

  it('prioritizes only unexpired revisit windows and ignores a stale legacy flag', () => {
    const now = new Date('2026-08-28T03:00:00.000Z');
    const result = prioritizeRevealedPets([
      approved('new'),
      { ...approved('expired', true), revisitUntil: '2026-08-28T03:00:00.000Z' },
      { ...approved('active'), revisitUntil: '2026-08-28T03:00:01.000Z' },
      approved('legacy', true),
    ], now);

    expect(result.map(({ id }) => id)).toEqual(['active', 'legacy', 'new', 'expired']);
  });

  it('keeps only the newest owned pet so a pending upload occupies one of five slots', () => {
    const result = composeHousePets([
      owned('newest'),
      { ...owned('older'), revealedToday: true },
    ], [approved('fresh-a'), approved('fresh-b'), approved('fresh-c')]);

    expect(result.map(({ id }) => id)).toEqual(['newest', 'fresh-a', 'fresh-b', 'fresh-c']);
    expect(result[0]).toMatchObject({ id: 'newest', isMine: true, approvalStatus: 'pending' });
  });

  it('uses a deterministic per-viewer daily shuffle that changes on the next KST date', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => approved(id));
    const first = orderDailyPets(candidates, 'viewer-a', '2026-08-28').map(({ id }) => id);
    const reopened = orderDailyPets([...candidates].reverse(), 'viewer-a', '2026-08-28').map(({ id }) => id);
    const nextDay = orderDailyPets(candidates, 'viewer-a', '2026-08-29').map(({ id }) => id);

    expect(reopened).toEqual(first);
    expect(nextDay).not.toEqual(first);
    expect(new Set(first)).toEqual(new Set(candidates.map(({ id }) => id)));
  });

  it('gives different viewers their own deterministic daily order', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => approved(id));
    const viewerA = orderDailyPets(candidates, 'viewer-a', '2026-08-28').map(({ id }) => id);
    const viewerB = orderDailyPets(candidates, 'viewer-b', '2026-08-28').map(({ id }) => id);

    expect(viewerB).not.toEqual(viewerA);
  });

  it('does not expose rejected owner uploads in the house', () => {
    expect(composeHousePets([owned('no', 'rejected')], [approved('a')]).map(({ id }) => id)).toEqual(['a']);
  });

  it('does not expose pets without a real photo in either source', () => {
    const missingOwned = { ...owned('mine-missing'), photoUrl: undefined };
    const missingPublic = { ...approved('public-missing'), photoAvailable: false };

    expect(composeHousePets([missingOwned, owned('mine-ready')], [missingPublic, approved('public-ready')]).map(({ id }) => id))
      .toEqual(['mine-ready', 'public-ready']);
  });
});
