// Real PostgreSQL execution via PGlite; no production database is contacted.
// Install @electric-sql/pglite in a disposable directory and set PGLITE_MODULE_PATH
// to its dist/index.js, or install it in the project's development environment.
// PGLITE_MODULE_PATH=... node --test supabase/migrations/reward-sessions-and-bonus-tickets.node-test.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

const moduleUrl = process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href
  : import.meta.resolve('@electric-sql/pglite');
const { PGlite } = await import(moduleUrl);
const { pgcrypto } = await import(new URL('./contrib/pgcrypto.js', moduleUrl).href);
const db = new PGlite({ extensions: { pgcrypto } });
const migrationDirectory = dirname(fileURLToPath(import.meta.url));
const pets = Array.from({ length: 12 }, () => randomUUID());
const owner = () => `test-${randomUUID()}`;
const rpc = async (name, ...args) => {
  assert.match(name, /^[a-z_0-9]+$/);
  const placeholders = args.map((_, index) => `$${index + 1}`).join(',');
  const result = await db.query(`select public.${name}(${placeholders}) as result`, args);
  return result.rows[0].result;
};
const today = async () => (await db.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
const allowance = async (viewer, balance = 0) => {
  await db.query(`insert into public.pet_free_allowances(owner_hash,balance,last_refill_at)
    values ($1,$2,clock_timestamp()) on conflict(owner_hash) do update
    set balance=excluded.balance,last_refill_at=excluded.last_refill_at`, [viewer, balance]);
};
const reveal = async (viewer, pet, method = 'FREE', request = randomUUID(), ad = null) =>
  rpc('record_pet_reveal_v4', viewer, await today(), pet, method, request, ad);
const earnShare = async (viewer, amount = 1) => {
  const session = randomUUID();
  await rpc('start_pet_share_reward', viewer, session);
  await rpc('record_pet_share_reward', viewer, session, randomUUID(), 1, amount);
  await rpc('close_pet_share_reward', viewer, session, amount);
  return session;
};

before(async () => {
  await db.exec(`create role anon; create role authenticated;
    create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,
      file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,
      primary key(bucket_id,name));`);
  const files = (await readdir(migrationDirectory))
    .filter(name => /^\d+.*\.sql$/.test(name) && (
      name <= '20260905000300_reward_sessions_and_bonus_tickets.sql'
      || name === '20260905000500_immutable_submission_retries.sql'))
    // This one-off production data correction requires a named production pet;
    // it changes no schema or RPCs and has no equivalent in an empty test DB.
    .filter(name => name !== '20260829000100_fix_wooyoo_white_traits.sql')
    .sort();
  for (const file of files) {
    try { await db.exec(await readFile(resolve(migrationDirectory, file), 'utf8')); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`, { cause: error }); }
  }
  for (const [index, id] of pets.entries()) {
    const path = `fixtures/${id}.jpg`;
    await db.query(`insert into public.pets(id,owner_hash,name,storage_path,status,traits,created_at,reviewed_at)
      values ($1,'fixture-owner',$2,$3,'approved','{}',now()-interval '2 days',now()-interval '2 days')`,
    [id, `견${index}`, path]);
    await db.query("insert into storage.objects(bucket_id,name) values ('pet-photos',$1)", [path]);
  }
  await db.exec('update public.pet_reward_settings set ads_enabled=true,share_enabled=true');
}, { timeout: 120_000 });

after(async () => { await db.close(); });

test('migrations execute and tables/functions deny anonymous access', async () => {
  const privileges = await db.query(`select
    has_table_privilege('anon','public.pet_bonus_accounts','SELECT') as balance,
    has_function_privilege('anon','public.record_pet_share_reward(text,uuid,uuid,integer,integer)','EXECUTE') as mint,
    has_function_privilege('authenticated','public.record_pet_reveal_v4(text,date,uuid,text,uuid,uuid)','EXECUTE') as reveal,
    has_function_privilege('service_role','public.record_pet_share_reward(text,uuid,uuid,integer,integer)','EXECUTE') as service`);
  assert.deepEqual(privileges.rows[0], { balance: false, mint: false, reveal: false, service: true });
});

test('share reports mint once per persisted event and reject changed retry payloads', async () => {
  const viewer = owner(), session = randomUUID(), request = randomUUID();
  await rpc('start_pet_share_reward', viewer, session);
  await rpc('record_pet_share_reward', viewer, session, request, 1, 1);
  await rpc('record_pet_share_reward', viewer, session, request, 1, 1);
  let state = await rpc('record_pet_share_reward', viewer, session, randomUUID(), 1, 1);
  assert.equal(state.bonusTickets, 1);
  await assert.rejects(rpc('record_pet_share_reward', viewer, session, request, 1, 2), /REWARD_REQUEST_CONFLICT/);
  state = await rpc('record_pet_share_reward', viewer, session, randomUUID(), 2, 3);
  assert.equal(state.bonusTickets, 4);
  state = await rpc('close_pet_share_reward', viewer, session, 4);
  assert.equal(state.shareSessions[0].reconciliationRequired, false);
});

test('close never grants tickets; delayed persisted events reconcile an early close', async () => {
  const viewer = owner(), session = randomUUID();
  await rpc('start_pet_share_reward', viewer, session);
  let state = await rpc('close_pet_share_reward', viewer, session, 2);
  assert.equal(state.bonusTickets, 0);
  assert.equal(state.shareSessions[0].reconciliationRequired, true);
  state = await rpc('record_pet_share_reward', viewer, session, randomUUID(), 1, 1);
  assert.equal(state.shareSessions[0].reconciliationRequired, true);
  state = await rpc('record_pet_share_reward', viewer, session, randomUUID(), 2, 1);
  assert.equal(state.bonusTickets, 2);
  assert.equal(state.shareSessions[0].reconciliationRequired, false);
  state = await rpc('record_pet_share_reward', viewer, session, randomUUID(), 3, 1);
  assert.equal(state.bonusTickets, 2);
  assert.equal(state.rewardPendingReview, true);
});

test('missing close totals are flagged, while cancel/no-share does not mint', async () => {
  const viewer = owner(), session = randomUUID();
  await rpc('start_pet_share_reward', viewer, session);
  const state = await rpc('close_pet_share_reward', viewer, session, null);
  assert.equal(state.bonusTickets, 0);
  assert.equal(state.shareSessions[0].reconciliationRequired, true);
});

test('disputed close reports preserve additional events without granting or losing their request identity', async () => {
  const viewer = owner(), session = randomUUID(), request = randomUUID();
  await rpc('start_pet_share_reward', viewer, session);
  await rpc('close_pet_share_reward', viewer, session, null);
  for (const retryId of [request, request, randomUUID()]) {
    const state = await rpc('record_pet_share_reward', viewer, session, retryId, 1, 1);
    assert.equal(state.bonusTickets, 0);
    assert.equal(state.rewardPendingReview, true);
    assert.equal(state.shareSession.reconciliationRequired, true);
  }
  await assert.rejects(rpc('record_pet_share_reward', viewer, session, request, 2, 1), /REWARD_REQUEST_CONFLICT/);
  const events = await db.query('select reward_amount,granted from public.pet_share_reward_events where session_id=$1', [session]);
  assert.deepEqual(events.rows, [{ reward_amount: 1, granted: false }]);
});

test('repeated matching close cannot erase an excess event awaiting review', async () => {
  const viewer = owner(), session = randomUUID(), request = randomUUID();
  await rpc('start_pet_share_reward', viewer, session);
  await rpc('record_pet_share_reward', viewer, session, randomUUID(), 1, 1);
  await rpc('close_pet_share_reward', viewer, session, 1);
  await rpc('record_pet_share_reward', viewer, session, request, 2, 1);
  const state = await rpc('close_pet_share_reward', viewer, session, 1);
  assert.equal(state.bonusTickets, 1);
  assert.equal(state.shareSession.reconciliationRequired, true);
  const repeated = await rpc('record_pet_share_reward', viewer, session, request, 2, 1);
  assert.equal(repeated.rewardPendingReview, true);
  await assert.rejects(rpc('record_pet_share_reward', viewer, session, request, 2, 2), /REWARD_REQUEST_CONFLICT/);
});

test('bonus survives a full natural bucket and natural tickets are consumed first', async () => {
  const viewer = owner();
  await earnShare(viewer, 3);
  const first = await reveal(viewer, pets[0], 'SHARE');
  assert.equal(first.unlockMethod, 'FREE');
  assert.equal(first.bonusTickets, 3);
  assert.equal(first.dailyProgress.totalCount, 4);
  await reveal(viewer, pets[1], 'FREE');
  const third = await reveal(viewer, pets[2], 'FREE');
  assert.equal(third.unlockMethod, 'SHARE');
  assert.equal(third.bonusTickets, 2);
  const balance = await db.query('select balance,last_refill_at from public.pet_free_allowances where owner_hash=$1', [viewer]);
  assert.equal(balance.rows[0].balance, 0);
});

test('reveal retries and active revisits never double-charge even after request expiry', async () => {
  const viewer = owner(), request = randomUUID();
  await allowance(viewer, 0);
  await earnShare(viewer, 3);
  const first = await reveal(viewer, pets[0], 'SHARE', request);
  const repeat = await reveal(viewer, pets[0], 'SHARE', request);
  assert.equal(repeat.reusedRequest, true);
  assert.equal(repeat.revisitUntil, first.revisitUntil);
  const active = await reveal(viewer, pets[0], 'FREE');
  assert.equal(active.alreadyRevealed, true);
  assert.equal(active.bonusTickets, 2);
  await db.query(`update public.pet_reveal_requests set response=jsonb_set(response,'{revisitUntil}',
    to_jsonb((now()-interval '1 minute')::text)) where owner_hash=$1 and request_id=$2`, [viewer, request]);
  const expired = await reveal(viewer, pets[0], 'SHARE', request);
  assert.ok(Date.parse(expired.revisitUntil) < Date.now());
  assert.equal((await rpc('get_pet_reward_state', viewer)).bonusTickets, 2);
  await assert.rejects(reveal(viewer, pets[1], 'SHARE', request), /REVEAL_REQUEST_CONFLICT/);
});

test('a later natural recharge takes precedence over requested bonus without resetting its anchor', async () => {
  const viewer = owner();
  await allowance(viewer, 0);
  await earnShare(viewer, 1);
  await db.query("update public.pet_free_allowances set last_refill_at=now()-interval '3 hours 5 minutes' where owner_hash=$1", [viewer]);
  const result = await reveal(viewer, pets[1], 'SHARE');
  assert.equal(result.unlockMethod, 'FREE');
  assert.equal(result.bonusTickets, 1);
  const next = await db.query('select next_free_at from public.get_pet_free_allowance($1)', [viewer]);
  const remaining = new Date(next.rows[0].next_free_at).getTime() - Date.now();
  assert.ok(remaining > 174 * 60_000 && remaining < 176 * 60_000);
});

test('ads require both buckets empty and reject parallel active sessions', async () => {
  const viewer = owner();
  await assert.rejects(rpc('start_pet_ad_reward', viewer, randomUUID(), pets[0]), /FREE_ALLOWANCE_AVAILABLE/);
  await allowance(viewer, 0);
  await earnShare(viewer, 1);
  await assert.rejects(rpc('start_pet_ad_reward', viewer, randomUUID(), pets[0]), /BONUS_ALLOWANCE_AVAILABLE/);
  await reveal(viewer, pets[1], 'SHARE');
  const session = randomUUID();
  await rpc('start_pet_ad_reward', viewer, session, pets[0]);
  await rpc('start_pet_ad_reward', viewer, session, pets[0]);
  await assert.rejects(rpc('start_pet_ad_reward', viewer, randomUUID(), pets[2]), /AD_SESSION_ACTIVE/);
  await assert.rejects(rpc('start_pet_ad_reward', viewer, session, pets[2]), /REWARD_SESSION_CONFLICT/);
});

test('earned ads survive natural recharge and are consumed before a free ticket', async () => {
  const viewer = owner(), session = randomUUID();
  await allowance(viewer, 0);
  await rpc('start_pet_ad_reward', viewer, session, pets[0]);
  await allowance(viewer, 1);
  await rpc('complete_pet_ad_reward', viewer, session);
  const result = await reveal(viewer, pets[0], 'FREE');
  assert.equal(result.unlockMethod, 'REWARDED');
  const free = await db.query('select balance from public.pet_free_allowances where owner_hash=$1', [viewer]);
  assert.equal(free.rows[0].balance, 1);
  const state = await rpc('complete_pet_ad_reward', viewer, session);
  assert.equal(state.adsCompletedToday, 1);
  assert.equal(state.adRewards.length, 0);
});

test('completion is counted before photo consumption, cancelled ads do not count', async () => {
  const viewer = owner();
  await allowance(viewer, 0);
  const cancelled = randomUUID();
  await rpc('start_pet_ad_reward', viewer, cancelled, pets[0]);
  assert.equal((await rpc('cancel_pet_ad_reward', viewer, cancelled)).adsCompletedToday, 0);
  for (const pet of pets.slice(1, 3)) {
    const session = randomUUID();
    await rpc('start_pet_ad_reward', viewer, session, pet);
    await rpc('complete_pet_ad_reward', viewer, session);
    await rpc('complete_pet_ad_reward', viewer, session);
  }
  const state = await rpc('get_pet_reward_state', viewer);
  assert.equal(state.adsCompletedToday, 2);
  assert.equal(state.adRewards.length, 2);
  await assert.rejects(rpc('start_pet_ad_reward', viewer, randomUUID(), pets[4]), /REWARDED_LIMIT_REACHED/);
  await assert.rejects(rpc('complete_pet_ad_reward', viewer, cancelled), /REWARDED_LIMIT_REACHED/);
});

test('midnight completion belongs to start date and survives expired/cancelled sessions', async () => {
  const viewer = owner(), session = randomUUID();
  await allowance(viewer, 0);
  await rpc('start_pet_ad_reward', viewer, session, pets[0]);
  await rpc('cancel_pet_ad_reward', viewer, session);
  await db.query(`update public.pet_ad_reward_sessions
    set started_date=started_date-1,expires_at=now()-interval '1 minute' where id=$1`, [session]);
  const state = await rpc('complete_pet_ad_reward', viewer, session);
  assert.equal(state.adsCompletedToday, 0);
  assert.equal(state.adRewards[0].status, 'completed');
  assert.equal((await reveal(viewer, pets[0], 'REWARDED', randomUUID(), session)).unlockMethod, 'REWARDED');
});

test('kill switches block new starts while preserving previously earned rewards', async () => {
  const viewer = owner(), ad = randomUUID(), share = randomUUID();
  await allowance(viewer, 0);
  await rpc('start_pet_ad_reward', viewer, ad, pets[0]);
  await rpc('start_pet_share_reward', viewer, share);
  await db.exec('update public.pet_reward_settings set ads_enabled=false,share_enabled=false');
  try {
    await assert.rejects(rpc('start_pet_ad_reward', owner(), randomUUID(), pets[0]), /ADS_DISABLED/);
    await assert.rejects(rpc('start_pet_share_reward', owner(), randomUUID()), /SHARE_REWARDS_DISABLED/);
    await rpc('complete_pet_ad_reward', viewer, ad);
    const state = await rpc('record_pet_share_reward', viewer, share, randomUUID(), 1, 1);
    assert.equal(state.bonusTickets, 1);
    assert.equal(state.adsEnabled, false);
    assert.equal(state.shareEnabled, false);
    assert.equal((await reveal(viewer, pets[0], 'REWARDED', randomUUID(), ad)).unlockMethod, 'REWARDED');
  } finally { await db.exec('update public.pet_reward_settings set ads_enabled=true,share_enabled=true'); }
});

test('unavailable selected photos permit one reward rebind without changing moderation', async () => {
  const viewer = owner(), session = randomUUID();
  await allowance(viewer, 0);
  await rpc('start_pet_ad_reward', viewer, session, pets[10]);
  await rpc('complete_pet_ad_reward', viewer, session);
  await assert.rejects(rpc('rebind_pet_ad_reward', viewer, session, pets[11]), /AD_REWARD_RESELECT_UNAVAILABLE/);
  // Only disposable fixture photo rows are changed; no production connection exists.
  await db.query('update public.pet_photos set is_active=false where pet_id=$1', [pets[10]]);
  try {
    const state = await rpc('rebind_pet_ad_reward', viewer, session, pets[11]);
    assert.equal(state.adRewards[0].petId, pets[11]);
    await assert.rejects(rpc('rebind_pet_ad_reward', viewer, session, pets[9]), /AD_REWARD_RESELECT_UNAVAILABLE/);
    assert.equal((await reveal(viewer, pets[11], 'REWARDED', randomUUID(), session)).unlockMethod, 'REWARDED');
  } finally { await db.query('update public.pet_photos set is_active=true where pet_id=$1', [pets[10]]); }
});

test('paid endpoints reject owner photos and cross-user reward theft', async () => {
  await assert.rejects(reveal('fixture-owner', pets[0]), /OWNER_PHOTO_FREE/);
  const viewer = owner(), stranger = owner(), ad = randomUUID(), share = randomUUID();
  await allowance(viewer, 0);
  await rpc('start_pet_ad_reward', viewer, ad, pets[0]);
  await rpc('start_pet_share_reward', viewer, share);
  await assert.rejects(rpc('complete_pet_ad_reward', stranger, ad), /AD_SESSION_NOT_FOUND/);
  await assert.rejects(rpc('record_pet_share_reward', stranger, share, randomUUID(), 1, 1), /SHARE_SESSION_NOT_FOUND/);
});

test('legacy v3 remains callable and its ad use contributes to the new daily cap', async () => {
  const viewer = owner();
  await allowance(viewer, 0);
  const day = await today();
  const legacy = await rpc('record_pet_reveal_v3', viewer, day, pets[0], 'REWARDED', randomUUID());
  assert.equal(legacy.dailyProgress.totalCount, 4);
  assert.equal((await rpc('get_pet_reward_state', viewer)).adsCompletedToday, 1);
  const session = randomUUID();
  await rpc('start_pet_ad_reward', viewer, session, pets[1]);
  await rpc('complete_pet_ad_reward', viewer, session);
  await assert.rejects(rpc('start_pet_ad_reward', viewer, randomUUID(), pets[2]), /REWARDED_LIMIT_REACHED/);
});

test('old AIT reveal methods include completed but unspent new ad rewards in their cap', async () => {
  for (const method of ['record_pet_reveal_v2', 'record_pet_reveal_v3']) {
    const viewer = owner(), day = await today();
    await allowance(viewer, 0);
    for (const pet of pets.slice(0, 2)) {
      const session = randomUUID();
      await rpc('start_pet_ad_reward', viewer, session, pet);
      await rpc('complete_pet_ad_reward', viewer, session);
    }
    await assert.rejects(rpc(method, viewer, day, pets[2], 'REWARDED', randomUUID()), /REWARDED_LIMIT_REACHED/);
    const state = await rpc('get_pet_reward_state', viewer);
    assert.equal(state.adsCompletedToday, 2);
    assert.equal(state.adRewards.length, 2);
    const rows = await db.query('select count(*)::integer as count from public.daily_reveals where owner_hash=$1', [viewer]);
    assert.equal(rows.rows[0].count, 0);
  }
});

test('old AIT cannot use a new session identifier without consuming its completed credit atomically', async () => {
  const viewer = owner(), session = randomUUID(), day = await today();
  await allowance(viewer, 0);
  await rpc('start_pet_ad_reward', viewer, session, pets[0]);
  await assert.rejects(rpc('record_pet_reveal_v3', viewer, day, pets[0], 'REWARDED', session), /AD_REWARD_UNAVAILABLE/);
  await rpc('complete_pet_ad_reward', viewer, session);
  await assert.rejects(rpc('record_pet_reveal_v3', viewer, day, pets[0], 'REWARDED', session), /AD_REWARD_UNAVAILABLE/);
  assert.equal((await reveal(viewer, pets[0], 'REWARDED', randomUUID(), session)).unlockMethod, 'REWARDED');
});

test('new-start kill switch also blocks legacy ads while preserving completed v4 rewards', async () => {
  const viewer = owner(), session = randomUUID(), day = await today();
  await allowance(viewer, 0);
  await rpc('start_pet_ad_reward', viewer, session, pets[0]);
  await rpc('complete_pet_ad_reward', viewer, session);
  await db.exec('update public.pet_reward_settings set ads_enabled=false');
  try {
    await assert.rejects(rpc('record_pet_reveal_v2', viewer, day, pets[1], 'REWARDED', randomUUID()), /ADS_DISABLED/);
    await assert.rejects(rpc('record_pet_reveal_v3', viewer, day, pets[1], 'REWARDED', randomUUID()), /ADS_DISABLED/);
    assert.equal((await reveal(viewer, pets[0], 'REWARDED', randomUUID(), session)).unlockMethod, 'REWARDED');
  } finally { await db.exec('update public.pet_reward_settings set ads_enabled=true'); }
});

test('a cross-midnight active revisit preserves its original deterministic photo date', async () => {
  const viewer = owner();
  const first = await reveal(viewer, pets[0]);
  const previous = await db.query(`update public.daily_reveals set reveal_date=reveal_date-1
    where owner_hash=$1 returning reveal_date::text as day`, [viewer]);
  const revisited = await reveal(viewer, pets[0]);
  assert.equal(revisited.revealDate, previous.rows[0].day);
  assert.equal(revisited.revisitUntil, first.revisitUntil);
  assert.equal(revisited.alreadyRevealed, true);
  const free = await db.query('select balance from public.pet_free_allowances where owner_hash=$1', [viewer]);
  assert.equal(free.rows[0].balance, 1);
});

test('failure to commit daily progress rolls back bonus debit, reveal and request ledger together', async () => {
  const viewer = owner(), request = randomUUID();
  await allowance(viewer, 0);
  await earnShare(viewer, 2);
  const definition = await db.query("select pg_get_functiondef('public.mark_daily_house_pet_met(text,date,uuid)'::regprocedure) as sql");
  await db.exec(`create or replace function public.mark_daily_house_pet_met(p_owner_hash text,p_date date,p_pet_id uuid)
    returns jsonb language plpgsql as $$ begin raise exception 'SIMULATED_PROGRESS_FAILURE'; end; $$;`);
  try {
    await assert.rejects(reveal(viewer, pets[0], 'SHARE', request), /SIMULATED_PROGRESS_FAILURE/);
    assert.equal((await rpc('get_pet_reward_state', viewer)).bonusTickets, 2);
    const rows = await db.query(`select
      (select count(*)::integer from public.daily_reveals where owner_hash=$1) as reveals,
      (select count(*)::integer from public.pet_reveal_requests where owner_hash=$1) as requests`, [viewer]);
    assert.deepEqual(rows.rows[0], { reveals: 0, requests: 0 });
  } finally { await db.exec(definition.rows[0].sql); }
  const retried = await reveal(viewer, pets[0], 'SHARE', request);
  assert.equal(retried.bonusTickets, 1);
});

test('immutable submission retries preserve the first photo/name/design and every later review edit', async () => {
  const viewer = owner(), submission = randomUUID(), pet = randomUUID();
  const traits = { schemaVersion: 1, earShape: 'floppy', headShape: 'round',
    baseColor: 'white', secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 1 };
  const style = { schemaVersion: 1, coatMode: 'solid', furStyle: 'cloud' };
  const accessory = { kind: 'ribbon', color: 'pink', assetKey: 'builtin:ribbon' };
  const alternateTraits = { ...traits, secondaryColor: 'caramel', markingPattern: 'mask' };
  const alternateStyle = { schemaVersion: 1, coatMode: 'point', furStyle: 'fluffy' };
  const alternateAccessory = { kind: 'scarf', color: 'sky', assetKey: 'builtin:scarf' };
  const day = await today();
  const originalArgs = [viewer, submission, pet, `first/${pet}.jpg`, '처음', JSON.stringify(traits),
    JSON.stringify(style), day, 1000, 1000, 'owner', JSON.stringify(accessory)];
  const alternateArgs = [viewer, submission, randomUUID(), `retry/${pet}.jpg`, '변경', JSON.stringify(alternateTraits),
    JSON.stringify(alternateStyle), day, 1000, 1000, 'owner', JSON.stringify(alternateAccessory)];
  const register = args => db.query(`select * from public.register_pet_submission_v3(
    $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::date,$9,$10,$11,$12::jsonb)`, args);
  const snapshot = async () => (await db.query(`select pet.name,pet.storage_path,pet.traits,
    pet.submitted_traits,pet.submitted_style,pet.published_style,pet.requested_accessory,
    pet.published_accessory,pet.design_version,pet.status,photo.storage_path as photo_path
    from public.pets pet join public.pet_photos photo on photo.pet_id=pet.id where pet.id=$1`, [pet])).rows[0];
  const first = await register(originalArgs);
  const pending = await snapshot();
  // PGlite serializes queued requests: this proves repeat handling and immutable
  // rows. Multi-connection advisory-lock contention still requires native PG.
  const retries = await Promise.all([register(alternateArgs), register(originalArgs)]);
  assert.ok(retries.every(result => result.rows[0].pet_id === first.rows[0].pet_id));
  assert.deepEqual(await snapshot(), pending);
  assert.equal(pending.photo_path, originalArgs[3]);
  assert.deepEqual(pending.published_accessory, accessory);
  await db.query(`update public.pets set status='approved',name='최종',traits=$2::jsonb,
    published_style=$3::jsonb,design_version=2,reviewed_at=now() where id=$1`,
  [pet, JSON.stringify(alternateTraits), JSON.stringify(alternateStyle)]);
  const reviewed = await snapshot();
  await register(alternateArgs);
  await register(originalArgs);
  assert.deepEqual(await snapshot(), reviewed);
  assert.equal(reviewed.name, '최종');
  assert.equal(reviewed.design_version, 2);
  assert.equal(reviewed.photo_path, originalArgs[3]);
  assert.deepEqual(reviewed.submitted_traits, traits);
  assert.deepEqual(reviewed.submitted_style, style);
  assert.deepEqual(reviewed.published_style, alternateStyle);
  assert.deepEqual(reviewed.published_accessory, accessory);
  const counts = await db.query(`select count(*)::integer as pets
    from public.pets where owner_hash=$1 and submission_id=$2`, [viewer, submission]);
  assert.equal(counts.rows[0].pets, 1);
});

test('multiple owner uploads never occupy public slots, including old assignments repaired after migration', async () => {
  const viewer = owner(), ownedPets = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, id] of ownedPets.entries()) {
    const path = `owner-fixtures/${id}.jpg`;
    await db.query(`insert into public.pets(id,owner_hash,name,storage_path,status,traits,created_at,reviewed_at)
      values ($1,$2,$3,$4,$5::public.pet_status,'{}',now()-($6::integer*interval '1 day'),now()-interval '2 days')`,
    [id, viewer, `내견${index}`, path, index === 2 ? 'pending' : 'approved', 3 - index]);
    await db.query("insert into storage.objects(bucket_id,name) values ('pet-photos',$1)", [path]);
  }
  const snapshot = async () => (await db.query('select snapshot from public.get_pet_house_snapshot_v2($1,$2)', [viewer, await today()])).rows[0].snapshot;
  const ownRows = async () => (await db.query('select to_jsonb(pet) as pet from public.pets pet where owner_hash=$1 order by id', [viewer])).rows;
  const original = await ownRows();
  let house = await snapshot();
  assert.equal(house.ownerBonusPet.id, ownedPets[2]);
  assert.equal(house.ownerBonusPet.status, 'pending');
  assert.equal(house.dailyPets.length, 4);
  assert.ok(house.dailyPets.every(pet => !ownedPets.includes(pet.id)));
  // Simulate a disposable assignment created by the prior version, which
  // allowed an older owner upload in a public slot. Repair must replace it
  // without mutating the dog or removing already-earned slot progress.
  await db.query(`update public.daily_house_assignments set pet_id=$2,
    met_pet_id=$2,met_at=now(),was_assigned=true where owner_hash=$1 and slot=1`, [viewer, ownedPets[0]]);
  house = await snapshot();
  assert.equal(house.dailyPets.length, 4);
  assert.ok(house.dailyPets.every(pet => !ownedPets.includes(pet.id)));
  assert.equal(house.dailyProgress.metCount, 1);
  assert.equal(house.ownerBonusPet.id, ownedPets[2]);
  assert.deepEqual(await ownRows(), original);
});
