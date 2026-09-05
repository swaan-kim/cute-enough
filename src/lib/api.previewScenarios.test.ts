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

  it('shows the clean four-dog first-user entrance without sample labels or an owner dog', async () => {
    openScenario('first-user');
    const result = await fetchHouse();

    expect(result.dailyPets).toHaveLength(4);
    expect(result.dailyPets?.map(({ name }) => name).sort()).toEqual(['구르미', '몽실', '별이', '하늘'].sort());
    expect(result.dailyPets?.every(({ name }) => !name?.startsWith('샘플'))).toBe(true);
    expect(result.ownerBonusPet).toBeUndefined();
    expect(result.dailyProgress).toMatchObject({ metCount: 0, totalCount: 4, completed: false });
  });

  it('shows exactly four fixture public dogs and supports reveal then reopen', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T01:00:00.000Z'));
    openScenario('four');

    const initial = await fetchHouse();
    expect(initial.dailyPets).toHaveLength(4);
    expect(initial.ownerBonusPet).toBeUndefined();
    expect(initial.dailyProgress).toMatchObject({ metCount: 0, totalCount: 4, completed: false });

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

  it('shows four public fixtures plus a free owner bonus photo', async () => {
    openScenario('owner');
    const result = await fetchHouse();

    expect(result.dailyPets).toHaveLength(4);
    expect(result.ownerBonusPet).toMatchObject({
      id: 'preview-fixture-owner', isMine: true, ownerPhotoAvailable: true, approvalStatus: 'pending',
    });
    await expect(openOwnerPhoto(result.ownerBonusPet!)).resolves.toMatchObject({
      photoUrl: '/sample-pets/gureumi.jpg', ownerPhotoAvailable: true,
    });
  });

  it('marks all four complete and keeps every visible fixture revisit-ready', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T01:00:00.000Z'));
    openScenario('complete');
    const result = await fetchHouse();

    expect(result.dailyProgress).toMatchObject({ metCount: 4, totalCount: 4, completed: true });
    expect(result.dailyPets).toHaveLength(4);
    expect(result.dailyPets?.every(({ revealedToday, revisitUntil }) => revealedToday && revisitUntil)).toBe(true);
    await expect(reopenPet(result.dailyPets![3])).resolves.toMatchObject({
      dailyProgress: { metCount: 4, totalCount: 4, completed: true },
    });
  });

  it('shows an exhausted bucket with ads explicitly unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T01:00:00.000Z'));
    openScenario('ads-off');
    const result = await fetchHouse();

    expect(result.dailyPets).toHaveLength(4);
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
