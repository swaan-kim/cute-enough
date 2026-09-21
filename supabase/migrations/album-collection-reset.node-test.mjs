// Isolated PostgreSQL only. Never loads credentials or contacts a live database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const root = new URL('./', import.meta.url);
const migration = '20260915000100_album_collection_reset.sql';
const confirmation = 'RESET_ALL_USER_ALBUMS_KEEP_REGISTERED_DOGS';
const resetId = randomUUID();
const pets = Array.from({ length: 8 }, () => randomUUID());
const paid = 'reset-fixture-paid', historical = 'reset-fixture-historical', earner = 'reset-fixture-earned', legacy = 'reset-fixture-v4';
const paidRequest = randomUUID(), replayRequest = randomUUID(), legacyRequest = randomUUID(), adSession = randomUUID();
const rpc = async (name, ...args) => (await db.query(
  `select public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) as result`, args,
)).rows[0].result;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const today = () => scalar("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text");
const house = async (viewer) => (await rpc('get_pet_house_snapshot_v2', viewer, await today())).dailyPets;
const photos = (pet) => db.query('select id from public.pet_photos where pet_id=$1 order by sort_order,id', [pet]).then(({ rows }) => rows);
async function collect(viewer, pet, request = randomUUID(), method = 'FREE', session = null) {
  const prepared = await rpc('prepare_pet_photo_unlock', viewer, pet, request, method, session);
  return rpc('record_pet_photo_unlock', viewer, await today(), pet, prepared.photoId, method, request, session);
}
const count = (table) => scalar(`select count(*)::integer from ${table}`);
const digest = (table) => rpcFingerprint(table);
async function rpcFingerprint(table) {
  return scalar('select pet_collection_reset_private.fingerprint($1::regclass)', [table]);
}
const snapshot = async () => {
  const result = {};
  for (const table of ['public.pets','public.pet_photos','storage.objects','public.user_photo_unlocks',
    'public.pet_daily_photo_collections','public.pet_daily_photo_replays','public.pet_album_adoptions',
    'public.daily_reveals','public.daily_house_assignments','public.pet_favorites','public.pet_free_allowances',
    'public.pet_ad_reward_sessions','public.pet_photo_reveal_requests','public.pet_photo_replay_requests','public.pet_reveal_requests']) {
    result[table] = await digest(table);
  }
  return result;
};
let initial, expectedUnlocks, expectedCollectors, paidPet, paidPhoto, earnedPet, manifest;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),primary key(bucket_id,name));`);
  const files = (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name) && name < migration
    && !['20260829000100_fix_wooyoo_white_traits.sql','20260905000400_recharge_notifications.sql'].includes(name)).sort();
  for (const file of files.filter((name) => name < '20260906000100')) await db.exec(await readFile(new URL(file, root), 'utf8'));
  for (const pet of pets) {
    const path = `album-reset/${pet}/0.jpg`;
    await db.query(`insert into public.pets(id,owner_hash,name,storage_path,traits,status,created_at,reviewed_at)
      values($1,$2,'친구',$3,'{}','approved',now()-interval '2 days',now()-interval '2 days')`, [pet, `fixture-owner-${pet}`, path]);
    await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
    const extra = `album-reset/${pet}/1.jpg`;
    await db.query('insert into public.pet_photos(pet_id,storage_path,sort_order) values($1,$2,1)', [pet, extra]);
    await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [extra]);
  }
  for (const file of files.filter((name) => name >= '20260906000100')) await db.exec(await readFile(new URL(file, root), 'utf8'));
  await db.exec('update public.pet_reward_settings set ads_enabled=true,share_enabled=true');
  paidPet = (await house(paid))[0].id;
  const collected = await collect(paid, paidPet, paidRequest);
  paidPhoto = collected.photoId;
  const replayed = await rpc('prepare_pet_photo_replay', paid, paidPet, replayRequest);
  await rpc('record_pet_photo_replay', paid, paidPet, replayRequest, replayed.photoId);
  await rpc('set_pet_favorite', paid, paidPet, true);
  await db.query(`insert into public.daily_house_assignments(owner_hash,assignment_date,slot,pet_id,met_at,met_pet_id)
    values($1,(clock_timestamp() at time zone 'Asia/Seoul')::date-1,1,$2,now()-interval '1 day',$2)`, [paid, paidPet]);

  // A pre-adoption viewer with two historical friendships, but only one old gift.
  for (const pet of pets.slice(0, 2)) await db.query(`insert into public.daily_reveals(owner_hash,reveal_date,pet_id,unlock_method,created_at,revisit_until)
    values($1,(clock_timestamp() at time zone 'Asia/Seoul')::date-1,$2,'FREE',now()-interval '1 day',now()-interval '20 hours')`, [historical, pet]);
  const giftedPhoto = (await photos(pets[0]))[0].id;
  await db.query("insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source) values($1,$2,$3,'legacy_gift')", [historical, giftedPhoto, pets[0]]);
  await db.query('insert into public.pet_album_legacy_gift_receipts(owner_hash,pet_id,photo_id) values($1,$2,$3)', [historical, pets[0], giftedPhoto]);

  earnedPet = (await house(earner))[0].id;
  await db.query('update public.pet_free_allowances set balance=0,last_refill_at=clock_timestamp() where owner_hash=$1', [earner]);
  await rpc('start_pet_album_ad_reward', earner, adSession, earnedPet);
  await rpc('complete_pet_ad_reward', earner, adSession);
  const legacyPet = (await house(legacy))[0].id;
  await rpc('record_pet_reveal_v4', legacy, await today(), legacyPet, 'FREE', legacyRequest, null);

  const beforeMigration = await scalar(`select jsonb_build_object(
    'grants',(select count(*) from public.user_photo_unlocks),'collections',(select count(*) from public.pet_daily_photo_collections),
    'ad',(select status from public.pet_ad_reward_sessions where id=$1))`, [adSession]);
  await db.exec(await readFile(new URL(migration, root), 'utf8'));
  await db.exec("set timezone='UTC'");
  assert.deepEqual(await scalar(`select jsonb_build_object(
    'grants',(select count(*) from public.user_photo_unlocks),'collections',(select count(*) from public.pet_daily_photo_collections),
    'ad',(select status from public.pet_ad_reward_sessions where id=$1))`, [adSession]), beforeMigration);
  expectedUnlocks = await count('public.user_photo_unlocks');
  expectedCollectors = await scalar('select count(distinct owner_hash)::integer from public.user_photo_unlocks');
  initial = await snapshot();
}, { timeout: 120000 });
after(() => db.close());

test('installation never executes reset; private backups and bypass helpers are inaccessible', async () => {
  assert.equal(await rpc('get_pet_album_collection_reset_status'), null);
  assert.equal(await count('pet_collection_reset_private.archived_rows'), 0);
  const access = await scalar(`select jsonb_build_object(
    'anon',has_function_privilege('anon','public.reset_all_pet_album_collections(uuid,bigint,bigint,text)','EXECUTE'),
    'authenticated',has_function_privilege('authenticated','public.reset_all_pet_album_collections(uuid,bigint,bigint,text)','EXECUTE'),
    'service',has_function_privilege('service_role','public.reset_all_pet_album_collections(uuid,bigint,bigint,text)','EXECUTE'),
    'privateSchema',has_schema_privilege('service_role','pet_collection_reset_private','USAGE'),
    'backup',has_table_privilege('service_role','pet_collection_reset_private.archived_rows','SELECT'),
    'bypass',has_function_privilege('service_role','public.record_pet_photo_unlock_pre_album_reset(text,date,uuid,uuid,text,uuid,uuid)','EXECUTE'))`);
  assert.deepEqual(access, { anon: false, authenticated: false, service: true, privateSchema: false, backup: false, bypass: false });
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(rpc('reset_all_pet_album_collections', resetId, expectedUnlocks, expectedCollectors, confirmation), /permission denied/); }
    finally { await db.exec('reset role'); }
  }
  assert.equal(await scalar("select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pet_collection_reset_private' and relkind='r'"), true);
});

test('stale counts and missing operator acknowledgement fail without any mutation', async () => {
  await assert.rejects(rpc('reset_all_pet_album_collections', resetId, expectedUnlocks + 1, expectedCollectors, confirmation), /ALBUM_RESET_COUNTS_CHANGED/);
  await assert.rejects(rpc('reset_all_pet_album_collections', resetId, expectedUnlocks, expectedCollectors, 'wrong'), /INVALID_ALBUM_RESET_INPUT/);
  assert.deepEqual(await snapshot(), initial);
  assert.equal(await count('pet_collection_reset_private.runs'), 0);
});

test('late preservation failure atomically rolls back archives, markers, tombstones and deletions', async () => {
  await db.exec(`create function public.fixture_corrupt_reset() returns trigger language plpgsql as $$
    begin update public.pets set name='변경'; return null; end; $$;
    create trigger fixture_corrupt_reset after delete on public.user_photo_unlocks
      for each statement execute function public.fixture_corrupt_reset();`);
  try {
    await assert.rejects(rpc('reset_all_pet_album_collections', resetId, expectedUnlocks, expectedCollectors, confirmation), /ALBUM_RESET_PRESERVATION_FAILED/);
    assert.deepEqual(await snapshot(), initial);
    for (const table of ['runs','archived_rows','request_tombstones']) assert.equal(await count(`pet_collection_reset_private.${table}`), 0);
  } finally { await db.exec('drop trigger fixture_corrupt_reset on public.user_photo_unlocks; drop function public.fixture_corrupt_reset();'); }
});

test('outer transaction rollback restores the exact original state and keeps the reset executable', async () => {
  await db.exec('begin');
  try {
    await rpc('reset_all_pet_album_collections', resetId, expectedUnlocks, expectedCollectors, confirmation);
    assert.equal(await count('public.user_photo_unlocks'), 0);
  } finally { await db.exec('rollback'); }
  assert.deepEqual(await snapshot(), initial);
  assert.equal(await rpc('get_pet_album_collection_reset_status'), null);
});

test('successful service-role reset archives exact rows, clears access/progress and preserves originals/receipts', async () => {
  const beforeRows = (await db.query(`select source_table,row_data from (
    select 'public.user_photo_unlocks' source_table,to_jsonb(r) row_data from public.user_photo_unlocks r
    union all select 'public.pet_daily_photo_collections',to_jsonb(r) from public.pet_daily_photo_collections r
    union all select 'public.pet_daily_photo_replays',to_jsonb(r) from public.pet_daily_photo_replays r) s order by source_table,row_data::text`)).rows;
  await db.exec('set role service_role');
  try {
    manifest = await rpc('reset_all_pet_album_collections', resetId, expectedUnlocks, expectedCollectors, confirmation);
    assert.deepEqual(await rpc('get_pet_album_collection_reset_status'), manifest);
    await assert.rejects(db.query('select * from pet_collection_reset_private.archived_rows'), /permission denied/);
  } finally { await db.exec('reset role'); }
  assert.equal(manifest.preservationVerified, true);
  assert.deepEqual(manifest.preservedBefore, manifest.preservedAfter);
  assert.equal(manifest.archived['public.user_photo_unlocks'].rows, expectedUnlocks);
  assert.equal(manifest.collectionUsers, expectedCollectors);
  assert.equal(manifest.requestTombstones, 3);
  const afterRows = (await db.query(`select source_table,row_data from pet_collection_reset_private.archived_rows
    where source_table in ('public.user_photo_unlocks','public.pet_daily_photo_collections','public.pet_daily_photo_replays')
    order by source_table,row_data::text`)).rows;
  assert.deepEqual(afterRows, beforeRows);
  assert.equal(await scalar("select bool_and(row_sha256=encode(sha256(convert_to(row_data::text,'UTF8')),'hex')) from pet_collection_reset_private.archived_rows"), true);
  for (const table of ['public.user_photo_unlocks','public.pet_daily_photo_collections','public.pet_daily_photo_replays']) assert.equal(await count(table), 0);
  assert.equal(await scalar('select count(*)::integer from public.daily_reveals where revisit_until>clock_timestamp()'), 0);
  assert.equal(await scalar("select count(*)::integer from public.daily_house_assignments where assignment_date=(clock_timestamp() at time zone 'Asia/Seoul')::date and (met_at is not null or met_pet_id is not null)"), 0);
  assert.equal(await scalar("select count(*)::integer from public.daily_house_assignments where assignment_date<(clock_timestamp() at time zone 'Asia/Seoul')::date and met_at is not null"), 1);
  assert.equal(await count('public.pet_favorites'), 1);
  assert.equal(await scalar('select status from public.pet_ad_reward_sessions where id=$1', [adSession]), 'completed');
  const text = JSON.stringify(manifest);
  for (const secret of [paid,historical,earner,legacy,paidPet,paidPhoto,adSession]) assert.equal(text.includes(secret), false);
});

test('pre-adoption history never regifts; a brand-new viewer cannot acquire the old collection', async () => {
  for (const viewer of [paid,historical,legacy,'reset-fixture-new']) {
    assert.deepEqual((await rpc('get_pet_album', viewer)).items, []);
    await rpc('ensure_pet_album_adopted', viewer);
    const states = await rpc('get_pet_album_state', viewer, pets);
    assert.ok(states.every((row) => row.unlockedPhotoCount === 0 && row.collection.canCollectToday));
  }
  assert.equal(await count('public.user_photo_unlocks'), 0);
});

test('archived collection/replay/legacy request IDs explicitly expire without a second debit or photo', async () => {
  const before = await digest('public.pet_free_allowances');
  await assert.rejects(rpc('prepare_pet_photo_unlock', paid, paidPet, paidRequest, 'FREE', null), /PET_REVISIT_EXPIRED: ALBUM_COLLECTION_RESET/);
  await assert.rejects(rpc('record_pet_photo_unlock', paid, await today(), paidPet, paidPhoto, 'FREE', paidRequest, null), /PET_REVISIT_EXPIRED: ALBUM_COLLECTION_RESET/);
  await assert.rejects(rpc('prepare_pet_photo_replay', paid, paidPet, replayRequest), /PET_REVISIT_EXPIRED: ALBUM_COLLECTION_RESET/);
  await assert.rejects(rpc('record_pet_photo_replay', paid, paidPet, replayRequest, paidPhoto), /PET_REVISIT_EXPIRED: ALBUM_COLLECTION_RESET/);
  await assert.rejects(rpc('record_pet_reveal_v4', legacy, await today(), paidPet, 'FREE', legacyRequest, null), /PET_REVISIT_EXPIRED: ALBUM_COLLECTION_RESET/);
  await assert.rejects(rpc('authorize_pet_album_photo', paid, paidPhoto), /ALBUM_PHOTO_UNAVAILABLE/);
  assert.deepEqual(await digest('public.pet_free_allowances'), before);
  assert.equal(await count('public.user_photo_unlocks'), 0);
});

test('fresh recollection spends once, restores its favorite, and never revives archived request IDs', async () => {
  const before = await scalar('select balance from public.pet_free_allowances where owner_hash=$1', [paid]);
  const request = randomUUID(), result = await collect(paid, paidPet, request);
  assert.equal(result.photoId, paidPhoto);
  assert.equal(result.unlockMethod, 'FREE');
  assert.equal(await scalar('select balance from public.pet_free_allowances where owner_hash=$1', [paid]), before - 1);
  assert.equal((await collect(paid, paidPet, request)).reusedRequest, true);
  assert.equal(await scalar('select balance from public.pet_free_allowances where owner_hash=$1', [paid]), before - 1);
  assert.equal((await rpc('get_pet_album', paid)).items[0].isFavorite, true);
  await assert.rejects(rpc('prepare_pet_photo_unlock', paid, paidPet, paidRequest, 'FREE', null), /ALBUM_COLLECTION_RESET/);
  await assert.rejects(rpc('prepare_pet_photo_replay', paid, paidPet, replayRequest), /ALBUM_COLLECTION_RESET/);
  assert.equal((await rpc('get_pet_photo_collection', paid, paidPet)).collectedToday, true);
});

test('preserved earned credit remains consumable exactly once with unchanged natural tickets and ad counter', async () => {
  const beforeFree = await scalar('select jsonb_build_object(\'balance\',balance,\'refill\',last_refill_at) from public.pet_free_allowances where owner_hash=$1', [earner]);
  const beforeState = await rpc('get_pet_album_reward_state', earner);
  const request = randomUUID(), result = await collect(earner, earnedPet, request, 'REWARDED', adSession);
  assert.equal(result.unlockMethod, 'REWARDED');
  assert.equal((await collect(earner, earnedPet, request, 'REWARDED', adSession)).reusedRequest, true);
  assert.equal(await scalar('select balance from public.pet_free_allowances where owner_hash=$1', [earner]), 0);
  assert.equal((await rpc('get_pet_album_reward_state', earner)).adsCompletedToday, beforeState.adsCompletedToday);
  assert.equal(await scalar('select status from public.pet_ad_reward_sessions where id=$1', [adSession]), 'consumed');
  assert.deepEqual(await scalar('select jsonb_build_object(\'balance\',balance,\'refill\',last_refill_at) from public.pet_free_allowances where owner_hash=$1', [earner]), beforeFree);
});

test('a second reset is rejected and bounded locks/shared request fence are installed', async () => {
  const before = await snapshot();
  await assert.rejects(rpc('reset_all_pet_album_collections', randomUUID(), await count('public.user_photo_unlocks'), 2, confirmation), /ALBUM_RESET_ALREADY_APPLIED/);
  assert.deepEqual(await snapshot(), before);
  const settings = await scalar("select proconfig from pg_proc where oid='public.reset_all_pet_album_collections(uuid,bigint,bigint,text)'::regprocedure");
  assert.ok(settings.includes('lock_timeout=3s'));
  assert.ok(settings.includes('statement_timeout=30s'));
  const source = await readFile(new URL(migration, root), 'utf8');
  assert.match(source, /pg_advisory_xact_lock_shared/);
  assert.match(source, /pg_try_advisory_xact_lock/);
  assert.ok(source.indexOf('in share row exclusive mode') < source.indexOf('v_at:=clock_timestamp()'));
  assert.equal(source.includes('truncate '), false);
});
