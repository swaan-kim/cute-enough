// Runs the actual Edge entry point. Every transport stays in this test; no
// request is forwarded to a server, identity provider, or real Storage bucket.
import assert from 'node:assert/strict';

const petId = '10000000-0000-4000-8000-000000000001';
const photoId = '20000000-0000-4000-8000-000000000001';
const requestId = '30000000-0000-4000-8000-000000000001';
const rawOwner = 'photo-prepare-edge-owner', salt = 'photo-prepare-edge-local-salt';
type Row = Record<string, unknown>;

Deno.test('actual Edge photoPrepare enforces identity and read-only owner/grant authorization', async (t) => {
  const originalFetch = globalThis.fetch, originalServe = Deno.serve;
  const configuration = { SUPABASE_URL: 'https://photo-prepare-edge.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    USER_HASH_SALT: salt, AIT_RUNTIME_ENV: 'local', AIT_ALLOW_UNVERIFIED_ANON_KEY: 'true', PET_REQUIRE_SVG_DESIGN: 'true' };
  const previous = new Map(Object.keys(configuration).map((key) => [key, Deno.env.get(key)]));
  const ownerHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(`${salt}:${rawOwner}`)))).map((value) => value.toString(16).padStart(2, '0')).join('');
  let handler: ((request: Request) => Promise<Response>) | undefined;
  let calls: Array<{ path: string; method: string; body: Record<string, unknown>; search: string }> = [];
  let rows: Record<string, Row[]>;
  let rateAllowed = true;
  let signingFails = false;
  const reset = (status = 'approved', petOwner = ownerHash, granted = false) => {
    calls = []; rateAllowed = true; signingFails = false;
    rows = {
      pets: [{ id: petId, status, owner_hash: petOwner }],
      pet_photos: [{ id: photoId, pet_id: petId, storage_path: 'private/fixture.jpg', sort_order: 0, is_active: true, caption: '준비한 사진' }],
      user_photo_unlocks: granted ? [{ owner_hash: ownerHash, pet_id: petId, photo_id: photoId, unlocked_at: '2026-09-12' }] : [],
      pet_photo_replay_requests: [], pet_daily_photo_collections: [], pet_daily_photo_replays: [],
      daily_pet_views: [],
    };
  };
  const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    for (const [key, value] of Object.entries(configuration)) Deno.env.set(key, value);
    Deno.serve = ((candidate: (request: Request) => Promise<Response>) => { handler = candidate; return {}; }) as unknown as typeof Deno.serve;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, 'https://photo-prepare-edge.test');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const method = init?.method ?? 'GET';
      calls.push({ path: url.pathname, method, body, search: url.search });
      const name = url.pathname.split('/').at(-1)!;
      if (name === 'check_pet_api_rate_limit') return Promise.resolve(response(rateAllowed));
      if (name === 'get_existing_pet_photos') return Promise.resolve(response(rows.pet_photos.filter((photo) => photo.is_active)));
      if (name === 'authorize_pet_album_photo') {
        const photo = rows.pet_photos.find((photo) => photo.id === body.p_photo_id && photo.is_active);
        const pet = rows.pets.find((pet) => pet.id === photo?.pet_id && pet.status === 'approved' && pet.owner_hash !== body.p_owner_hash);
        const grant = rows.user_photo_unlocks.find((grant) => grant.owner_hash === body.p_owner_hash && grant.photo_id === photo?.id);
        return Promise.resolve(response(photo && pet && grant ? { petId, photoId, storagePath: photo.storage_path, photoCaption: photo.caption } : null));
      }
      if (url.pathname.startsWith('/storage/v1/object/sign/')) return Promise.resolve(signingFails
        ? response({ message: 'Fixture signing unavailable' }, 503)
        : response({ signedURL: '/object/sign/pet-photos/private/fixture.jpg?token=test-only' }));
      if (name === 'daily_pet_views' && method === 'POST') {
        if (!rows.daily_pet_views.some((row) => row.owner_hash === body.owner_hash
          && row.pet_id === body.pet_id && row.view_date === body.view_date)) rows.daily_pet_views.push(body);
        return Promise.resolve(response(null));
      }
      // Only the final ownerPhoto error handler may ask for allowance recovery.
      // Keep that unrelated recovery unavailable in this isolated transport.
      if (name === 'get_pet_free_allowance' || name === 'get_pet_album_reward_state') {
        return Promise.resolve(response({ code: 'P0001', message: 'Fixture recovery unavailable' }, 503));
      }
      if (name in rows) {
        assert.equal(method, 'GET', `Table ${name} may only be read`);
        const result = rows[name].filter((row) => [...url.searchParams].every(([key, value]) =>
          !value.startsWith('eq.') || String(row[key]) === value.slice(3)));
        return Promise.resolve(response(result));
      }
      throw new Error(`Unexpected transport ${method} ${url.pathname}`);
    }) as typeof fetch;
    await import('./index.ts');
    Deno.serve = originalServe;
    assert.ok(handler);
    const request = async (extra: Record<string, unknown> = {}) => {
      const result = await handler!(new Request('https://local.test/pet-api', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://cute-enough.private-apps.tossmini.com' },
        body: JSON.stringify({ action: 'photoPrepare', apiVersion: 2, albumVersion: 2, designFormat: 'svg-scene-v1',
          userHash: rawOwner, petId, requestId, accessKind: 'owner', ...extra }) }));
      return { status: result.status, body: await result.json() };
    };
    const noMutations = () => {
      assert.ok(calls.every((call) => call.method === 'GET' || call.path.includes('/storage/v1/object/sign/')
        || ['/check_pet_api_rate_limit', '/get_existing_pet_photos', '/authorize_pet_album_photo'].some((suffix) => call.path.endsWith(suffix))));
      assert.ok(calls.every((call) => !/adopt|record|mark|complete|start|cancel|allowance/.test(call.path)));
    };

    await t.step('owner pending and approved preparation changes no business state', async () => {
      for (const status of ['pending', 'approved']) {
        reset(status); const before = structuredClone(rows);
        const result = await request({ ownerHash: 'forged' });
        assert.equal(result.status, 200); assert.equal(result.body.photoId, photoId);
        assert.equal(result.body.photoCaption, '준비한 사진');
        assert.equal(result.body.storagePath, undefined); assert.equal(result.body.allowance, undefined);
        assert.deepEqual(rows, before); noMutations();
        assert.deepEqual(calls.find((call) => call.path.endsWith('/check_pet_api_rate_limit'))?.body,
          { p_owner_hash: ownerHash, p_action: 'photoPrepare', p_window_seconds: 60, p_limit: 30 });
      }
    });
    await t.step('wrong user and pending other-user replay never sign', async () => {
      for (const accessKind of ['owner', 'replay']) {
        reset('pending', 'different-owner');
        const result = await request({ accessKind, ownerHash: 'different-owner', isMine: true });
        assert.equal(result.status, 404); assert.equal(result.body.photoUrl, undefined);
        assert.ok(!calls.some((call) => call.path.includes('/storage/'))); noMutations();
      }
    });
    await t.step('only an exact persisted grant enables replay; unseen data cannot', async () => {
      reset('approved', 'different-owner');
      const unavailable = await request({ accessKind: 'replay', photoId, adSessionId: requestId });
      assert.equal(unavailable.status, 404); assert.equal(unavailable.body.photoUrl, undefined);
      reset('approved', 'different-owner', true); const before = structuredClone(rows);
      const result = await request({ accessKind: 'replay' });
      assert.equal(result.status, 200); assert.equal(result.body.photoId, photoId);
      assert.deepEqual(rows, before); noMutations();
      assert.deepEqual(calls.find((call) => call.path.endsWith('/authorize_pet_album_photo'))?.body,
        { p_owner_hash: ownerHash, p_photo_id: photoId });
    });
    await t.step('invalid request ID, paid access kind and throttled callers cannot sign', async () => {
      for (const invalid of [{ requestId: 'bad' }, { accessKind: 'collect' }]) {
        reset(); const result = await request(invalid);
        assert.equal(result.status, 400); assert.ok(!calls.some((call) => call.path.includes('/storage/')));
      }
      reset(); rateAllowed = false;
      const limited = await request(); assert.equal(limited.status, 429);
      assert.equal(calls.length, 1);
    });
    await t.step('final owner photo signs successfully before recording a visit; a failed attempt can retry', async () => {
      reset(); signingFails = true;
      const failed = await request({ action: 'ownerPhoto' });
      assert.equal(failed.status, 500);
      assert.equal(failed.body.photoUrl, undefined);
      assert.equal(rows.daily_pet_views.length, 0);
      assert.ok(!calls.some((call) => call.path.endsWith('/daily_pet_views')));

      signingFails = false; calls = [];
      const success = await request({ action: 'ownerPhoto' });
      assert.equal(success.status, 200);
      assert.equal(success.body.photoId, photoId);
      assert.equal(rows.daily_pet_views.length, 1);
      assert.equal(rows.daily_pet_views[0].owner_hash, ownerHash);
      assert.equal(rows.daily_pet_views[0].pet_id, petId);
      const signIndex = calls.findIndex((call) => call.path.includes('/storage/v1/object/sign/'));
      const visitIndex = calls.findIndex((call) => call.path.endsWith('/daily_pet_views'));
      assert.ok(signIndex >= 0 && visitIndex > signIndex);
      assert.equal((await request({ action: 'ownerPhoto' })).status, 200);
      assert.equal(rows.daily_pet_views.length, 1, 'a retry keeps the same daily view');
      assert.equal(rows.user_photo_unlocks.length, 0);
      assert.equal(rows.pet_daily_photo_collections.length, 0);
    });
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch;
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value); }
  }
});
