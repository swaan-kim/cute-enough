// Actual SQL in isolated in-memory PostgreSQL only. No credentials, network,
// deployment or collection-reset execution. Existing migrations are read-only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = new URL('./', import.meta.url);
const migration = '20260921000100_photo_unlock_integrity.sql';
const db = new PGlite({ extensions: { pgcrypto } });
const rpc = async (client, name, ...args) => (await client.query(
  `select public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) as result`, args,
)).rows[0].result;
const today = async (client) => (await client.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
const photos = async (client, petId) => (await client.query('select * from public.pet_photos where pet_id=$1 order by sort_order nulls last,id', [petId])).rows;
const foreignKeyViolation = (error) => error.code === '23503' && error.message.includes('user_photo_unlocks_photo_pet_fkey');

async function serviceRole(client, action) {
  await client.exec('set role service_role');
  try { return await action(); }
  finally { await client.exec('reset role'); }
}

async function snapshot(client) {
  const tables = (await client.query(`select schemaname,tablename from pg_tables
    where schemaname in ('public','storage','pet_collection_reset_private') order by schemaname,tablename`)).rows;
  const result = {};
  for (const { schemaname, tablename } of tables) {
    assert.match(schemaname, /^[a-z_]+$/); assert.match(tablename, /^[a-z_]+$/);
    result[`${schemaname}.${tablename}`] = (await client.query(
      `select to_jsonb(row) as value from ${schemaname}.${tablename} row order by to_jsonb(row)::text`,
    )).rows.map((row) => row.value);
  }
  return result;
}

async function collect(client, viewer, petId, request = randomUUID()) {
  const prepared = await rpc(client, 'prepare_pet_photo_unlock', viewer, petId, request, 'FREE', null);
  return rpc(client, 'record_pet_photo_unlock', viewer, await today(client), petId, prepared.photoId, 'FREE', request, null);
}

async function setupPreviousSchema(client) {
  await client.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),primary key(bucket_id,name));`);
  const files = (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name) && name < migration
    // Same harness exceptions as the existing SQL suites: a named operational
    // repair and the pg_net worker, which has a dedicated notification suite.
    && !['20260829000100_fix_wooyoo_white_traits.sql','20260905000400_recharge_notifications.sql'].includes(name)).sort();
  for (const file of files.filter((name) => name < '20260906000100')) await client.exec(await readFile(new URL(file, root), 'utf8'));
  // Historical approved fixtures precede the SVG publication guard. The
  // migration under test never approves or changes any dog's public design.
  const pets = [randomUUID(), randomUUID()];
  for (const petId of pets) {
    const path = `integrity-fixture/${petId}/0.jpg`;
    await client.query(`insert into public.pets(id,owner_hash,name,storage_path,traits,status,created_at,reviewed_at)
      values($1,$2,'친구',$3,'{}','approved',now()-interval '2 days',now()-interval '2 days')`, [petId, `fixture-owner-${petId}`, path]);
    await client.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
    const extra = `integrity-fixture/${petId}/1.jpg`;
    await client.query('insert into public.pet_photos(pet_id,storage_path,sort_order) values($1,$2,1)', [petId, extra]);
    await client.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [extra]);
  }
  for (const file of files.filter((name) => name >= '20260906000100')) await client.exec(await readFile(new URL(file, root), 'utf8'));
  const viewer = `integrity-viewer-${randomUUID()}`, request = randomUUID();
  const collected = await serviceRole(client, () => collect(client, viewer, pets[0], request));
  await rpc(client, 'set_pet_favorite', viewer, pets[0], true);
  await client.query('insert into public.pet_bonus_accounts(owner_hash,balance) values($1,2)', [viewer]);
  const review = await rpc(client, 'get_pet_photo_review', pets[0]);
  await rpc(client, 'save_pet_photo_review', pets[0], review.revision,
    JSON.stringify(review.photos.map((photo) => ({ photoId: photo.photoId, caption: '기존 사진' }))), 'fixture-creator');
  assert.equal(await rpc(client, 'get_pet_album_collection_reset_status'), null);
  return { pets, viewer, request, collected };
}

let fixture, beforeMigration, sql, deletePrivilegeBefore;
before(async () => {
  fixture = await setupPreviousSchema(db);
  beforeMigration = await snapshot(db);
  deletePrivilegeBefore = (await db.query("select has_table_privilege('service_role','public.pet_photos','DELETE') as allowed")).rows[0].allowed;
  sql = await readFile(new URL(migration, root), 'utf8');
  await db.exec(sql);
}, { timeout: 120000 });
after(() => db.close());

test('migration preserves every existing row, ticket, receipt and audit; reset remains unexecuted', async () => {
  assert.deepEqual(await snapshot(db), beforeMigration);
  assert.equal(await rpc(db, 'get_pet_album_collection_reset_status'), null);
  assert.equal((await db.query("select has_table_privilege('service_role','public.pet_photos','DELETE') as allowed")).rows[0].allowed, deletePrivilegeBefore);
  assert.equal(deletePrivilegeBefore, true, 'this change does not alter separate purge permissions');
  const constraints = (await db.query(`select conname,convalidated,confdeltype,confupdtype from pg_constraint
    where conrelid='public.user_photo_unlocks'::regclass and confrelid='public.pet_photos'::regclass`)).rows;
  assert.deepEqual(constraints, [{ conname: 'user_photo_unlocks_photo_pet_fkey', convalidated: true, confdeltype: 'a', confupdtype: 'a' }]);
  assert.equal((await rpc(db, 'authorize_pet_album_photo', fixture.viewer, fixture.collected.photoId)).petId, fixture.pets[0]);
});

test('service-role mismatched grant insert and updates fail without changing any data', async () => {
  const before = await snapshot(db), otherPhoto = (await photos(db, fixture.pets[1]))[0].id;
  await serviceRole(db, async () => {
    await assert.rejects(db.query(`insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source)
      values('invalid-new-grant',$1,$2,'reveal')`, [fixture.collected.photoId, fixture.pets[1]]), foreignKeyViolation);
    await assert.rejects(db.query('update public.user_photo_unlocks set pet_id=$1 where owner_hash=$2',
      [fixture.pets[1], fixture.viewer]), foreignKeyViolation);
    await assert.rejects(db.query('update public.user_photo_unlocks set photo_id=$1 where owner_hash=$2',
      [otherPhoto, fixture.viewer]), foreignKeyViolation);
  });
  assert.deepEqual(await snapshot(db), before);
});

test('deleting a referenced photo fails and preserves source, grant, receipt, progress and audit', async () => {
  const before = await snapshot(db);
  await serviceRole(db, () => assert.rejects(db.query('delete from public.pet_photos where id=$1',
    [fixture.collected.photoId]), foreignKeyViolation));
  assert.deepEqual(await snapshot(db), before);
  assert.equal((await rpc(db, 'authorize_pet_album_photo', fixture.viewer, fixture.collected.photoId)).photoId, fixture.collected.photoId);
});

test('normal collection and request retry still grant one exact photo and spend one natural ticket', async () => {
  const viewer = `fresh-viewer-${randomUUID()}`, request = randomUUID();
  const first = await serviceRole(db, () => collect(db, viewer, fixture.pets[0], request));
  assert.equal(first.freeRemaining, 1); assert.equal(first.alreadyRevealed, false);
  const committed = await snapshot(db);
  const retry = await serviceRole(db, () => collect(db, viewer, fixture.pets[0], request));
  assert.equal(retry.photoId, first.photoId); assert.equal(retry.reusedRequest, true);
  assert.deepEqual(await snapshot(db), committed);
  assert.deepEqual((await db.query(`select photo_id,pet_id from public.user_photo_unlocks where owner_hash=$1`, [viewer])).rows,
    [{ photo_id: first.photoId, pet_id: fixture.pets[0] }]);
});

test('creator exclusion, restoration and reordering preserve the same collected photo identity and receipts', async () => {
  const petId = fixture.pets[0], before = await snapshot(db);
  const original = await rpc(db, 'get_pet_photo_review', petId);
  const other = original.photos.find((photo) => photo.photoId !== fixture.collected.photoId);
  const excluded = await serviceRole(db, () => rpc(db, 'save_pet_photo_review', petId, original.revision,
    JSON.stringify([{ photoId: other.photoId, caption: other.caption }]), 'fixture-creator'));
  assert.equal(excluded.photos.find((photo) => photo.photoId === fixture.collected.photoId).isActive, false);
  await assert.rejects(rpc(db, 'authorize_pet_album_photo', fixture.viewer, fixture.collected.photoId), /ALBUM_PHOTO_UNAVAILABLE/);
  const restored = await serviceRole(db, () => rpc(db, 'save_pet_photo_review', petId, excluded.revision,
    JSON.stringify([other, original.photos.find((photo) => photo.photoId === fixture.collected.photoId)]
      .map((photo) => ({ photoId: photo.photoId, caption: photo.caption }))), 'fixture-creator'));
  assert.deepEqual(restored.photos.filter((photo) => photo.isActive).map((photo) => photo.photoId), [other.photoId, fixture.collected.photoId]);
  assert.equal((await rpc(db, 'authorize_pet_album_photo', fixture.viewer, fixture.collected.photoId)).photoId, fixture.collected.photoId);
  const after = await snapshot(db);
  for (const table of ['storage.objects','public.user_photo_unlocks','public.pet_photo_reveal_requests',
    'public.pet_daily_photo_collections','public.pet_free_allowances','public.pet_bonus_accounts']) assert.deepEqual(after[table], before[table], table);
  assert.deepEqual(after['public.pet_photo_review_audit'].slice(0, before['public.pet_photo_review_audit'].length), before['public.pet_photo_review_audit']);
  assert.equal(after['public.pet_photo_review_audit'].length, before['public.pet_photo_review_audit'].length + 2);
});

test('explicit additional-photo approval appends sources once while preserving original photos and collection records', async () => {
  const petId = fixture.pets[1], owner = `fixture-owner-${petId}`, submissionId = randomUUID();
  const originals = await photos(db, petId), before = await snapshot(db);
  const paths = [0, 1].map((index) => `${owner}/${submissionId}/photo-addition/${petId}/staged/${index}-${randomUUID()}.jpg`);
  for (const path of paths) await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
  await serviceRole(db, () => rpc(db, 'submit_pet_photo_addition', owner, petId, submissionId, paths, paths.map(() => 'a'.repeat(64))));
  assert.deepEqual(await photos(db, petId), originals, 'pending additions stay private');
  const batch = (await rpc(db, 'get_pet_photo_addition_review_queue')).items.find((item) => item.petId === petId);
  const decide = () => serviceRole(db, () => rpc(db, 'review_pet_photo_addition', batch.batchId, batch.expectedRevision, 'approved', '', 'fixture-creator'));
  assert.equal((await decide()).status, 'approved'); await decide();
  const approved = await photos(db, petId);
  assert.equal(approved.length, 4); assert.deepEqual(approved.slice(0, 2), originals);
  assert.deepEqual(approved.slice(2).map((photo) => photo.storage_path), paths);
  const after = await snapshot(db);
  for (const table of ['public.pets','public.user_photo_unlocks','public.pet_photo_reveal_requests',
    'public.pet_daily_photo_collections','public.pet_free_allowances','public.pet_bonus_accounts']) assert.deepEqual(after[table], before[table], table);
  assert.equal(after['public.pet_photo_review_audit'].length, before['public.pet_photo_review_audit'].length + 1);
});

test('an existing inconsistent grant aborts the whole migration and preserves all data and prior constraints', { timeout: 120000 }, async () => {
  const invalid = new PGlite({ extensions: { pgcrypto } });
  try {
    const previous = await setupPreviousSchema(invalid);
    await serviceRole(invalid, () => invalid.query(`insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source)
      values('existing-invalid-grant',$1,$2,'legacy_gift')`, [previous.collected.photoId, previous.pets[1]]));
    const before = await snapshot(invalid);
    const definitions = async () => (await invalid.query(`select conname,pg_get_constraintdef(oid) definition
      from pg_constraint where conrelid in ('public.pet_photos'::regclass,'public.user_photo_unlocks'::regclass) order by conname`)).rows;
    const priorConstraints = await definitions();
    await assert.rejects(invalid.exec(sql), foreignKeyViolation);
    await invalid.exec('rollback');
    assert.deepEqual(await snapshot(invalid), before, 'no deletion, correction, reset, debit or audit mutation');
    assert.deepEqual(await definitions(), priorConstraints, 'both the added unique key and replacement FK roll back');
    assert.equal(await rpc(invalid, 'get_pet_album_collection_reset_status'), null);
  } finally { await invalid.close(); }
});
