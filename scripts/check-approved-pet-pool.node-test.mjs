import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MINIMUM_PET_COUNT,
  fetchApprovedPetPool,
  makePoolReport,
  parseMinimum,
} from './check-approved-pet-pool.mjs';

const SECRET = 'server-secret-never-print';

test('uses eight as the default and validates an explicit minimum', () => {
  assert.equal(parseMinimum([]), DEFAULT_MINIMUM_PET_COUNT);
  assert.equal(parseMinimum(['--min=12']), 12);
  assert.throws(() => parseMinimum(['--min=0']), /1 이상/);
  assert.throws(() => parseMinimum(['--min=dogs']), /정수/);
});

test('queries only the service-role RPC and normalizes its safe result', async () => {
  const requests = [];
  const pets = await fetchApprovedPetPool({
    secretKey: SECRET,
    supabaseUrl: 'https://example.supabase.co',
    async fetchFn(url, options) {
      requests.push({ url, options });
      return new Response(JSON.stringify([{
        pet_id: '11111111-1111-4111-8111-111111111111',
        name: '우유',
        active_photo_count: 2,
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.deepEqual(pets, [{
    petId: '11111111-1111-4111-8111-111111111111',
    name: '우유',
    activePhotoCount: 2,
  }]);
  assert.equal(requests[0].url, 'https://example.supabase.co/rest/v1/rpc/get_approved_active_photo_pet_pool');
  assert.equal(requests[0].options.headers.apikey, SECRET);
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(requests[0].options.body, '{}');
});

test('reports names and fails readiness below the checked threshold', () => {
  const pets = Array.from({ length: 7 }, (_, index) => ({
    petId: String(index),
    name: `강아지${index + 1}`,
    activePhotoCount: 1,
  }));
  const report = makePoolReport(pets, 8);
  assert.equal(report.ready, false);
  assert.match(report.text, /7\/8마리/);
  assert.match(report.text, /강아지1 · 활성 사진 1장/);
  assert.match(report.text, /1마리를 더 승인/);
  assert.doesNotMatch(report.text, /server-secret/);
});

test('does not echo an upstream response body or secret on failure', async () => {
  await assert.rejects(
    fetchApprovedPetPool({
      secretKey: SECRET,
      supabaseUrl: 'https://example.supabase.co',
      async fetchFn() {
        return new Response(JSON.stringify({
          code: 'PGRST202',
          message: `internal detail ${SECRET}`,
        }), { status: 404, headers: { 'content-type': 'application/json' } });
      },
    }),
    (error) => {
      assert.match(error.message, /HTTP 404 \(PGRST202\)/);
      assert.doesNotMatch(error.message, new RegExp(SECRET));
      return true;
    },
  );
});
