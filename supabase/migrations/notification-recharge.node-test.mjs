// Runs actual PostgreSQL notification SQL locally. pg_cron and pg_net are stubbed
// because PGlite does not host network/cron workers. All reminder business SQL is
// unchanged except clock_timestamp() is bound to an explicit test clock.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, beforeEach, test } from 'node:test';

const moduleUrl = process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href
  : import.meta.resolve('@electric-sql/pglite');
const { PGlite } = await import(moduleUrl);
const { pgcrypto } = await import(new URL('./contrib/pgcrypto.js', moduleUrl).href);
const db = new PGlite({ extensions: { pgcrypto } });
const directory = dirname(fileURLToPath(import.meta.url));
const baseTime = '2026-09-05T12:00:00+09:00';
const clock = async (at) => db.query('update public.notification_test_clock_value set value=$1', [at]);
const rpc = async (name, ...args) => {
  assert.match(name, /^[a-z_0-9]+$/);
  const result = await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args);
  return result.rows[0].value;
};
const jobs = async (owner) => (await db.query('select * from public.recharge_notification_jobs where owner_hash=$1 order by charge_at', [owner])).rows;
const claim = async () => (await db.query('select * from public.claim_recharge_notification_jobs(25)')).rows;
const prepare = (job) => rpc('prepare_recharge_notification_send', job.job_id, job.claim_token);
const setupZero = async (owner = randomUUID(), anchor = baseTime) => {
  await rpc('set_recharge_notification_settings', owner, true, 'v1.fakeiv.fakeciphertext', 'template-code');
  await db.query('insert into public.pet_free_allowances(owner_hash,balance,last_refill_at) values ($1,0,$2)', [owner, anchor]);
  return owner;
};

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,primary key(bucket_id,name));
    create schema cron; create schema net; create schema vault;
    create table cron.test_schedules(name text,expression text,command text);
    create function cron.schedule(text,text,text) returns bigint language plpgsql as $$
      begin insert into cron.test_schedules values ($1,$2,$3); return 1; end; $$;
    create table net.test_requests(url text,headers jsonb,body jsonb);
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$
      begin insert into net.test_requests values ($1,$2,$3); return 1; end; $$;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    create table public.notification_test_clock_value(value timestamptz);
    insert into public.notification_test_clock_value values ('${baseTime}');
    create function public.notification_test_clock() returns timestamptz language sql as $$
      select value from public.notification_test_clock_value; $$;`);
  const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)
    && name <= '20260905000400_recharge_notifications.sql'
    && name !== '20260829000100_fix_wooyoo_white_traits.sql').sort();
  for (const file of files) {
    let sql = await readFile(resolve(directory, file), 'utf8');
    if (file.endsWith('_recharge_notifications.sql')) {
      sql = sql.replace(/^create extension if not exists pg_(?:cron|net).*;$/gm, '')
        .replaceAll('clock_timestamp()', 'public.notification_test_clock()');
    }
    try { await db.exec(sql); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`, { cause: error }); }
  }
}, { timeout: 120_000 });
beforeEach(async () => {
  await db.exec(`truncate public.recharge_notification_jobs, public.recharge_notification_settings cascade;
    truncate public.pet_free_allowances; truncate public.daily_house_assignments;
    truncate net.test_requests; truncate vault.decrypted_secrets;
    update public.recharge_notification_worker_config set enabled=false,function_url=null;`);
  await clock(baseTime);
});
after(async () => db.close());

test('migrations execute with private tables and a disabled every-minute scheduler', async () => {
  const permissions = (await db.query(`select
    has_table_privilege('anon','public.recharge_notification_settings','SELECT') as raw_key,
    has_function_privilege('authenticated','public.prepare_recharge_notification_send(uuid,uuid)','EXECUTE') as send,
    has_function_privilege('service_role','public.set_recharge_notification_settings(text,boolean,text,text)','EXECUTE') as settings`)).rows[0];
  assert.deepEqual(permissions, { raw_key: false, send: false, settings: true });
  assert.equal((await db.query('select expression from cron.test_schedules')).rows[0].expression, '* * * * *');
  await rpc('dispatch_recharge_notification_worker');
  assert.equal((await db.query('select count(*)::int as count from net.test_requests')).rows[0].count, 0);
});

test('only the natural 0→1 boundary queues a reminder, preserving the refill anchor', async () => {
  const owner = randomUUID();
  await rpc('set_recharge_notification_settings', owner, true, 'v1.iv.cipher', 'template-code');
  await db.query('insert into public.pet_free_allowances(owner_hash,balance,last_refill_at) values ($1,1,$2)', [owner, '2026-09-05T10:00:00+09:00']);
  assert.equal((await jobs(owner)).length, 0);
  await db.query('update public.pet_free_allowances set balance=0 where owner_hash=$1', [owner]);
  assert.equal(new Date((await jobs(owner))[0].charge_at).toISOString(), '2026-09-05T04:00:00.000Z');
  await db.query('update public.pet_free_allowances set updated_at=now() where owner_hash=$1', [owner]);
  assert.equal((await jobs(owner)).length, 1);
  await db.query('update public.pet_free_allowances set balance=1 where owner_hash=$1', [owner]);
  await db.query('update public.pet_free_allowances set balance=2 where owner_hash=$1', [owner]);
  assert.equal((await jobs(owner)).length, 1);
});

test('opt-out clears the encrypted key and cancels queued and claimed work', async () => {
  const owner = await setupZero();
  await clock('2026-09-05T15:01:00+09:00');
  const [job] = await claim();
  await rpc('set_recharge_notification_settings', owner, false, null, null);
  assert.equal(await prepare(job), null);
  const settings = (await db.query('select enabled,encrypted_anon_key,consented_at from public.recharge_notification_settings where owner_hash=$1', [owner])).rows[0];
  assert.deepEqual(settings, { enabled: false, encrypted_anon_key: null, consented_at: null });
  assert.equal((await jobs(owner))[0].state, 'cancelled');
});

test('natural tickets without consent and share bonuses never create reminders', async () => {
  const owner = randomUUID();
  await db.query('insert into public.pet_free_allowances(owner_hash,balance,last_refill_at) values ($1,0,$2)', [owner, baseTime]);
  assert.equal((await jobs(owner)).length, 0);
  await rpc('set_recharge_notification_settings', owner, true, 'v1.iv.cipher', 'template-code');
  const [natural] = await jobs(owner);
  assert.ok(natural);
  await db.query('insert into public.pet_bonus_accounts(owner_hash,balance) values ($1,3)', [owner]);
  await db.query('update public.pet_bonus_accounts set balance=balance+2 where owner_hash=$1', [owner]);
  assert.equal((await jobs(owner)).length, 1);
  assert.equal((await jobs(owner))[0].id, natural.id);
});

test('opting in again before the same refill restores one cancelled job without duplicating it', async () => {
  const owner = await setupZero();
  const [original] = await jobs(owner);
  await rpc('set_recharge_notification_settings', owner, false, null, null);
  await clock('2026-09-05T13:00:00+09:00');
  await rpc('set_recharge_notification_settings', owner, true, 'v1.iv.newcipher', 'template-code');
  await rpc('set_recharge_notification_settings', owner, true, 'v1.iv.newcipher', 'template-code');
  const rows = await jobs(owner);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, original.id);
  assert.equal(rows[0].state, 'scheduled');
  await clock('2026-09-05T15:01:00+09:00');
  assert.equal((await prepare((await claim())[0])).ownerHash, owner);
});

test('a claim can start sending once and no second reminder is sent on the same KST day', async () => {
  const owner = await setupZero();
  await clock('2026-09-05T15:01:00+09:00');
  const [job] = await claim();
  assert.equal((await claim()).length, 0);
  assert.equal((await prepare(job)).ownerHash, owner);
  assert.equal(await prepare(job), null);
  await rpc('finish_recharge_notification_send', job.job_id, job.claim_token, 'sent', 'push_confirmed');
  await db.query('update public.pet_free_allowances set last_refill_at=$2 where owner_hash=$1', [owner, '2026-09-05T15:00:00+09:00']);
  await clock('2026-09-05T18:01:00+09:00');
  const [second] = await claim();
  assert.equal(await prepare(second), null);
  assert.equal((await jobs(owner))[1].outcome_reason, 'daily_limit');
});

test('an unvisited overnight recharge waits until 08:00 and rechecks consent then', async () => {
  await clock('2026-09-05T20:00:00+09:00');
  const owner = await setupZero(undefined, '2026-09-05T20:00:00+09:00');
  assert.equal(new Date((await jobs(owner))[0].not_before).toISOString(), '2026-09-05T23:00:00.000Z');
  await clock('2026-09-06T07:59:59+09:00');
  assert.equal((await claim()).length, 0);
  await clock('2026-09-06T08:00:00+09:00');
  assert.equal((await prepare((await claim())[0])).ownerHash, owner);
});

test('a claim crossing 21:00 is deferred and the old claim cannot send after cancellation', async () => {
  await clock('2026-09-05T17:59:00+09:00');
  const owner = await setupZero(undefined, '2026-09-05T17:59:00+09:00');
  await clock('2026-09-05T20:59:59+09:00');
  const [job] = await claim();
  await clock('2026-09-05T21:00:00+09:00');
  assert.equal(await prepare(job), null);
  assert.equal((await jobs(owner))[0].state, 'scheduled');
  assert.equal(new Date((await jobs(owner))[0].not_before).toISOString(), '2026-09-05T23:00:00.000Z');
  await rpc('set_recharge_notification_settings', owner, false, null, null);
  await clock('2026-09-06T08:00:00+09:00');
  assert.equal((await claim()).length, 0);
  assert.equal(await prepare(job), null);
});

test('a visit after charging cancels an overnight reminder before the worker runs', async () => {
  await clock('2026-09-05T20:00:00+09:00');
  const owner = await setupZero(undefined, '2026-09-05T20:00:00+09:00');
  await clock('2026-09-05T23:01:00+09:00');
  await rpc('note_recharge_notification_visit', owner);
  await clock('2026-09-06T08:00:00+09:00');
  assert.equal((await claim()).length, 0);
  assert.equal((await jobs(owner))[0].outcome_reason, 'visited_since_charge');
});

test('four completed public slots suppress a reminder, without counting the owner bonus', async () => {
  const owner = await setupZero();
  await db.query(`insert into public.daily_house_assignments(owner_hash,assignment_date,slot,met_at)
    select $1,'2026-09-05',slot,now() from generate_series(1,4) slot`, [owner]);
  await clock('2026-09-05T15:01:00+09:00');
  assert.equal(await prepare((await claim())[0]), null);
  assert.equal((await jobs(owner))[0].outcome_reason, 'daily_complete');
});

test('a spent refill cancels the old cycle and schedules only the next natural one', async () => {
  const owner = await setupZero();
  await clock('2026-09-05T15:01:00+09:00');
  const [old] = await claim();
  await db.query('update public.pet_free_allowances set last_refill_at=$2 where owner_hash=$1', [owner, '2026-09-05T15:00:00+09:00']);
  assert.equal(await prepare(old), null);
  const rows = await jobs(owner);
  assert.equal(rows[0].state, 'cancelled');
  assert.equal(rows[1].state, 'scheduled');
  assert.equal(new Date(rows[1].charge_at).toISOString(), '2026-09-05T09:00:00.000Z');
});

test('a stale pre-send claim can recover, but a sending/unknown outcome can never retry', async () => {
  const owner = await setupZero();
  await clock('2026-09-05T15:01:00+09:00');
  const [first] = await claim();
  await clock('2026-09-05T15:17:00+09:00');
  const [recovered] = await claim();
  assert.notEqual(first.claim_token, recovered.claim_token);
  assert.equal(await prepare(first), null);
  assert.ok(await prepare(recovered));
  await clock('2026-09-05T15:33:00+09:00');
  assert.equal((await claim()).length, 0);
  assert.equal((await jobs(owner))[0].state, 'unknown');
  assert.equal(await prepare(recovered), null);
});

test('an unknown attempt consumes the daily limit but a later KST day can send a new refill reminder', async () => {
  const owner = await setupZero();
  await clock('2026-09-05T15:01:00+09:00');
  const [first] = await claim();
  assert.ok(await prepare(first));
  await rpc('finish_recharge_notification_send', first.job_id, first.claim_token, 'unknown', 'response_lost');
  await db.query('update public.pet_free_allowances set last_refill_at=$2 where owner_hash=$1', [owner, '2026-09-05T15:00:00+09:00']);
  await clock('2026-09-05T18:01:00+09:00');
  assert.equal(await prepare((await claim())[0]), null);
  assert.equal((await jobs(owner))[1].outcome_reason, 'daily_limit');
  await clock('2026-09-06T09:00:00+09:00');
  await db.query('update public.pet_free_allowances set last_refill_at=$2 where owner_hash=$1', [owner, '2026-09-06T09:00:00+09:00']);
  await clock('2026-09-06T12:01:00+09:00');
  const [nextDay] = await claim();
  assert.equal((await prepare(nextDay)).ownerHash, owner);
  assert.equal((await jobs(owner))[0].state, 'unknown');
});

test('the cron dispatcher requires an explicit enable switch and a Vault secret', async () => {
  await db.exec(`update public.recharge_notification_worker_config set enabled=true,
    function_url='https://xoqjehiqbaxpalbghngm.supabase.co/functions/v1/recharge-notifications'`);
  await rpc('dispatch_recharge_notification_worker');
  assert.equal((await db.query('select count(*)::int as count from net.test_requests')).rows[0].count, 0);
  await db.exec("insert into vault.decrypted_secrets values ('recharge_notification_cron_secret','test-only-fake-secret')");
  await rpc('dispatch_recharge_notification_worker');
  assert.equal((await db.query('select count(*)::int as count from net.test_requests')).rows[0].count, 1);
  await assert.rejects(db.exec("update public.recharge_notification_worker_config set function_url='https://example.com/collect'"), /check constraint/);
});
