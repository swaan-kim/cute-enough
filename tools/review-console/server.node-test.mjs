import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  PhotoTokenStore,
  applySecurityHeaders,
  createReviewApiHandler,
  createSupabaseReviewGateway,
  loadReviewConfig,
  validatePublicationInput,
  validateReviewInput,
} from './server-lib.mjs';

const PET_ID = '11111111-1111-4111-8111-111111111111';
const TRAITS = { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'cream', secondaryColor: 'caramel', markingPattern: 'none', muzzle: 'short', confidence: 1 };
const STYLE = { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' };

test('queue exposes only safe fields and opaque same-origin photo URLs', async (t) => {
  const secretPath = 'owners/sensitive-hash/original.webp';
  const signedUrl = `https://example.supabase.co/storage/v1/object/sign/pet-photos/${secretPath}?token=secret-token`;
  const gateway = {
    async listPending() {
      return [{
        petId: PET_ID,
        name: '부용',
        traits: { schemaVersion: 1, baseColor: 'cream' },
        submittedTraits: TRAITS,
        submittedStyle: STYLE,
        publishedStyle: STYLE,
        createdAt: '2026-08-29T00:00:00.000Z',
        photoPresent: true,
        signedPhotoUrls: [signedUrl],
        accessorySelectionMode: 'reviewer',
        accessoryRequired: true,
        requestedAccessory: null,
        publishedAccessory: null,
        designVersion: 1,
        similarPets: [],
        ownerHash: 'sensitive-hash',
        storagePaths: [secretPath],
        serviceRoleKey: 'never-return-this',
      }];
    },
    async review() {
      throw new Error('not used');
    },
  };
  const fetchFn = async (url) => {
    assert.equal(url, signedUrl);
    return new Response(Buffer.from([1, 2, 3]), {
      headers: { 'content-type': 'image/webp' },
    });
  };
  const fixture = await startFixture({ gateway, fetchFn });
  t.after(fixture.close);

  const queueResponse = await fetch(`${fixture.origin}/api/review-queue`);
  assert.equal(queueResponse.status, 200);
  assert.equal(queueResponse.headers.get('x-frame-options'), 'DENY');
  const queueText = await queueResponse.text();
  assert.doesNotMatch(queueText, /sensitive-hash|original\.webp|secret-token|never-return-this/);
  const queue = JSON.parse(queueText);
  assert.deepEqual(Object.keys(queue.items[0]).sort(), [
    'accessoryRequired', 'accessorySelectionMode', 'createdAt', 'designVersion', 'name',
    'petId', 'photoPresent', 'photoUrls', 'publishedAccessory', 'publishedStyle',
    'requestedAccessory', 'similarPets', 'submittedStyle', 'submittedTraits', 'traits',
  ]);
  assert.match(queue.items[0].photoUrls[0], /^\/api\/review-photo\/[A-Za-z0-9_-]+$/);

  const photoResponse = await fetch(`${fixture.origin}${queue.items[0].photoUrls[0]}`);
  assert.equal(photoResponse.status, 200);
  assert.equal(photoResponse.headers.get('content-type'), 'image/webp');
  assert.deepEqual([...new Uint8Array(await photoResponse.arrayBuffer())], [1, 2, 3]);
});

test('review requires exact origin, JSON, and normalized validated input', async (t) => {
  const calls = [];
  const gateway = {
    async listPending() { return []; },
    async review(input) {
      calls.push(input);
      return input.decision;
    },
  };
  const fixture = await startFixture({ gateway });
  t.after(fixture.close);

  const forbidden = await fetch(`${fixture.origin}/api/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ petId: PET_ID, decision: 'approved' }),
  });
  assert.equal(forbidden.status, 403);

  const wrongType = await fetch(`${fixture.origin}/api/review`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: fixture.origin },
    body: '{}',
  });
  assert.equal(wrongType.status, 415);

  const accepted = await fetch(`${fixture.origin}/api/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: fixture.origin },
    body: JSON.stringify({ petId: PET_ID.toUpperCase(), decision: 'rejected', reason: '  사진이 흐려요.  ' }),
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { petId: PET_ID, status: 'rejected' });
  assert.deepEqual(calls, [{
    petId: PET_ID,
    decision: 'rejected',
    reason: '사진이 흐려요.',
    finalName: null,
    finalTraits: null,
    finalStyle: null,
    publishedAccessory: null,
    reviewNote: null,
  }]);
});

test('review rejects oversized and malformed requests before gateway calls', async (t) => {
  let reviewCalls = 0;
  const fixture = await startFixture({
    bodyLimitBytes: 80,
    gateway: {
      async listPending() { return []; },
      async review() { reviewCalls += 1; },
    },
  });
  t.after(fixture.close);

  const oversized = await fetch(`${fixture.origin}/api/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: fixture.origin },
    body: JSON.stringify({ petId: PET_ID, decision: 'rejected', reason: 'x'.repeat(200) }),
  });
  assert.equal(oversized.status, 413);

  const invalid = await fetch(`${fixture.origin}/api/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: fixture.origin },
    body: JSON.stringify({ petId: 'not-a-uuid', decision: 'approved' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(reviewCalls, 0);
});

test('photo tokens expire without revealing their upstream URL', () => {
  let now = 10_000;
  const store = new PhotoTokenStore({ now: () => now, randomToken: () => 'opaque_token_1234567890' });
  const token = store.issue('https://example.invalid/private/path', 180);
  assert.equal(token, 'opaque_token_1234567890');
  assert.equal(store.consume(token), 'https://example.invalid/private/path');
  now += 180_000;
  assert.equal(store.consume(token), null);
});

test('Supabase gateway selects only review fields, signs for 180 seconds, and calls the review RPC', async () => {
  const trace = [];
  const query = {
    select(columns) { trace.push(['select', columns]); return this; },
    async order(column, options) {
      trace.push(['order', column, options]);
      return { data: [{
        pet_id: PET_ID,
        name: '부용',
        traits: TRAITS,
        submitted_traits: TRAITS,
        submitted_style: STYLE,
        published_style: STYLE,
        created_at: '2026-08-29T00:00:00Z',
        storage_paths: ['private/photo.webp'],
        photo_present: true,
        accessory_selection_mode: 'reviewer',
        accessory_required: true,
        requested_accessory: null,
        published_accessory: null,
        design_version: 1,
        similar_pets: [],
      }], error: null };
    },
  };
  const client = {
    from(table) { trace.push(['from', table]); return query; },
    storage: {
      from(bucket) {
        trace.push(['bucket', bucket]);
        return {
          async createSignedUrl(storagePath, ttl) {
            trace.push(['sign', storagePath, ttl]);
            return {
              data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/pet-photos/${storagePath}?token=x` },
              error: null,
            };
          },
        };
      },
    },
    async rpc(name, args) {
      trace.push(['rpc', name, args]);
      return { data: 'approved', error: null };
    },
  };
  const gateway = createSupabaseReviewGateway({
    actor: 'reviewer',
    client,
    supabaseUrl: 'https://example.supabase.co',
  });

  const rows = await gateway.listPending();
  assert.equal(rows[0].signedPhotoUrls.length, 1);
  assert.ok(trace.some((entry) => entry[0] === 'sign' && entry[2] === 180));
  assert.ok(trace.some((entry) => entry[0] === 'select' && !entry[1].includes('owner_hash')));
  const publishedAccessory = { kind: 'scarf', color: 'mint', assetKey: 'builtin:scarf' };
  await gateway.review({ petId: PET_ID, decision: 'approved', reason: null, finalName: '티티', finalTraits: TRAITS, finalStyle: STYLE, publishedAccessory, reviewNote: '대비 확인' });
  assert.deepEqual(trace.at(-1), ['rpc', 'review_pet_submission_v5', {
    p_actor: 'reviewer',
    p_decision: 'approved',
    p_pet_id: PET_ID,
    p_reason: null,
    p_final_name: '티티',
    p_final_traits: TRAITS,
    p_final_style: STYLE,
    p_published_accessory: publishedAccessory,
    p_review_note: '대비 확인',
  }]);
});

test('Supabase gateway keeps only fully identical decoration matches', async () => {
  const exact = {
    id: '22222222-2222-4222-8222-222222222222',
    name: '완전같음',
    traits: { ...TRAITS, confidence: 0.2 },
    publishedStyle: STYLE,
    publishedAccessory: null,
    designVersion: 1,
  };
  const partial = {
    ...exact,
    id: '33333333-3333-4333-8333-333333333333',
    name: '부분같음',
    traits: { ...TRAITS, secondaryColor: 'white' },
  };
  const query = {
    select() { return this; },
    async order() {
      return { data: [{
        pet_id: PET_ID, name: '부용', traits: TRAITS, submitted_traits: TRAITS,
        submitted_style: STYLE, published_style: STYLE, created_at: '2026-08-29T00:00:00Z',
        storage_paths: [], photo_present: false, accessory_selection_mode: 'reviewer',
        accessory_required: false, requested_accessory: null, published_accessory: null,
        design_version: 1, similar_pets: [partial, exact],
      }], error: null };
    },
  };
  const client = {
    from() { return query; },
    storage: { from() { return { createSignedUrl: async () => ({ data: null, error: null }) }; } },
  };
  const gateway = createSupabaseReviewGateway({ actor: 'reviewer', client, supabaseUrl: 'https://example.supabase.co' });

  const rows = await gateway.listPending();

  assert.deepEqual(rows[0].similarPets.map((pet) => pet.name), ['완전같음']);
});

test('review falls back to v4 only while the v5 RPC is missing from PostgREST', async () => {
  const trace = [];
  const client = {
    async rpc(name, args) {
      trace.push([name, args]);
      if (name === 'review_pet_submission_v5') {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.review_pet_submission_v5 in the schema cache',
          },
        };
      }
      return { data: 'approved', error: null };
    },
  };
  const gateway = createSupabaseReviewGateway({
    actor: 'reviewer',
    client,
    supabaseUrl: 'https://example.supabase.co',
  });
  const input = {
    petId: PET_ID,
    decision: 'approved',
    reason: null,
    finalName: '티티',
    finalTraits: TRAITS,
    finalStyle: STYLE,
    publishedAccessory: null,
    reviewNote: null,
  };

  assert.equal(await gateway.review(input), 'approved');
  assert.deepEqual(trace.map(([name]) => name), [
    'review_pet_submission_v5',
    'review_pet_submission_v4',
  ]);
  assert.deepEqual(trace[0][1], trace[1][1]);
});

test('review never retries a v5 domain conflict through the legacy RPC', async () => {
  const calls = [];
  const client = {
    async rpc(name) {
      calls.push(name);
      return {
        data: null,
        error: {
          code: 'P0001',
          message: 'OWNER_ACCESSORY_IMMUTABLE',
        },
      };
    },
  };
  const gateway = createSupabaseReviewGateway({
    actor: 'reviewer',
    client,
    supabaseUrl: 'https://example.supabase.co',
  });

  await assert.rejects(
    () => gateway.review({
      petId: PET_ID,
      decision: 'approved',
      reason: null,
      finalName: '티티',
      finalTraits: TRAITS,
      finalStyle: STYLE,
      publishedAccessory: { kind: 'scarf', color: 'mint', assetKey: 'builtin:scarf' },
      reviewNote: null,
    }),
    (error) => error?.name === 'PublicHttpError' && error?.code === 'OWNER_ACCESSORY_IMMUTABLE',
  );
  assert.deepEqual(calls, ['review_pet_submission_v5']);
});

test('one signing failure does not hide the rest of the review queue photos', async () => {
  const client = {
    from() {
      return {
        select() { return this; },
        async order() {
          return { data: [{
            pet_id: PET_ID,
            name: null,
            traits: {},
            created_at: '2026-08-29T00:00:00Z',
            storage_paths: ['missing.webp', 'present.webp'],
            photo_present: true,
          }], error: null };
        },
      };
    },
    storage: {
      from() {
        return {
          async createSignedUrl(storagePath) {
            if (storagePath === 'missing.webp') return { data: null, error: { code: 'not_found' } };
            return {
              data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/pet-photos/${storagePath}?token=x` },
              error: null,
            };
          },
        };
      },
    },
  };
  const gateway = createSupabaseReviewGateway({
    actor: 'reviewer',
    client,
    supabaseUrl: 'https://example.supabase.co',
  });

  const [item] = await gateway.listPending();
  assert.equal(item.name, '이름 없음');
  assert.equal(item.photoPresent, true);
  assert.equal(item.signedPhotoUrls.length, 1);
  assert.match(item.signedPhotoUrls[0], /present\.webp/);
});

test('configuration has a fixed loopback host and requires server-only credentials', () => {
  assert.throws(() => loadReviewConfig({}), /REVIEW_SUPABASE_URL/);
  const config = loadReviewConfig({
    REVIEW_PORT: '4317',
    REVIEW_OPERATOR_ID: 'reviewer',
    REVIEW_SUPABASE_SECRET_KEY: 'server-secret',
    REVIEW_SUPABASE_URL: 'https://example.supabase.co/path-is-discarded',
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.operatorId, 'reviewer');
  assert.equal(config.port, 4317);
  assert.equal(config.supabaseUrl, 'https://example.supabase.co');
  assert.equal(config.secretKey, 'server-secret');

  const legacyConfig = loadReviewConfig({
    REVIEW_SUPABASE_SERVICE_ROLE_KEY: 'legacy-secret',
    REVIEW_SUPABASE_URL: 'https://example.supabase.co',
  });
  assert.equal(legacyConfig.port, 4178);
  assert.equal(legacyConfig.secretKey, 'legacy-secret');
  assert.throws(() => loadReviewConfig({
    REVIEW_SUPABASE_SECRET_KEY: 'server-secret',
    REVIEW_SUPABASE_URL: 'http://remote.example',
  }), /must use HTTPS/);
});

test('input validator requires a rejection reason, forbids approval reasons, and accepts a bounded review note', () => {
  assert.throws(
    () => validateReviewInput({ petId: PET_ID, decision: 'rejected', reason: '  ' }),
    /REJECTION_REASON_REQUIRED/,
  );
  assert.throws(
    () => validateReviewInput({ petId: PET_ID, decision: 'approved', reason: 'unexpected' }),
    /APPROVAL_REASON_NOT_ALLOWED/,
  );
  assert.deepEqual(validateReviewInput({
    petId: PET_ID,
    decision: 'approved',
    finalName: ' 티티 ',
    finalTraits: TRAITS,
    finalStyle: STYLE,
    publishedAccessory: { kind: 'ball', color: 'yellow', assetKey: 'builtin:ball' },
    reviewNote: '작은 화면 대비 확인',
  }), {
    petId: PET_ID,
    decision: 'approved',
    reason: null,
    finalName: '티티',
    finalTraits: TRAITS,
    finalStyle: STYLE,
    publishedAccessory: { kind: 'ball', color: 'yellow', assetKey: 'builtin:ball' },
    reviewNote: '작은 화면 대비 확인',
  });
  assert.throws(
    () => validateReviewInput({ petId: PET_ID, decision: 'approved', finalName: '이름이너무길어요', finalTraits: TRAITS, finalStyle: STYLE }),
    /INVALID_FINAL_PET_NAME/,
  );
});

test('publication validator requires an audit note and a valid design for revisions', () => {
  assert.throws(() => validatePublicationInput({ petId: PET_ID, action: 'pause', reviewNote: ' ' }), /REVIEW_NOTE_REQUIRED/);
  assert.deepEqual(validatePublicationInput({ petId: PET_ID, action: 'pause', reviewNote: '원본 재확인' }), {
    petId: PET_ID,
    action: 'pause',
    finalTraits: null,
    finalStyle: null,
    publishedAccessory: null,
    reviewNote: '원본 재확인',
  });
  assert.deepEqual(validatePublicationInput({ petId: PET_ID, action: 'revise', finalTraits: TRAITS, finalStyle: STYLE, publishedAccessory: null, reviewNote: '복슬한 털로 보정' }), {
    petId: PET_ID,
    action: 'revise',
    finalTraits: TRAITS,
    finalStyle: STYLE,
    publishedAccessory: null,
    reviewNote: '복슬한 털로 보정',
  });
});

async function startFixture({ gateway, fetchFn = fetch, bodyLimitBytes } = {}) {
  const logger = { error() {} };
  let handler;
  const server = http.createServer(async (request, response) => {
    const address = server.address();
    const expectedOrigin = `http://127.0.0.1:${address.port}`;
    applySecurityHeaders(response, expectedOrigin);
    handler ??= createReviewApiHandler({
      bodyLimitBytes,
      expectedOrigin,
      fetchFn,
      gateway,
      logger,
    });
    if (!(await handler(request, response))) {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    origin: `http://127.0.0.1:${address.port}`,
  };
}
