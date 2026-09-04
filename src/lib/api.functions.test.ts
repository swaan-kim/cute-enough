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
  vi.resetModules();
  vi.unstubAllEnvs();
  functionMocks.constructorArgs.length = 0;
  functionMocks.getUserHash.mockClear();
  functionMocks.invoke.mockReset();
});

describe('production Edge Function client', () => {
  it('uses the standalone functions client with the public project key', async () => {
    vi.stubEnv('VITE_APP_RUNTIME', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co/');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    functionMocks.invoke.mockResolvedValueOnce({
      data: {
        pets: [],
        dailyPets: [],
        ownerBonusPet: null,
        allowance: { date: '2026-09-04', remaining: 2 },
        dailyProgress: {
          date: '2026-09-04', metPetIds: [], metCount: 0, totalCount: 5, completed: false,
        },
      },
      error: null,
    });

    const { fetchHouse } = await import('./api');
    await fetchHouse();

    expect(functionMocks.constructorArgs).toEqual([[
      'https://project.supabase.co/functions/v1',
      { headers: { apikey: 'public-anon-key' } },
    ]]);
    expect(functionMocks.invoke).toHaveBeenCalledWith('pet-api', expect.objectContaining({
      body: { action: 'house', apiVersion: 2, userHash: 'anonymous-user-key' },
      signal: expect.any(AbortSignal),
    }));
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
        }), { status: 429, headers: { 'Content-Type': 'application/json' } }),
      },
    });

    const { fetchHouse } = await import('./api');

    await expect(fetchHouse()).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      outcome: 'definite',
      status: 429,
    });
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
