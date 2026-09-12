// Execute the actual Edge handler with an entirely local transport stub.
// SQL ownership, status and exactly-once behavior are independently exercised
// by daily-photo-collection.node-test.mjs against real PostgreSQL functions.
import assert from 'node:assert/strict';

const petId = '10000000-0000-4000-8000-000000000001';
const photoId = '20000000-0000-4000-8000-000000000001';
const requestId = '30000000-0000-4000-8000-000000000001';
const adSessionId = '40000000-0000-4000-8000-000000000001';
const rawOwner = 'earned-ad-edge-test-owner';
const salt = 'earned-ad-edge-test-salt';
type Call = { path: string; body: Record<string, unknown> };

Deno.test('earned ad credits remain usable through the actual Edge handler when new ads are disabled', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const configuration = {
    SUPABASE_URL: 'https://earned-ad-edge.test', SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
    USER_HASH_SALT: salt, AIT_RUNTIME_ENV: 'local', AIT_ALLOW_UNVERIFIED_ANON_KEY: 'true',
    AIT_REWARDED_ADS_ENABLED: 'false', AIT_SHARE_REWARDS_ENABLED: 'false', PET_REQUIRE_SVG_DESIGN: 'true',
  };
  const previous = new Map(Object.keys(configuration).map((key) => [key, Deno.env.get(key)]));
  let handler: ((request: Request) => Promise<Response>) | undefined;
  let calls: Call[] = [];
  let recordError: string | undefined;
  let reusedRequest = false;
  let availableCredit = false;
  let missingAlbumStatus = false;
  let allowStart = false;
  const expectedOwner = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(`${salt}:${rawOwner}`)))).map((value) => value.toString(16).padStart(2, '0')).join('');
  const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  const progress = { date: '2026-09-06', metPetIds: [petId], metCount: 1, totalCount: 4, completed: false };

  try {
    for (const [key, value] of Object.entries(configuration)) Deno.env.set(key, value);
    Deno.serve = ((candidate: (request: Request) => Promise<Response>) => {
      handler = candidate;
      return {};
    }) as unknown as typeof Deno.serve;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      // Never forward a request: unexpected transport is a test failure.
      assert.equal(url.origin, 'https://earned-ad-edge.test');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      calls.push({ path: url.pathname, body });
      const name = url.pathname.split('/').at(-1);
      if (name === 'check_pet_api_rate_limit') return Promise.resolve(response(true));
      if (name === 'prepare_pet_photo_unlock') {
        if (body.p_unlock_method === 'REWARDED' && body.p_ad_session_id === null) {
          return Promise.resolve(response({ code: 'P0001', message: 'INVALID_REVEAL_INPUT' }, 400));
        }
        return Promise.resolve(response({ petId, photoId, storagePath: 'private/photo.jpg' }));
      }
      if (name === 'record_pet_photo_unlock' || name === 'record_pet_reveal_v4') {
        if (recordError) return Promise.resolve(response({ code: 'P0001', message: recordError }, 400));
        return Promise.resolve(response({ petId, photoId, unlockMethod: 'REWARDED', adSessionId,
          reusedRequest, alreadyRevealed: reusedRequest, dailyProgress: progress,
          revisitUntil: new Date(Date.now() + 3_600_000).toISOString() }));
      }
      if (name === 'get_pet_album_state') return Promise.resolve(response([{ petId, isFavorite: false,
        unlockedPhotoCount: 1, hasUnseenPhotos: true, albumPhotoId: photoId, favoriteCount: 0,
        collection: { collectedCount: 1, totalCount: 2, collectedToday: true, canCollectToday: false } }]));
      if (name === 'get_pet_free_allowance') return Promise.resolve(response({ free_remaining: 0,
        next_free_at: new Date(Date.now() + 3_600_000).toISOString() }));
      if (name === 'get_pet_reward_state' || name === 'get_pet_album_reward_state') {
        if (name === 'get_pet_album_reward_state' && missingAlbumStatus) {
          return Promise.resolve(response({ code: 'PGRST202', message: 'Function is not in the schema cache' }, 404));
        }
        return Promise.resolve(response({ bonusTickets: 0, adsCompletedToday: 1,
          adsRemainingToday: 1, adsEnabled: false, shareEnabled: false,
          adRewards: availableCredit ? [{ sessionId: adSessionId, petId, status: 'completed',
            canRebind: name === 'get_pet_album_reward_state' }] : [], shareSessions: [] }));
      }
      if (name === 'start_pet_album_ad_reward' || name === 'start_pet_ad_reward') {
        return Promise.resolve(allowStart ? response({}) : response({ code: 'P0001', message: 'ADS_DISABLED' }, 400));
      }
      if (['complete_pet_ad_reward', 'cancel_pet_ad_reward', 'rebind_pet_album_ad_reward', 'rebind_pet_ad_reward'].includes(name ?? '')) {
        return Promise.resolve(response({}));
      }
      if (name === 'get_existing_pet_photos') return Promise.resolve(response([{ pet_id: petId, storage_path: 'private/photo.jpg', sort_order: 0 }]));
      if (name === 'pets') return Promise.resolve(response([{ id: petId, storage_path: 'private/photo.jpg', status: 'approved', owner_hash: 'another-owner' }]));
      if (name === 'pet_photos') return Promise.resolve(response([{ id: photoId, caption: null }]));
      if (name === 'daily_reveals' || name === 'upload_rewards') return Promise.resolve(response([]));
      if (url.pathname.startsWith('/storage/v1/object/sign/')) {
        return Promise.resolve(response({ signedURL: '/object/sign/pet-photos/private/photo.jpg?token=local-test-only' }));
      }
      throw new Error(`Unexpected local transport ${url.pathname}`);
    }) as typeof fetch;
    await import('./index.ts');
    Deno.serve = originalServe;
    assert.ok(handler);
    const request = async (extra: Record<string, unknown> = {}) => {
      const result = await handler!(new Request('https://local-edge.test/pet-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://cute-enough.private-apps.tossmini.com' },
        body: JSON.stringify({ action: 'reveal', apiVersion: 2, albumVersion: 2, designFormat: 'svg-scene-v1',
          userHash: rawOwner, petId, requestId, unlockMethod: 'REWARDED', adSessionId, photoIntent: 'collect', ...extra }),
      }));
      return { status: result.status, body: await result.json() };
    };
    const reset = () => {
      calls = []; recordError = undefined; reusedRequest = false;
      availableCredit = false; missingAlbumStatus = false; allowStart = false;
      Deno.env.set('AIT_REWARDED_ADS_ENABLED', 'false');
    };
    const records = () => calls.filter((call) => call.path.endsWith('/record_pet_photo_unlock'));

    await t.step('album v2 reaches atomic consumption with switches off and retries preserve the same identity', async () => {
      reset();
      const first = await request({ ownerHash: 'forged-owner' });
      assert.equal(first.status, 200);
      assert.equal(first.body.photoId, photoId);
      assert.equal(first.body.rewardStatus.capabilities.ads, false);
      assert.deepEqual(records()[0].body, { p_owner_hash: expectedOwner, p_pet_id: petId,
        p_request_id: requestId, p_unlock_method: 'REWARDED', p_ad_session_id: adSessionId,
        p_reveal_date: records()[0].body.p_reveal_date, p_photo_id: photoId });
      reusedRequest = true;
      const retry = await request();
      assert.equal(retry.status, 200);
      assert.equal(retry.body.reusedRequest, true);
      assert.deepEqual(records()[0].body, records()[1].body);
      assert.equal(calls.some((call) => /complete_pet_ad_reward|start_pet.*ad_reward/.test(call.path)), false);
    });
    await t.step('SQL denial for wrong owner, dog, or incomplete credit never returns a photo URL', async () => {
      for (const extra of [{ adSessionId: requestId }, { petId: requestId }, { userHash: 'different-owner' }]) {
        reset(); recordError = 'AD_REWARD_UNAVAILABLE';
        const result = await request(extra);
        assert.equal(result.status, 409);
        assert.equal(result.body.code, 'AD_REWARD_UNAVAILABLE');
        assert.equal(result.body.photoUrl, undefined);
        assert.equal(records().length, 1);
      }
    });
    await t.step('missing or malformed credit IDs never reach consumption', async () => {
      for (const invalidId of [undefined, 'invalid']) {
        reset();
        const result = await request({ adSessionId: invalidId });
        assert.equal(result.status, 400);
        assert.equal(records().length, 0);
      }
    });
    await t.step('new ad starts remain blocked by the environment and then by database settings', async () => {
      reset();
      const disabled = await request({ action: 'rewardStart' });
      assert.equal(disabled.status, 403);
      assert.equal(disabled.body.code, 'REWARDED_ADS_DISABLED');
      assert.equal(calls.some((call) => call.path.endsWith('/start_pet_album_ad_reward')), false);
      Deno.env.set('AIT_REWARDED_ADS_ENABLED', 'true');
      const databaseDisabled = await request({ action: 'rewardStart' });
      assert.equal(databaseDisabled.status, 403);
      assert.equal(databaseDisabled.body.code, 'ADS_DISABLED');
    });
    await t.step('request-ID v4 remains supported while legacy non-durable ad reveals retain their gate', async () => {
      reset();
      assert.equal((await request({ albumVersion: undefined })).status, 200);
      assert.equal(calls.some((call) => call.path.endsWith('/record_pet_reveal_v4')), true);
      reset();
      const legacy = await request({ apiVersion: 1, albumVersion: undefined, requestId: undefined });
      assert.equal(legacy.status, 403);
      assert.equal(legacy.body.code, 'REWARDED_ADS_DISABLED');
      assert.equal(calls.some((call) => /record_pet_reveal_v[234]/.test(call.path)), false);
    });
    await t.step('album-aware status and all ad responses use remaining-photo reselection while legacy stays unchanged', async () => {
      for (const albumVersion of [undefined, 1, 2]) {
        for (const action of ['rewardStatus', 'rewardStart', 'rewardComplete', 'rewardCancel', 'rewardRebind']) {
          reset(); availableCredit = true; allowStart = true;
          Deno.env.set('AIT_REWARDED_ADS_ENABLED', 'true');
          const result = await request({ action, albumVersion, sessionId: adSessionId });
          assert.equal(result.status, 200, `${action}, album ${albumVersion}`);
          assert.deepEqual(result.body.adCredits, [{ sessionId: adSessionId, petId, canRebind: albumVersion !== undefined }]);
          const stateCalls = calls.filter((call) => /\/get_pet_(album_)?reward_state$/.test(call.path));
          assert.ok(stateCalls.length > 0);
          assert.ok(stateCalls.every((call) => call.path.endsWith(albumVersion === undefined ? '/get_pet_reward_state' : '/get_pet_album_reward_state')));
        }
      }
    });
    await t.step('an unapplied album status migration returns retryable unavailability without inventing reward state', async () => {
      reset(); missingAlbumStatus = true;
      const result = await request({ action: 'rewardStatus' });
      assert.equal(result.status, 503);
      assert.equal(result.body.code, 'REWARD_UNAVAILABLE');
      assert.equal(result.body.adCredits, undefined);
      assert.equal(result.body.allowance, undefined);
      assert.equal(result.body.retryAfter, 5);
      assert.equal(calls.some((call) => /\/(start|complete|cancel|record|rebind)_/.test(call.path)), false);
    });
  } finally {
    Deno.serve = originalServe;
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});
