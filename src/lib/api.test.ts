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

  it('gives non-free preview reveals a three-hour revisit window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T01:00:00.000Z'));
    localStorage.setItem('cute-enough:preview-user', 'viewer-a');

    const result = await revealPet(SAMPLE_PETS[0], 'REWARDED', crypto.randomUUID());

    expect(result.revisitUntil).toBe('2026-08-28T04:00:00.000Z');
  });
});
