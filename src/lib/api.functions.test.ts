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
      body: { action: 'house', apiVersion: 2, userHash: 'anonymous-user-key' },
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
    expect(bodies[1]).toMatchObject({ action: 'reveal', unlockMethod: 'SHARE', requestId: 'same-request' });
    expect(bodies[1].revisit).not.toBe(true);
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
