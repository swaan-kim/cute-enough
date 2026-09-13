import { afterEach, describe, expect, it, vi } from 'vitest';

const functionMocks = vi.hoisted(() => ({
  constructorArgs: [] as Array<[string, { headers?: Record<string, string> } | undefined]>,
  getUserHash: vi.fn(async () => 'anonymous-user-key'),
  invoke: vi.fn(),
}));

vi.mock('@supabase/functions-js', () => ({
  FunctionsClient: class FunctionsClientMock {
    constructor(url: string, options?: { headers?: Record<string, string> }) {
      functionMocks.constructorArgs.push([url, options]);
    }

    invoke = functionMocks.invoke;
  },
}));

vi.mock('./toss', () => ({ getUserHash: functionMocks.getUserHash }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  functionMocks.constructorArgs.length = 0;
  functionMocks.getUserHash.mockReset().mockResolvedValue('anonymous-user-key');
  functionMocks.invoke.mockReset();
});

describe('production Edge Function client', () => {
  it.each(['INVALID_PHOTO_RECEIPT', 'PHOTO_RECEIPT_EXPIRED', 'PET_PHOTO_MISSING'])('reuploads photos after %s instead of reusing broken receipts', async (code) => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    const { SAMPLE_PETS } = await import('../data/samplePets');
    let finalizations = 0;
    functionMocks.invoke.mockImplementation(async (_name, { body }) => {
      if (body.action === 'submitPhoto') return { data: { photoReceipt: `receipt-${finalizations}` }, error: null };
      finalizations += 1;
      if (finalizations === 1) return { data: null, error: {
        context: new Response(JSON.stringify({ code, error: '사진을 다시 확인해 주세요.' }), { status: code === 'PET_PHOTO_MISSING' ? 503 : 400 }),
      } };
      return { data: { pet: { ...SAMPLE_PETS[0], approvalStatus: 'pending', isMine: true }, rewardGranted: true }, error: null };
    });
    const { submitPet } = await import('./api');
    const input = { submissionId: `retry-${code}`, name: '보리', dataUris: ['data:image/jpeg;base64,PHOTO'],
      traits: SAMPLE_PETS[0].traits!, style: { schemaVersion: 1 as const, coatMode: 'point' as const, furStyle: 'neat' as const },
      accessorySelectionMode: 'reviewer' as const };
    await expect(submitPet(input)).rejects.toMatchObject({ code });
    await submitPet(input);
    expect(functionMocks.invoke.mock.calls.map(([, options]) => options.body.action)).toEqual(['submitPhoto', 'submit', 'submitPhoto', 'submit']);
  });

  it('recovers a committed registration instead of duplicating staged photos on retry', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    const { SAMPLE_PETS } = await import('../data/samplePets');
    const result = { pet: { ...SAMPLE_PETS[0], approvalStatus: 'pending', isMine: true }, rewardGranted: true };
    functionMocks.invoke.mockResolvedValueOnce({ data: null, error: {
      context: new Response(JSON.stringify({ code: 'SUBMISSION_ALREADY_REGISTERED', error: '이미 등록한 강아지예요.' }), { status: 409 }),
    } }).mockResolvedValueOnce({ data: { found: true, result }, error: null });
    const { submitPet } = await import('./api');
    await expect(submitPet({ submissionId: 'completed-upload', name: '보리', dataUris: ['data:image/jpeg;base64,PHOTO'], traits: SAMPLE_PETS[0].traits!,
      style: { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' }, accessorySelectionMode: 'reviewer' })).resolves.toMatchObject({ pet: { id: result.pet.id } });
    expect(functionMocks.invoke.mock.calls.map(([, options]) => options.body.action)).toEqual(['submitPhoto', 'submissionStatus']);
  });

  it('uploads five photos sequentially then confirms one registration using receipts only', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    const { SAMPLE_PETS } = await import('../data/samplePets');
    functionMocks.invoke.mockImplementation(async (_name, { body }) => ({ data: body.action === 'submitPhoto'
      ? { photoReceipt: `receipt-${body.photoIndex}` }
      : { pet: { ...SAMPLE_PETS[0], approvalStatus: 'pending', isMine: true }, rewardGranted: true }, error: null }));
    const { submitPet } = await import('./api');
    const dataUris = Array.from({ length: 5 }, (_, index) => `data:image/jpeg;base64,PHOTO${index}`);
    await submitPet({ submissionId: 'test-submission', name: '보리', dataUris, traits: SAMPLE_PETS[0].traits!,
      style: { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' }, accessorySelectionMode: 'reviewer' });
    expect(functionMocks.invoke).toHaveBeenCalledTimes(6);
    for (let photoIndex = 0; photoIndex < 5; photoIndex += 1) {
      expect(functionMocks.invoke.mock.calls[photoIndex][1].body).toMatchObject({ action: 'submitPhoto', submissionId: 'test-submission', photoIndex, dataUri: dataUris[photoIndex] });
    }
    const registration = functionMocks.invoke.mock.calls[5][1].body;
    expect(registration).toMatchObject({ action: 'submit', submissionId: 'test-submission', photoReceipts: Array.from({ length: 5 }, (_, index) => `receipt-${index}`) });
    expect(registration).not.toHaveProperty('dataUri');
    expect(registration).not.toHaveProperty('dataUris');
  });

  it('preserves published SVG through every list normalizer and reloads without a photo/ticket request', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    const { SAMPLE_PETS } = await import('../data/samplePets');
    const artwork = { publishedDesign: { ...SAMPLE_PETS[0].publishedDesign!, designVersion: 2 }, designStatus: 'ready' };
    const pet = { ...SAMPLE_PETS[0], ...artwork, photoAvailable: true, designVersion: 2, approvalStatus: 'approved' };
    functionMocks.invoke
      .mockResolvedValueOnce({ data: { pets: [pet], dailyPets: [pet], ownerBonusPet: { ...pet, id: 'owner' }, allowance: { date: '2026-09-06' } } })
      .mockResolvedValueOnce({ data: { pet } })
      .mockResolvedValueOnce({ data: { pets: [pet] } })
      .mockResolvedValueOnce({ data: { pets: [{ ...pet, unlockedPhotos: [] }], legacyGiftCount: 0 } })
      .mockResolvedValueOnce({ data: { pet: { id: pet.id, ...artwork, designVersion: 2 } } });
    const api = await import('./api');
    const house = await api.fetchHouse();
    expect(house.dailyPets?.[0]).toMatchObject(artwork);
    expect(house.ownerBonusPet).toMatchObject(artwork);
    expect((await api.fetchSharedPet(pet.id)).pet).toMatchObject(artwork);
    expect((await api.fetchMyPets())[0]).toMatchObject(artwork);
    expect((await api.fetchAlbum()).pets[0]).toMatchObject(artwork);
    expect(await api.fetchPetDesign(pet.id)).toMatchObject(artwork);
    expect(functionMocks.invoke.mock.calls.at(-1)?.[1].body).toEqual({ action: 'design', petId: pet.id, userHash: 'anonymous-user-key', designFormat: 'svg-scene-v1' });
  });

  it('uses the standalone functions client and normalizes a stale five-slot payload to four', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co/');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    const traits = {
      schemaVersion: 1,
      earShape: 'floppy',
      headShape: 'round',
      baseColor: 'white',
      secondaryColor: 'cream',
      markingPattern: 'none',
      muzzle: 'short',
      confidence: 1,
    } as const;
    const staleDailyPets = ['a', 'b', 'c', 'd', 'stale-fifth'].map((id) => ({
      id,
      name: id,
      traits,
      photoAvailable: true,
    }));
    functionMocks.invoke.mockResolvedValueOnce({
      data: {
        pets: staleDailyPets,
        dailyPets: staleDailyPets,
        ownerBonusPet: null,
        allowance: { date: '2026-09-04', remaining: 2 },
        dailyProgress: {
          date: '2026-09-04', metPetIds: ['a', 'b', 'c', 'd', 'stale-fifth'], metCount: 5, totalCount: 5, completed: true,
        },
      },
      error: null,
    });

    const { fetchHouse } = await import('./api');
    const result = await fetchHouse();

    expect(functionMocks.constructorArgs).toEqual([[
      'https://project.supabase.co/functions/v1',
      { headers: { apikey: 'public-anon-key' } },
    ]]);
    expect(functionMocks.invoke).toHaveBeenCalledWith('pet-api', expect.objectContaining({
      body: { action: 'house', apiVersion: 2, albumVersion: 2, userHash: 'anonymous-user-key', designFormat: 'svg-scene-v1' },
      signal: expect.any(AbortSignal),
    }));
    expect(result.dailyPets?.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.dailyProgress).toEqual({
      date: '2026-09-04',
      metPetIds: ['a', 'b', 'c', 'd'],
      metCount: 4,
      totalCount: 4,
      completed: true,
    });
  });

  it('keeps structured function errors available to the existing normalizer', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    functionMocks.invoke.mockResolvedValueOnce({
      data: null,
      error: {
        context: new Response(JSON.stringify({
          code: 'RATE_LIMITED',
          error: '잠시 후 다시 시도해 주세요.',
          allowance: { date: '2026-09-05', remaining: 1, bonusTickets: 3 },
          serverNow: '2026-09-05T03:00:00Z',
          retryAfter: 5,
        }), { status: 429, headers: { 'Content-Type': 'application/json' } }),
      },
    });

    const { fetchHouse } = await import('./api');

    await expect(fetchHouse()).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      outcome: 'definite',
      status: 429,
      allowance: { remaining: 1, bonusTickets: 3 },
      serverNow: '2026-09-05T03:00:00Z',
      retryAfter: 5,
    });
  });

  it('times out a stuck identity lookup and lets the next request get a fresh identity', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal);
    functionMocks.getUserHash.mockImplementationOnce(() => new Promise<string>(() => {}));
    const { fetchMyPets } = await import('./api');
    const failed = expect(fetchMyPets()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', outcome: 'unknown' });
    timeout.abort();
    await failed;
    expect(functionMocks.invoke).not.toHaveBeenCalled();
    functionMocks.invoke.mockResolvedValueOnce({ data: { pets: [] }, error: null });
    await expect(fetchMyPets()).resolves.toEqual([]);
    expect(functionMocks.getUserHash).toHaveBeenCalledTimes(2);
  });

  it('keeps reveal request identity and original payment method on a transport retry', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    functionMocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('Network failure') })
      .mockResolvedValueOnce({ data: { photoUrl: 'https://photo.test/recovered', allowance: {} }, error: null });
    const { revealPet } = await import('./api');
    const { SAMPLE_PETS } = await import('../data/samplePets');
    await expect(revealPet(SAMPLE_PETS[0], 'SHARE', undefined, 'same-request')).rejects.toMatchObject({ outcome: 'unknown' });
    await revealPet(SAMPLE_PETS[0], 'SHARE', undefined, 'same-request');
    const bodies = functionMocks.invoke.mock.calls.map(([, options]) => options.body);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toMatchObject({ action: 'reveal', albumVersion: 2, photoIntent: 'collect', unlockMethod: 'SHARE', requestId: 'same-request' });
    expect(bodies[1].revisit).not.toBe(true);
  });

  it('sends replay intent independently from payment and preserves photo-specific collection metadata', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    const collection = { collectedCount: 2, totalCount: 3, collectedToday: false, canCollectToday: true };
    functionMocks.invoke.mockResolvedValueOnce({ data: {
      photoId: 'second-photo', photoUrl: 'https://photo.test/second', photoCaption: '졸린 오후',
      collection, allowance: { remaining: 0 },
    }, error: null }).mockResolvedValueOnce({ data: {
      photoId: 'first-photo', photoUrl: 'https://photo.test/first', collection, allowance: { remaining: 0 },
    }, error: null });
    const { revealPet, openAlbumPhoto, albumPhotoMetadata } = await import('./api');
    const { SAMPLE_PETS } = await import('../data/samplePets');
    const replay = await revealPet(SAMPLE_PETS[0], 'FREE', undefined, 'replay-request', 'replay');
    expect(functionMocks.invoke.mock.calls[0][1].body).toMatchObject({ albumVersion: 2, photoIntent: 'replay', requestId: 'replay-request' });
    expect(replay).toMatchObject({ photoId: 'second-photo', photoCaption: '졸린 오후', collection });
    const firstPhoto = await openAlbumPhoto('first-photo');
    expect(firstPhoto.photoCaption).toBeUndefined();
    expect(functionMocks.invoke.mock.calls[1][1].body).toMatchObject({ action: 'albumPhoto', albumVersion: 2, photoId: 'first-photo' });
    expect(albumPhotoMetadata({ collection })).toMatchObject({ collection });
  });

  it('passes caller cancellation through mine and shared function requests', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    functionMocks.invoke
      .mockResolvedValueOnce({ data: { pets: [] }, error: null })
      .mockResolvedValueOnce({ data: { pet: {
        id: 'shared-pet',
        traits: {
          schemaVersion: 1,
          earShape: 'floppy',
          headShape: 'round',
          baseColor: 'white',
          secondaryColor: 'cream',
          markingPattern: 'none',
          muzzle: 'short',
          confidence: 1,
        },
      } }, error: null });

    const { fetchMyPets, fetchSharedPet } = await import('./api');
    const mineController = new AbortController();
    const sharedController = new AbortController();
    await fetchMyPets(mineController.signal);
    await fetchSharedPet('shared-pet', sharedController.signal);

    const mineSignal = functionMocks.invoke.mock.calls[0][1].signal as AbortSignal;
    const sharedSignal = functionMocks.invoke.mock.calls[1][1].signal as AbortSignal;
    expect(mineSignal.aborted).toBe(false);
    expect(sharedSignal.aborted).toBe(false);
    mineController.abort();
    sharedController.abort();
    expect(mineSignal.aborted).toBe(true);
    expect(sharedSignal.aborted).toBe(true);
  });
});
