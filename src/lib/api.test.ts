import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_PETS } from '../data/samplePets';
import { selectPetPhotoUrl } from './petPhoto';
import { PetApiError, reopenPet, revealPet, toPetApiError } from './api';

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('pet api error normalization', () => {
  it('preserves a structured server code and definite outcome', async () => {
    const error = await toPetApiError({
      context: new Response(JSON.stringify({
        code: 'DAILY_UPLOAD_LIMIT_REACHED',
        error: '사진은 하루에 한 장만 소개할 수 있어요.',
      }), { status: 429, headers: { 'Content-Type': 'application/json' } }),
    });

    expect(error).toMatchObject({
      code: 'DAILY_UPLOAD_LIMIT_REACHED',
      outcome: 'definite',
      status: 429,
    });
  });

  it('marks a timeout and an unhandled server failure as unknown outcomes', async () => {
    const timeout = await toPetApiError(new DOMException('The operation timed out', 'TimeoutError'));
    const serverFailure = await toPetApiError({
      context: new Response(JSON.stringify({ code: 'INTERNAL_ERROR', error: '요청을 완료하지 못했어요.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    expect(timeout).toMatchObject({ code: 'REQUEST_TIMEOUT', outcome: 'unknown' });
    expect(serverFailure).toMatchObject({ code: 'INTERNAL_ERROR', outcome: 'unknown', status: 500 });
  });

  it('keeps an explicit capacity rejection definite even when it uses a 503 status', async () => {
    const error = await toPetApiError({
      context: new Response(JSON.stringify({ code: 'UPLOAD_CAPACITY_REACHED', error: '오늘 받을 수 있는 사진이 모두 모였어요.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    expect(error).toMatchObject({ code: 'UPLOAD_CAPACITY_REACHED', outcome: 'definite', status: 503 });
  });

  it('does not erase an already normalized error', async () => {
    const original = new PetApiError('다시 시도해 주세요.', 'NETWORK_ERROR', 'unknown');
    await expect(toPetApiError(original)).resolves.toBe(original);
  });
});

describe('preview revisit windows', () => {
  it('uses the free allowance boundary and reopens the same photo across KST midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T14:30:00.000Z'));
    localStorage.setItem('cute-enough:preview-user', 'viewer-a');
    const pet = SAMPLE_PETS.find(({ id }) => id === 'sample-haneul')!;

    expect(selectPetPhotoUrl(pet, '2026-08-29', 'viewer-a'))
      .not.toBe(selectPetPhotoUrl(pet, '2026-08-28', 'viewer-a'));

    const revealed = await revealPet(pet, 'FREE');
    expect(revealed.revisitUntil).toBe('2026-08-28T17:30:00.000Z');

    vi.setSystemTime(new Date('2026-08-28T15:30:00.000Z'));
    const reopened = await reopenPet(pet);
    expect(reopened.photoUrl).toBe(revealed.photoUrl);
    expect(reopened.revisitUntil).toBe(revealed.revisitUntil);
  });

  it('falls back to three hours for a non-free reveal when the free bucket is full', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T01:00:00.000Z'));
    localStorage.setItem('cute-enough:preview-user', 'viewer-a');

    const result = await revealPet(SAMPLE_PETS[0], 'REWARDED', crypto.randomUUID());

    expect(result.revisitUntil).toBe('2026-08-28T04:00:00.000Z');
  });

  it.each([
    { method: 'REWARDED' as const, petIndex: 0 },
    { method: 'UPLOAD' as const, petIndex: 1 },
  ])('uses the actual next free recharge boundary for $method revisits', async ({ method, petIndex }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T01:00:00.000Z'));
    localStorage.setItem('cute-enough:preview-user', 'viewer-a');
    const pet = SAMPLE_PETS[petIndex];
    localStorage.setItem('cute-enough:allowance', JSON.stringify({
      date: '2026-08-28',
      freeUsed: 2,
      remaining: 0,
      nextChargeAt: '2026-08-28T01:05:00.000Z',
      rewardedUsed: 0,
      uploadCredit: method === 'UPLOAD',
      uploadUsed: false,
      uploadRewardPetId: method === 'UPLOAD' ? pet.id : undefined,
    }));

    const result = await revealPet(
      pet,
      method,
      method === 'REWARDED' ? crypto.randomUUID() : undefined,
    );

    expect(result.revisitUntil).toBe('2026-08-28T01:05:00.000Z');
  });

  it('expires exactly at the recharge boundary and requires a fresh unlock afterward', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T01:00:00.000Z'));
    localStorage.setItem('cute-enough:preview-user', 'viewer-a');
    const pet = SAMPLE_PETS[0];

    const first = await revealPet(pet, 'FREE');
    expect(first.allowance.remaining).toBe(1);
    expect(first.revisitUntil).toBe('2026-08-28T04:00:00.000Z');

    vi.setSystemTime(new Date('2026-08-28T03:59:59.999Z'));
    await expect(reopenPet(pet)).resolves.toMatchObject({
      photoUrl: first.photoUrl,
      revisitUntil: first.revisitUntil,
    });

    vi.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));
    await expect(reopenPet(pet)).rejects.toThrow('이용권이 충전되기 전에 만난 사진만 다시 볼 수 있어요.');

    const second = await revealPet(pet, 'FREE');
    expect(second.allowance.remaining).toBe(1);
    expect(second.revisitUntil).toBe('2026-08-28T07:00:00.000Z');
  });

  it('gives two free reveals the same next recharge boundary and restores only one ticket there', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T01:00:00.000Z'));
    localStorage.setItem('cute-enough:preview-user', 'viewer-a');

    const first = await revealPet(SAMPLE_PETS[0], 'FREE');
    vi.setSystemTime(new Date('2026-08-28T02:00:00.000Z'));
    const second = await revealPet(SAMPLE_PETS[1], 'FREE');

    expect(first.revisitUntil).toBe('2026-08-28T04:00:00.000Z');
    expect(second.revisitUntil).toBe(first.revisitUntil);
    expect(second.allowance.remaining).toBe(0);

    vi.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));
    const third = await revealPet(SAMPLE_PETS[0], 'FREE');
    expect(third.allowance.remaining).toBe(0);
    expect(third.allowance.nextChargeAt).toBe('2026-08-28T07:00:00.000Z');
    expect(third.revisitUntil).toBe('2026-08-28T07:00:00.000Z');
  });
});
