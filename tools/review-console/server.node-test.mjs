import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  PhotoTokenStore,
  applySecurityHeaders,
  createReviewApiHandler,
  createSupabaseReviewGateway,
  loadReviewConfig,
  validateReviewInput,
} from './server-lib.mjs';

const PET_ID = '11111111-1111-4111-8111-111111111111';

test('queue exposes only safe fields and opaque same-origin photo URLs', async (t) => {
  const secretPath = 'owners/sensitive-hash/original.webp';
  const signedUrl = `https://example.supabase.co/storage/v1/object/sign/pet-photos/${secretPath}?token=secret-token`;
  const gateway = {
    async listPending() {
      return [{
        petId: PET_ID,
        name: '부용',
        traits: { schemaVersion: 1, baseColor: 'cream' },
        createdAt: '2026-08-29T00:00:00.000Z',
        photoPresent: true,
        signedPhotoUrls: [signedUrl],
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
    'createdAt', 'name', 'petId', 'photoPresent', 'photoUrls', 'traits',
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
  assert.deepEqual(calls, [{ petId: PET_ID, decision: 'rejected', reason: '사진이 흐려요.' }]);
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
        traits: { schemaVersion: 1 },
        created_at: '2026-08-29T00:00:00Z',
        storage_paths: ['private/photo.webp'],
        photo_present: true,
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
  await gateway.review({ petId: PET_ID, decision: 'approved', reason: null });
  assert.deepEqual(trace.at(-1), ['rpc', 'review_pet_submission', {
    p_actor: 'reviewer',
    p_decision: 'approved',
    p_pet_id: PET_ID,
    p_reason: null,
  }]);
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

test('input validator requires a rejection reason and forbids approval notes', () => {
  assert.throws(
    () => validateReviewInput({ petId: PET_ID, decision: 'rejected', reason: '  ' }),
    /REJECTION_REASON_REQUIRED/,
  );
  assert.throws(
    () => validateReviewInput({ petId: PET_ID, decision: 'approved', reason: 'unexpected' }),
    /APPROVAL_REASON_NOT_ALLOWED/,
  );
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
