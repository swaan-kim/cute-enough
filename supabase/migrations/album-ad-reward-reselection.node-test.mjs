// All mutations below use an isolated in-memory PostgreSQL fixture, never a server.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const root = new URL('./', import.meta.url);
const migration = '20260911000100_album_ad_reward_reselection.sql';
const pets = Array.from({ length: 8 }, () => randomUUID());
const owner = () => `album-ad-${randomUUID()}`;
const rpc = async (name, ...args) => (await db.query(
  `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args,
)).rows[0].result;
const today = async () => (await db.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
const photos = async (pet) => (await db.query('select id,storage_path from public.pet_photos where pet_id=$1 order by sort_order,id', [pet])).rows;
const allowance = async (viewer, balance = 0) => db.query(`insert into public.pet_free_allowances(owner_hash,balance,last_refill_at)
  values($1,$2,clock_timestamp()) on conflict(owner_hash) do update set balance=excluded.balance,last_refill_at=excluded.last_refill_at`, [viewer, balance]);
const house = async (viewer) => (await rpc('get_pet_house_snapshot_v2', viewer, await today())).dailyPets.map((pet) => pet.id);
const credit = async (viewer, session, album = true) => (await rpc(album ? 'get_pet_album_reward_state' : 'get_pet_reward_state', viewer))
  .adRewards.find((row) => row.sessionId === session);
async function gift(viewer, pet, selected) {
  await rpc('ensure_pet_album_adopted', viewer);
  for (const photo of selected) await db.query(`insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source)
    values($1,$2,$3,'legacy_gift') on conflict do nothing`, [viewer, photo.id, pet]);
}
async function earn(viewer, pet, session = randomUUID()) {
  await allowance(viewer);
  await rpc('start_pet_album_ad_reward', viewer, session, pet);
  await rpc('complete_pet_ad_reward', viewer, session);
  return session;
}
async function collect(viewer, pet, method = 'FREE', session = null, request = randomUUID()) {
  const prepared = await rpc('prepare_pet_photo_unlock', viewer, pet, request, method, session);
  return rpc('record_pet_photo_unlock', viewer, await today(), pet, prepared.photoId, method, request, session);
}
const ledgers = async (viewer) => (await db.query(`select jsonb_build_object(
  'free',(select to_jsonb(a) from public.pet_free_allowances a where owner_hash=$1),
  'bonus',(select to_jsonb(b) from public.pet_bonus_accounts b where owner_hash=$1),
  'grants',(select coalesce(jsonb_agg(to_jsonb(g) order by photo_id),'[]') from public.user_photo_unlocks g where owner_hash=$1),
  'collections',(select coalesce(jsonb_agg(to_jsonb(c) order by pet_id,collection_date),'[]') from public.pet_daily_photo_collections c where owner_hash=$1)
) as state`, [viewer])).rows[0].state;
let historical;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),primary key(bucket_id,name));`);
  const files = (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name) && name < migration
    && !['20260829000100_fix_wooyoo_white_traits.sql', '20260905000400_recharge_notifications.sql'].includes(name)).sort();
  for (const file of files.filter((name) => name < '20260906000100')) await db.exec(await readFile(new URL(file, root), 'utf8'));
  for (const pet of pets) {
    const path = `album-ad/${pet}/0.jpg`;
    await db.query(`insert into public.pets(id,owner_hash,name,storage_path,traits,status,created_at,reviewed_at)
      values($1,$2,'친구',$3,'{}','approved',now()-interval '2 days',now()-interval '2 days')`, [pet, `fixture-${pet}`, path]);
    await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
    for (let i = 1; i < 3; i++) {
      const extra = `album-ad/${pet}/${i}.jpg`;
      await db.query('insert into public.pet_photos(pet_id,storage_path,sort_order) values($1,$2,$3)', [pet, extra, i]);
      await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [extra]);
    }
  }
  for (const file of files.filter((name) => name >= '20260906000100')) await db.exec(await readFile(new URL(file, root), 'utf8'));
  await db.exec('update public.pet_reward_settings set ads_enabled=true,share_enabled=true');
  const viewer = owner(), [source, target, next] = await house(viewer), ids = await photos(source);
  await gift(viewer, source, ids.slice(0, 2));
  const session = await earn(viewer, source);
  await db.query('update public.pet_photos set is_active=false where id=$1', [ids[2].id]);
  const before = await ledgers(viewer);
  const publicRows = (await db.query(`select jsonb_build_object(
    'pets',(select jsonb_agg(to_jsonb(p) order by id) from public.pets p),
    'photos',(select jsonb_agg(to_jsonb(p) order by id) from public.pet_photos p),
    'storage',(select jsonb_agg(to_jsonb(o) order by name) from storage.objects o)
  ) as state`)).rows[0].state;
  await db.exec(await readFile(new URL(migration, root), 'utf8'));
  historical = { viewer, source, target, next, session, ids, before, publicRows };
}, { timeout: 120000 });
after(() => db.close());

test('migration preserves existing records and makes a stranded pre-migration album credit reselectable', async () => {
  const { viewer, source, target, next, session, ids, before, publicRows } = historical;
  try {
    assert.deepEqual(await ledgers(viewer), before);
    assert.deepEqual((await db.query(`select jsonb_build_object(
      'pets',(select jsonb_agg(to_jsonb(p) order by id) from public.pets p),
      'photos',(select jsonb_agg(to_jsonb(p) order by id) from public.pet_photos p),
      'storage',(select jsonb_agg(to_jsonb(o) order by name) from storage.objects o)
    ) as state`)).rows[0].state, publicRows);
    assert.equal((await credit(viewer, session)).canRebind, true);
    assert.equal((await credit(viewer, session, false)).canRebind, false, 'legacy availability remains photo-based');
    await assert.rejects(rpc('rebind_pet_ad_reward', viewer, session, target), /AD_REWARD_RESELECT_UNAVAILABLE/);
    await assert.rejects(collect(viewer, source, 'REWARDED', session), /ALBUM_ALL_PHOTOS_UNLOCKED/);
    await db.exec('update public.pet_reward_settings set ads_enabled=false');
    const rebound = await rpc('rebind_pet_album_ad_reward', viewer, session, target);
    assert.equal(rebound.adRewards[0].petId, target);
    assert.equal(rebound.adRewards[0].canRebind, false);
    assert.equal(rebound.adsCompletedToday, 1);
    assert.deepEqual(await ledgers(viewer), before, 'reselection never grants or spends tickets/photos');
    assert.equal((await rpc('rebind_pet_album_ad_reward', viewer, session, target)).sessionId, session);
    await assert.rejects(rpc('rebind_pet_album_ad_reward', viewer, session, next), /AD_REWARD_RESELECT_UNAVAILABLE/);
    const request = randomUUID(), result = await collect(viewer, target, 'REWARDED', session, request);
    assert.equal(result.unlockMethod, 'REWARDED');
    assert.equal((await collect(viewer, target, 'REWARDED', session, request)).reusedRequest, true);
    assert.equal(await credit(viewer, session), undefined);
    assert.equal((await ledgers(viewer)).free.balance, 0);
    await assert.rejects(rpc('rebind_pet_album_ad_reward', viewer, session, next), /AD_REWARD_UNAVAILABLE/);
  } finally {
    await db.query('update public.pet_photos set is_active=true where id=$1', [ids[2].id]);
    await db.exec('update public.pet_reward_settings set ads_enabled=true');
  }
});

test('availability depends on the viewer and remaining photos, not another viewer collection', async () => {
  const viewer = owner(), other = owner(), [source, target] = await house(viewer), ids = await photos(source);
  await house(other);
  await gift(viewer, source, ids.slice(0, 2));
  const session = await earn(viewer, source), otherSession = await earn(other, source);
  assert.equal((await credit(viewer, session)).canRebind, false);
  await assert.rejects(rpc('rebind_pet_album_ad_reward', viewer, session, target), /AD_REWARD_RESELECT_UNAVAILABLE/);
  await db.query('update public.pet_photos set is_active=false where id=$1', [ids[2].id]);
  try {
    assert.equal((await credit(viewer, session)).canRebind, true);
    assert.equal((await credit(other, otherSession)).canRebind, false);
    await assert.rejects(rpc('rebind_pet_album_ad_reward', other, session, target), /AD_SESSION_NOT_FOUND/);
    assert.equal((await credit(viewer, session)).petId, source);
  } finally { await db.query('update public.pet_photos set is_active=true where id=$1', [ids[2].id]); }
});

test('reselection retains daily collection, target availability and owner restrictions', async () => {
  const viewer = owner(), [source, target, full] = await house(viewer), ids = await photos(source);
  await collect(viewer, target);
  await gift(viewer, full, await photos(full));
  await gift(viewer, source, ids.slice(0, 2));
  const session = await earn(viewer, source);
  await db.query('update public.pet_photos set is_active=false where id=$1', [ids[2].id]);
  try {
    await assert.rejects(rpc('rebind_pet_album_ad_reward', viewer, session, target), /DAILY_PHOTO_ALREADY_COLLECTED/);
    await assert.rejects(rpc('rebind_pet_album_ad_reward', viewer, session, full), /ALBUM_ALL_PHOTOS_UNLOCKED/);
    await assert.rejects(rpc('rebind_pet_album_ad_reward', viewer, session, randomUUID()), /PET_NOT_AVAILABLE/);
    const originalOwner = (await db.query('select owner_hash from public.pets where id=$1', [full])).rows[0].owner_hash;
    await db.query('update public.pets set owner_hash=$1 where id=$2', [viewer, full]);
    try { await assert.rejects(rpc('rebind_pet_album_ad_reward', viewer, session, full), /OWNER_PHOTO_FREE/); }
    finally { await db.query('update public.pets set owner_hash=$1 where id=$2', [originalOwner, full]); }
    assert.equal((await credit(viewer, session)).petId, source);
    assert.equal((await credit(viewer, session)).canRebind, true, 'failed target does not use the one rebind');
  } finally { await db.query('update public.pet_photos set is_active=true where id=$1', [ids[2].id]); }
});

test('temporarily collecting today never unlocks reselection while an unseen source remains', async () => {
  const viewer = owner(), [source, target] = await house(viewer);
  const session = await earn(viewer, source);
  const prepared = await rpc('prepare_pet_photo_unlock', viewer, source, randomUUID(), 'REWARDED', session);
  await db.query(`insert into public.pet_daily_photo_collections(owner_hash,pet_id,collection_date,photo_id)
    values($1,$2,(clock_timestamp() at time zone 'Asia/Seoul')::date,$3)`, [viewer, source, prepared.photoId]);
  assert.equal((await credit(viewer, session)).canRebind, false);
  await assert.rejects(rpc('rebind_pet_album_ad_reward', viewer, session, target), /AD_REWARD_RESELECT_UNAVAILABLE/);
});

test('unknown start can be replayed with the same ID after changed eligibility, cancelled, then replaced', async () => {
  const viewer = owner(), [source, target] = await house(viewer), session = randomUUID();
  await allowance(viewer);
  await rpc('start_pet_album_ad_reward', viewer, session, source);
  await assert.rejects(rpc('start_pet_album_ad_reward', viewer, randomUUID(), target), /AD_SESSION_ACTIVE/);
  await allowance(viewer, 1);
  await db.exec('update public.pet_reward_settings set ads_enabled=false');
  try {
    assert.equal((await rpc('start_pet_album_ad_reward', viewer, session, source)).sessionId, session);
    await assert.rejects(rpc('start_pet_album_ad_reward', viewer, session, target), /REWARD_SESSION_CONFLICT/);
    await rpc('cancel_pet_ad_reward', viewer, session);
    assert.equal((await rpc('get_pet_album_reward_state', viewer)).adsCompletedToday, 0);
  } finally { await db.exec('update public.pet_reward_settings set ads_enabled=true'); }
  await allowance(viewer);
  await rpc('start_pet_album_ad_reward', viewer, randomUUID(), target);
});

test('RPC grants preserve legacy callers and expose only service-role album boundaries', async () => {
  const result = (await db.query(`select
    has_function_privilege('anon','public.get_pet_album_reward_state(text)','EXECUTE') as anonymous,
    has_function_privilege('authenticated','public.rebind_pet_album_ad_reward(text,uuid,uuid)','EXECUTE') as authenticated,
    has_function_privilege('service_role','public.get_pet_album_reward_state(text)','EXECUTE') as album,
    has_function_privilege('service_role','public.get_pet_reward_state(text)','EXECUTE') as legacy,
    has_function_privilege('service_role','public.is_pet_album_reward_photo_available(text,uuid)','EXECUTE') as helper,
    has_function_privilege('service_role','public.rebind_pet_album_ad_reward_album_v1(text,uuid,uuid)','EXECUTE') as bypass
  `)).rows[0];
  assert.deepEqual(result, { anonymous: false, authenticated: false, album: true, legacy: true, helper: false, bypass: false });
});

test('current album flow: two tickets, two collections, cancelled ad, completed ad photo, then natural recharge one and two', async () => {
  const viewer = owner(), [firstPet, secondPet, adPet] = await house(viewer);
  const balance = async () => (await db.query('select * from public.get_pet_free_allowance($1)', [viewer])).rows[0];
  const anchor = async () => (await db.query('select last_refill_at from public.pet_free_allowances where owner_hash=$1', [viewer])).rows[0].last_refill_at;
  const counts = async () => (await db.query(`select
    (select count(*)::int from public.user_photo_unlocks where owner_hash=$1) grants,
    (select count(*)::int from public.pet_daily_photo_collections where owner_hash=$1) collections,
    (select count(*)::int from public.pet_photo_reveal_requests where owner_hash=$1) requests`, [viewer])).rows[0];
  const balances = [(await balance()).free_remaining];
  await collect(viewer, firstPet);
  balances.push((await balance()).free_remaining);
  const initialAnchor = await anchor();
  await collect(viewer, secondPet);
  balances.push((await balance()).free_remaining);
  assert.deepEqual(balances, [2, 1, 0]);
  assert.deepEqual(await anchor(), initialAnchor, 'second spend must preserve the original recharge anchor');

  const cancelled = randomUUID(), beforeAd = await counts();
  await rpc('start_pet_album_ad_reward', viewer, cancelled, adPet);
  await rpc('cancel_pet_ad_reward', viewer, cancelled);
  assert.deepEqual(await counts(), beforeAd, 'cancelled ad grants no photo or collection');
  assert.equal((await rpc('get_pet_album_reward_state', viewer)).adsCompletedToday, 0);
  await assert.rejects(collect(viewer, adPet, 'REWARDED', cancelled), /AD_REWARD_UNAVAILABLE/);
  assert.deepEqual(await counts(), beforeAd);

  const session = randomUUID(), request = randomUUID();
  await rpc('start_pet_album_ad_reward', viewer, session, adPet);
  await rpc('start_pet_album_ad_reward', viewer, session, adPet);
  await rpc('complete_pet_ad_reward', viewer, session);
  await rpc('complete_pet_ad_reward', viewer, session);
  assert.deepEqual(await counts(), beforeAd, 'earned credit alone is not a photo grant');
  const result = await collect(viewer, adPet, 'REWARDED', session, request);
  assert.equal(result.unlockMethod, 'REWARDED');
  assert.equal((await balance()).free_remaining, 0);
  assert.deepEqual(await counts(), { grants: 3, collections: 3, requests: 3 });
  const committed = await ledgers(viewer);
  const retry = await collect(viewer, adPet, 'REWARDED', session, request);
  assert.equal(retry.photoId, result.photoId); assert.equal(retry.reusedRequest, true);
  await rpc('complete_pet_ad_reward', viewer, session);
  assert.deepEqual(await ledgers(viewer), committed, 'retries never consume or grant a second time');
  assert.equal((await rpc('get_pet_album_reward_state', viewer)).adsCompletedToday, 1);
  assert.deepEqual(await anchor(), initialAnchor, 'advertising must not reset natural recharge');

  await db.query("update public.pet_free_allowances set last_refill_at=clock_timestamp()-interval '3 hours 5 minutes' where owner_hash=$1", [viewer]);
  const charged = await balance();
  assert.equal(charged.free_remaining, 1);
  const remainingMinutes = (new Date(charged.next_free_at).getTime() - Date.now()) / 60_000;
  assert.ok(remainingMinutes > 174 && remainingMinutes < 176, 'elapsed five minutes remain credited');
  await db.query("update public.pet_free_allowances set last_refill_at=last_refill_at-interval '3 hours' where owner_hash=$1", [viewer]);
  const full = await balance();
  assert.equal(full.free_remaining, 2); assert.equal(full.next_free_at, null);
  assert.deepEqual(await counts(), { grants: 3, collections: 3, requests: 3 });
});

test('current album earned credit survives elapsed natural refill and does not spend or reset that ticket', async () => {
  const viewer = owner(), [pet] = await house(viewer), session = randomUUID();
  await allowance(viewer, 0);
  await rpc('start_pet_album_ad_reward', viewer, session, pet);
  await db.query("update public.pet_free_allowances set last_refill_at=clock_timestamp()-interval '3 hours 5 minutes' where owner_hash=$1", [viewer]);
  await rpc('complete_pet_ad_reward', viewer, session);
  const before = (await db.query('select * from public.get_pet_free_allowance($1)', [viewer])).rows[0];
  const anchor = (await db.query('select last_refill_at from public.pet_free_allowances where owner_hash=$1', [viewer])).rows[0].last_refill_at;
  assert.equal(before.free_remaining, 1);
  const result = await collect(viewer, pet, 'REWARDED', session);
  assert.equal(result.unlockMethod, 'REWARDED');
  const after = (await db.query('select * from public.get_pet_free_allowance($1)', [viewer])).rows[0];
  assert.equal(after.free_remaining, 1); assert.deepEqual(after.next_free_at, before.next_free_at);
  assert.deepEqual((await db.query('select last_refill_at from public.pet_free_allowances where owner_hash=$1', [viewer])).rows[0].last_refill_at, anchor);
  assert.equal((await db.query('select status from public.pet_ad_reward_sessions where id=$1', [session])).rows[0].status, 'consumed');
});
