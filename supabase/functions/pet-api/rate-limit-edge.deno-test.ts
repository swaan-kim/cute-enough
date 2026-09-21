// Exercise the actual Edge handler without any network or production state.
import assert from 'node:assert/strict';

Deno.test('rate-limit failures stop before allowance recovery in the actual Edge handler', async (t) => {
  const originalFetch = globalThis.fetch, originalServe = Deno.serve, originalError = console.error;
  const configuration = {
    SUPABASE_URL: 'https://rate-limit-edge.test', SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
    USER_HASH_SALT: 'rate-limit-edge-local-salt', AIT_RUNTIME_ENV: 'local',
    AIT_ALLOW_UNVERIFIED_ANON_KEY: 'true', AIT_REWARDED_ADS_ENABLED: 'false',
    AIT_SHARE_REWARDS_ENABLED: 'false', PET_REQUIRE_SVG_DESIGN: 'true',
  };
  const previous = new Map(Object.keys(configuration).map((key) => [key, Deno.env.get(key)]));
  let handler: ((request: Request) => Promise<Response>) | undefined;
  let rateResult: 'allowed' | 'limited' | 'unavailable' = 'limited';
  let calls: string[] = [];
  const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  try {
    for (const [key, value] of Object.entries(configuration)) Deno.env.set(key, value);
    Deno.serve = ((candidate: (request: Request) => Promise<Response>) => {
      handler = candidate;
      return {};
    }) as unknown as typeof Deno.serve;
    console.error = () => {};
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, 'https://rate-limit-edge.test');
      const name = url.pathname.split('/').at(-1)!;
      calls.push(name);
      if (name === 'check_pet_api_rate_limit') return Promise.resolve(rateResult === 'unavailable'
        ? response({ code: 'P0001', message: 'Fixture limiter unavailable' }, 503)
        : response(rateResult === 'allowed'));
      if (name === 'get_pet_free_allowance') return Promise.resolve(response({
        free_remaining: 1, next_free_at: '2026-09-21T09:00:00.000Z',
      }));
      if (name === 'get_pet_reward_state' || name === 'get_pet_album_reward_state') {
        return Promise.resolve(response({ bonusTickets: 2, adsCompletedToday: 0,
          adsRemainingToday: 2, adsEnabled: false, shareEnabled: false, adRewards: [] }));
      }
      throw new Error(`Unexpected local transport ${url.pathname}`);
    }) as typeof fetch;
    await import('./index.ts');
    Deno.serve = originalServe;
    assert.ok(handler);
    const request = async (action: string, albumVersion?: number) => {
      const result = await handler!(new Request('https://local-edge.test/pet-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, albumVersion, apiVersion: 2, designFormat: 'svg-scene-v1',
          userHash: 'rate-limit-edge-owner' }),
      }));
      return { status: result.status, body: await result.json() };
    };

    for (const action of ['house', 'rewardStatus', 'submissionStatus']) {
      for (const outcome of ['limited', 'unavailable'] as const) {
        await t.step(`${action} ${outcome} returns without any business-state request`, async () => {
          calls = [];
          rateResult = outcome;
          const result = await request(action, 2);
          assert.equal(result.status, outcome === 'limited' ? 429 : 503);
          assert.equal(result.body.code, outcome === 'limited' ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE');
          assert.equal(result.body.retryAfter, 5);
          assert.deepEqual(calls, ['check_pet_api_rate_limit']);
          assert.equal(result.body.allowance, undefined);
          assert.equal(result.body.nextChargeAt, undefined);
        });
      }
    }
    for (const albumVersion of [undefined, 2]) {
      await t.step(`an admitted business failure still recovers ${albumVersion ? 'album' : 'legacy'} allowance`, async () => {
        calls = [];
        rateResult = 'allowed';
        const result = await request('rewardStart', albumVersion);
        assert.equal(result.status, 403);
        assert.equal(result.body.code, 'REWARDED_ADS_DISABLED');
        assert.equal(calls[0], 'check_pet_api_rate_limit');
        assert.deepEqual(calls.slice(1).sort(), ['get_pet_free_allowance',
          albumVersion ? 'get_pet_album_reward_state' : 'get_pet_reward_state'].sort());
        assert.equal(result.body.allowance.remaining, 1);
        assert.equal(result.body.allowance.bonusTickets, 2);
        assert.equal(result.body.nextChargeAt, '2026-09-21T09:00:00.000Z');
      });
    }
  } finally {
    Deno.serve = originalServe;
    globalThis.fetch = originalFetch;
    console.error = originalError;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
