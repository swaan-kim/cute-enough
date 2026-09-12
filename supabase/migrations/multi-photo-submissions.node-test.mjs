import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const sql = (name) => readFile(new URL(name, import.meta.url), 'utf8');
const traits = { schemaVersion: 1, earShape: 'upright', headShape: 'round', baseColor: 'white', secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 0.4 };
const style = { schemaVersion: 1, coatMode: 'solid', furStyle: 'fluffy' };
const requested = { kind: 'ball', color: 'yellow', assetKey: 'builtin:ball' };
let date;
let historical;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  await db.exec((await sql('20260823000100_initial_schema.sql')).replace('create extension if not exists pgcrypto;', ''));
  await db.exec(await sql('20260824000200_upload_rewards_and_sharing.sql'));
  await db.exec(await sql('20260824000300_api_security.sql'));
  const hardening = await sql('20260824000400_submission_hardening.sql');
  await db.exec(hardening.slice(0, hardening.indexOf('delete from public.pet_api_rate_limits')));
  await db.exec(await sql('20260825000200_pet_photos.sql'));
  // Execute the actual v2/v3 registration functions and their validations. The
  // unrelated review/house RPCs below these sections need no test doubles.
  const accessory = await sql('20260829000200_pet_accessories_and_review.sql');
  await db.exec(accessory.slice(0, accessory.indexOf('create or replace function public.review_pet_submission_v2')));
  const styles = await sql('20260901000100_pet_styles_and_design_review.sql');
  await db.exec(styles.slice(0, styles.indexOf('create or replace function public.register_pet_submission_v3')));
  await db.exec(await sql('20260905000500_immutable_submission_retries.sql'));
  date = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text as registration_date")).rows[0].registration_date;
  historical = randomUUID();
  await db.query("insert into pets(id,owner_hash,name,storage_path,status,traits) values($1,'historical','구르미','historic-0.jpg','approved',$2)", [historical, traits]);
  for (let i = 1; i < 8; i++) {
    await db.query('insert into pet_photos(pet_id,storage_path,sort_order) values($1,$2,$3)', [historical, `historic-${i}.jpg`, i]);
  }
  await db.query("insert into admin_audit_logs(pet_id,actor,action,detail) values($1,'creator','review_approved','{}')", [historical]);
  await db.exec(await sql('20260906000400_multi_photo_submissions.sql'));
});
after(() => db.close());

async function input(count = 5, owner = randomUUID()) {
  const id = randomUUID();
  const submission = randomUUID();
  const paths = Array.from({ length: count }, (_, i) => `${owner}/${submission}/${id}/${i}.jpg`);
  for (const path of paths) await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
  return { id, submission, owner, paths, count };
}
function register(item, overrides = {}) {
  const fields = { ...item, name: '구르미', traits, style, date, dailyLimit: 100, pendingLimit: 100, ...overrides };
  return db.query('select * from register_pet_submission_v4($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
    fields.owner, fields.submission, fields.id, fields.paths, fields.name, fields.traits, fields.style,
    fields.date, fields.dailyLimit, fields.pendingLimit, 'owner', requested,
  ]);
}
async function counts(id) {
  return (await db.query(`select (select count(*)::int from pets where id=$1) pets,
    (select count(*)::int from pet_photos where pet_id=$1) photos,
    (select count(*)::int from upload_rewards where pet_id=$1) rewards`, [id])).rows[0];
}

test('migration leaves every historical photo, approved pet and audit untouched', async () => {
  assert.deepEqual(await counts(historical), { pets: 1, photos: 8, rewards: 0 });
  assert.equal((await db.query('select status from pets where id=$1', [historical])).rows[0].status, 'approved');
  assert.equal((await db.query('select count(*)::int n from admin_audit_logs')).rows[0].n, 1);
});

test('one and five photos create one pending dog, ordered complete rows and one reward', async () => {
  for (const count of [1, 5]) {
    const item = await input(count);
    assert.deepEqual((await register(item)).rows, [{ pet_id: item.id, reward_granted: true }]);
    assert.deepEqual(await counts(item.id), { pets: 1, photos: count, rewards: 1 });
    const pet = (await db.query('select * from pets where id=$1', [item.id])).rows[0];
    assert.equal(pet.status, 'pending');
    assert.equal(pet.storage_path, item.paths[0]);
    assert.equal(pet.moderation.requiresHumanReview, true);
    assert.deepEqual(pet.submitted_traits, traits);
    assert.deepEqual(pet.submitted_style, style);
    assert.deepEqual((await db.query('select storage_path,sort_order,is_active from pet_photos where pet_id=$1 order by sort_order', [item.id])).rows,
      item.paths.map((storage_path, sort_order) => ({ storage_path, sort_order, is_active: true })));
  }
});

test('five staged owner/submission-bound paths finalize atomically and preserve source order', async () => {
  const item = await input(0);
  item.paths = Array.from({ length: 5 }, (_, i) => `${item.owner}/${item.submission}/staged/${i}-${randomUUID()}.jpg`);
  for (const path of item.paths) await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
  await register(item);
  assert.deepEqual(await counts(item.id), { pets: 1, photos: 5, rewards: 1 });
  assert.deepEqual((await db.query('select storage_path from pet_photos where pet_id=$1 order by sort_order', [item.id])).rows.map((row) => row.storage_path), item.paths);
  const crossed = await input(0);
  await assert.rejects(() => register(crossed, { paths: item.paths }), /INVALID_PHOTO_PATH/);
  assert.deepEqual(await counts(crossed.id), { pets: 0, photos: 0, rewards: 0 });
});

test('zero, six, malformed, duplicate and missing-storage photo sets create no partial dog or credit', async () => {
  const item = await input();
  const cases = [
    { paths: [], error: /INVALID_PHOTO_COUNT/ },
    { paths: null, error: /INVALID_PHOTO_COUNT/ },
    { paths: [...item.paths, 'sixth.jpg'], error: /INVALID_PHOTO_COUNT/ },
    { paths: [item.paths[0], item.paths[0]], error: /INVALID_PHOTO_PATH/ },
    { paths: [item.paths[0], null], error: /INVALID_PHOTO_PATH/ },
    { paths: ['someone-else/photo.jpg'], error: /INVALID_PHOTO_PATH/ },
  ];
  for (const { paths, error } of cases) {
    await assert.rejects(() => register(item, { paths }), error);
    assert.deepEqual(await counts(item.id), { pets: 0, photos: 0, rewards: 0 });
  }
  await db.query('delete from storage.objects where name=$1', [item.paths[4]]);
  await assert.rejects(() => register(item), /PET_PHOTO_MISSING/);
  assert.deepEqual(await counts(item.id), { pets: 0, photos: 0, rewards: 0 });
});

test('failure inserting an additional row rolls back primary photo, dog and reward', async () => {
  const item = await input();
  await db.exec(`create function fail_fourth_test_photo() returns trigger language plpgsql as $$
    begin if new.sort_order=3 then raise exception 'TEST_EXTRA_PHOTO_FAILURE'; end if; return new; end$$;
    create trigger fail_fourth_test_photo before insert on pet_photos for each row execute function fail_fourth_test_photo();`);
  try {
    await assert.rejects(() => register(item), /TEST_EXTRA_PHOTO_FAILURE/);
    assert.deepEqual(await counts(item.id), { pets: 0, photos: 0, rewards: 0 });
  } finally {
    await db.exec('drop trigger fail_fourth_test_photo on pet_photos; drop function fail_fourth_test_photo();');
  }
  await register(item);
  assert.deepEqual(await counts(item.id), { pets: 1, photos: 5, rewards: 1 });
});

test('retry after creator changes returns immutable first submission without appending photos or rewarding again', async () => {
  const original = await input(3);
  await register(original);
  await db.query("update pets set name='최종',status='approved',reviewed_at=now(),design_version=7 where id=$1", [original.id]);
  const before = (await db.query('select * from pets where id=$1', [original.id])).rows[0];
  const retry = await input(5, original.owner);
  const result = await register(retry, { submission: original.submission, paths: [], name: '변경', traits: {} });
  assert.deepEqual(result.rows, [{ pet_id: original.id, reward_granted: true }]);
  assert.deepEqual(await counts(original.id), { pets: 1, photos: 3, rewards: 1 });
  assert.deepEqual(await counts(retry.id), { pets: 0, photos: 0, rewards: 0 });
  assert.deepEqual((await db.query('select * from pets where id=$1', [original.id])).rows[0], before);
});

test('photo count never multiplies daily dog, pending dog or global capacity limits', async () => {
  const first = await input(5);
  await register(first);
  const second = await input(5, first.owner);
  await assert.rejects(() => register(second), /DAILY_UPLOAD_LIMIT_REACHED/);
  assert.deepEqual(await counts(second.id), { pets: 0, photos: 0, rewards: 0 });
  const overCapacity = await input();
  await assert.rejects(() => register(overCapacity, { pendingLimit: 1 }), /UPLOAD_CAPACITY_REACHED/);
  await assert.rejects(() => register(overCapacity, { dailyLimit: 1 }), /UPLOAD_CAPACITY_REACHED/);
  assert.deepEqual(await counts(overCapacity.id), { pets: 0, photos: 0, rewards: 0 });
  const pendingOwner = randomUUID();
  for (let i = 0; i < 3; i++) {
    await db.query("insert into pets(owner_hash,storage_path,name,traits,created_at) values($1,$2,'대기',$3,now()-interval '2 days')", [pendingOwner, `pending-${i}-${pendingOwner}.jpg`, traits]);
  }
  const pending = await input(5, pendingOwner);
  await assert.rejects(() => register(pending), /PENDING_UPLOAD_LIMIT_REACHED/);
  assert.deepEqual(await counts(pending.id), { pets: 0, photos: 0, rewards: 0 });
});

test('RPC is service-only and private photo tables remain unreadable to public roles', async () => {
  const signature = 'register_pet_submission_v4(text,uuid,uuid,text[],text,jsonb,jsonb,date,integer,integer,text,jsonb)';
  const row = (await db.query(`select has_function_privilege('anon',$1,'execute') anon_rpc,
    has_function_privilege('authenticated',$1,'execute') authenticated_rpc,
    has_function_privilege('service_role',$1,'execute') service_rpc,
    has_table_privilege('anon','pet_photos','select') anon_photos,
    has_table_privilege('authenticated','pet_photos','select') authenticated_photos,
    (select public from storage.buckets where id='pet-photos') bucket_public`, [signature])).rows[0];
  assert.deepEqual(row, { anon_rpc: false, authenticated_rpc: false, service_rpc: true, anon_photos: false, authenticated_photos: false, bucket_public: false });
});

test('staged photo requests have their own bounded rate bucket and never consume submit attempts', async () => {
  const owner = randomUUID();
  for (let i = 0; i < 21; i++) {
    const row = (await db.query("select check_pet_api_rate_limit($1,'submitPhoto',3600,20) allowed", [owner])).rows[0];
    assert.equal(row.allowed, i < 20);
  }
  assert.equal((await db.query("select check_pet_api_rate_limit($1,'submit',3600,3) allowed", [owner])).rows[0].allowed, true);
});
