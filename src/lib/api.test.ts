import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_PETS } from '../data/samplePets';
import { selectPetPhotoUrl } from './petPhoto';
import { savePreviewSubmission } from './previewPetStore';
import { getPreviewScenario, getScenarioStorage } from '../data/previewScenarios';
import { fetchMyPets, fetchSubmissionStatus, openOwnerPhoto, preparePetPhoto, PetApiError, reopenPet, revealPet, submitPet, toPetApiError } from './api';

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

describe('read-only preview photo preparation', () => {
  it('does not initialize legacy gifts, tickets or visits just by preparing', async () => {
    const pet = SAMPLE_PETS[0];
    const storage = getScenarioStorage(getPreviewScenario());
    storage.setItem('cute-enough:preview-reveals', JSON.stringify([{ petId: pet.id }]));
    const before = JSON.stringify({ ...localStorage });
    await expect(preparePetPhoto(pet, crypto.randomUUID(), 'replay')).rejects.toThrow('이미 볼 수 있는 사진');
    expect(JSON.stringify({ ...localStorage })).toBe(before);
    const owner = { ...pet, isMine: true, approvalStatus: 'pending' as const };
    await expect(preparePetPhoto(owner, crypto.randomUUID(), 'owner')).resolves.toMatchObject({ petId: pet.id });
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
});

describe('preview registration photos', () => {
  it('stores five photos under one pending dog and recovers the same submission without another reward', async () => {
    vi.useFakeTimers();
    const input = {
      submissionId: crypto.randomUUID(), name: '보리',
      dataUris: Array.from({ length: 5 }, (_, index) => `data:image/jpeg;base64,PHOTO${index}`),
      traits: SAMPLE_PETS[0].traits!,
      style: { schemaVersion: 1 as const, coatMode: 'point' as const, furStyle: 'neat' as const },
      accessorySelectionMode: 'reviewer' as const,
    };
    const pending = submitPet(input);
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result.pet).toMatchObject({ name: '보리', approvalStatus: 'pending', photoUrl: input.dataUris[0], photoUrls: input.dataUris, ownerPhotoAvailable: true });
    const stored = await fetchMyPets();
    expect(stored).toHaveLength(1);
    expect(stored[0].photoUrls).toEqual(input.dataUris);
    expect(await fetchSubmissionStatus(input.submissionId)).toMatchObject({ found: true, result: { pet: { id: result.pet.id, photoUrls: input.dataUris } } });
    await expect(submitPet(input)).resolves.toMatchObject({ pet: { id: result.pet.id, photoUrls: input.dataUris } });
    expect(await fetchMyPets()).toHaveLength(1);
  });
});

describe('preview registration name validation', () => {
  it('keeps successful unnamed historical submissions recoverable without creating another dog', async () => {
    const submissionId = crypto.randomUUID();
    const legacyPet = { ...SAMPLE_PETS[0], name: undefined, isMine: true, approvalStatus: 'pending' as const };
    savePreviewSubmission(submissionId, { pet: legacyPet, rewardGranted: false }, getScenarioStorage(getPreviewScenario()));
    const before = { ...localStorage };
    await expect(submitPet({
      submissionId,
      dataUri: 'data:image/jpeg;base64,PHOTO',
      name: '',
      traits: legacyPet.traits!,
      style: { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' },
      accessorySelectionMode: 'reviewer',
    })).resolves.toMatchObject({ pet: { id: legacyPet.id }, rewardGranted: false });
    expect({ ...localStorage }).toEqual(before);
  });

  it.each(['', '   ', '\u200B\uFEFF'])('rejects an empty name before saving a preview registration: %j', async (name) => {
    const before = { ...localStorage };
    await expect(submitPet({
      submissionId: crypto.randomUUID(),
      dataUri: 'data:image/jpeg;base64,PHOTO',
      name,
      traits: SAMPLE_PETS[0].traits!,
      style: { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' },
      accessorySelectionMode: 'reviewer',
    })).rejects.toMatchObject({ message: '강아지 이름을 입력해 주세요.', status: 400, outcome: 'definite' });
    expect({ ...localStorage }).toEqual(before);
  });
});

describe('preview revisit windows', () => {
  it('opens an owner photo without changing the allowance bucket', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T01:00:00.000Z'));
    localStorage.setItem('cute-enough:preview-user', 'viewer-a');
    const before = {
      date: '2026-08-28', freeUsed: 1, remaining: 1, rewardedUsed: 0,
      uploadCredit: true, uploadUsed: true,
    };
    localStorage.setItem('cute-enough:allowance', JSON.stringify(before));

    const result = await openOwnerPhoto({
      ...SAMPLE_PETS[0],
      isMine: true,
      ownerPhotoAvailable: true,
      approvalStatus: 'pending',
    });

    expect(result).toMatchObject({ ownerPhotoAvailable: true });
    expect(result).not.toHaveProperty('allowance');
    expect(JSON.parse(localStorage.getItem('cute-enough:allowance') ?? '{}')).toEqual(before);
  });

  it('does not trust a non-owner caller for direct owner photo access', async () => {
    await expect(openOwnerPhoto({ ...SAMPLE_PETS[0], approvalStatus: 'approved' }))
      .rejects.toThrow('내가 소개한 강아지의 사진만 바로 볼 수 있어요.');
  });

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
    expect(reopened.photoId).toBe(revealed.photoId);
    expect(reopened.allowance.remaining).toBe(revealed.allowance.remaining);
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

  it('keeps a collected photo free at recharge and allows one next photo on the next KST day', async () => {
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
      photoId: first.photoId,
    });

    vi.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));
    await expect(reopenPet(pet)).resolves.toMatchObject({ photoId: first.photoId, photoUrl: first.photoUrl, allowance: { remaining: 2 } });

    const sameDay = await revealPet(pet, 'FREE');
    expect(sameDay.photoId).toBe(first.photoId);
    expect(sameDay.allowance.remaining).toBe(2);
    expect(sameDay.collection).toMatchObject({ collectedToday: true, canCollectToday: false });
    vi.setSystemTime(new Date('2026-08-28T15:00:00.000Z'));
    const nextDay = await revealPet(pet, 'FREE');
    expect(nextDay.photoId).not.toBe(first.photoId);
    expect(nextDay.allowance.remaining).toBe(1);
    expect(nextDay.collection).toMatchObject({ collectedToday: true, collectedCount: 2 });
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
    expect(third.photoId).toBe(first.photoId);
    expect(third.allowance.remaining).toBe(1);
    expect(third.allowance.nextChargeAt).toBe('2026-08-28T07:00:00.000Z');
  });
});
