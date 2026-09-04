import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHouse, openOwnerPhoto, reopenPet, revealPet } from './api';

function openScenario(scenario?: string) {
  window.history.replaceState({}, '', scenario ? `/?scenario=${scenario}` : '/');
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  openScenario();
});

describe('preview scenario API flows', () => {
  it('keeps the ordinary preview behavior unchanged without a scenario', async () => {
    openScenario();
    const result = await fetchHouse();

    expect(result.dailyPets).toHaveLength(2);
    expect(result.ownerBonusPet).toBeUndefined();
    expect(result.dailyPets?.map(({ id }) => id).sort()).toEqual(['sample-gureumi', 'sample-haneul']);
  });

  it('shows exactly five fixture public dogs and supports reveal then reopen', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T01:00:00.000Z'));
    openScenario('five');

    const initial = await fetchHouse();
    expect(initial.dailyPets).toHaveLength(5);
    expect(initial.ownerBonusPet).toBeUndefined();
    expect(initial.dailyProgress).toMatchObject({ metCount: 0, totalCount: 5, completed: false });

    const firstPet = initial.dailyPets![0];
    const revealed = await revealPet(firstPet, 'FREE');
    expect(revealed.photoUrl).toMatch(/^\/sample-pets\//);
    expect(revealed.dailyProgress).toMatchObject({ metCount: 1, completed: false });

    const refreshed = await fetchHouse();
    expect(refreshed.dailyPets?.find(({ id }) => id === firstPet.id)).toMatchObject({ revealedToday: true });
    expect(refreshed.dailyProgress?.metPetIds).toContain(firstPet.id);

    await expect(reopenPet(firstPet)).resolves.toMatchObject({
      photoUrl: revealed.photoUrl,
      revisitUntil: revealed.revisitUntil,
    });
    expect(localStorage.getItem('cute-enough:allowance')).toBeNull();
  });

  it('shows five public fixtures plus a free owner bonus photo', async () => {
    openScenario('owner');
    const result = await fetchHouse();

    expect(result.dailyPets).toHaveLength(5);
    expect(result.ownerBonusPet).toMatchObject({
      id: 'preview-fixture-owner', isMine: true, ownerPhotoAvailable: true, approvalStatus: 'pending',
    });
    await expect(openOwnerPhoto(result.ownerBonusPet!)).resolves.toMatchObject({
      photoUrl: '/sample-pets/gureumi.jpg', ownerPhotoAvailable: true,
    });
  });

  it('marks all five complete and keeps every fixture revisit-ready', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T01:00:00.000Z'));
    openScenario('complete');
    const result = await fetchHouse();

    expect(result.dailyProgress).toMatchObject({ metCount: 5, totalCount: 5, completed: true });
    expect(result.dailyPets).toHaveLength(5);
    expect(result.dailyPets?.every(({ revealedToday, revisitUntil }) => revealedToday && revisitUntil)).toBe(true);
    await expect(reopenPet(result.dailyPets![4])).resolves.toMatchObject({
      dailyProgress: { metCount: 5, completed: true },
    });
  });

  it('shows an exhausted bucket with ads explicitly unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T01:00:00.000Z'));
    openScenario('ads-off');
    const result = await fetchHouse();

    expect(result.dailyPets).toHaveLength(5);
    expect(result.allowance).toMatchObject({
      remaining: 0,
      freeUsed: 2,
      rewardedUsed: 0,
      rewardedLimit: 0,
      rewardedRemaining: 0,
    });
    expect(result.allowance?.nextChargeAt).toBe('2026-09-04T04:00:00.000Z');
    await expect(revealPet(result.dailyPets![0], 'REWARDED', crypto.randomUUID()))
      .rejects.toThrow('이 미리보기에서는 광고를 사용할 수 없어요.');
  });
});
