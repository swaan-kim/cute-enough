// Local PostgreSQL contract tests. Never access Supabase or production records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { before, after, test } from 'node:test';

const moduleUrl = process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href : import.meta.resolve('@electric-sql/pglite');
const { PGlite } = await import(moduleUrl);
const { pgcrypto } = await import(new URL('./contrib/pgcrypto.js', moduleUrl).href);
const db = new PGlite({ extensions: { pgcrypto } });
const directory = dirname(fileURLToPath(import.meta.url));
const migration = '20260906000600_existing_pet_photo_additions.sql';
const traits = { schemaVersion: 1, earShape: 'rounded', headShape: 'round', baseColor: 'white',
  secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 1 };
const style = { schemaVersion: 1, coatMode: 'solid', furStyle: 'neat' };
const accessory = { kind: 'scarf', color: 'sky', assetKey: 'builtin:scarf' };
const fixtures = Object.fromEntries([
  ['historical', 'approved', 8], ['happy', 'approved', 2], ['pending', 'pending', 1],
  ['full', 'approved', 5], ['oneSlot', 'approved', 4], ['paused', 'paused', 1],
  ['rejected', 'rejected', 1], ['deleted', 'deleted', 1], ['retry', 'approved', 2],
  ['sameRace', 'approved', 1], ['differentRace', 'approved', 1],
  ['crossA', 'approved', 1], ['crossB', 'approved', 1], ['malformed', 'approved', 1],
  ['missing', 'approved', 1], ['atomic', 'approved', 1], ['restore', 'approved', 4],
  ['statusChange', 'approved', 2], ['guardDirect', 'approved', 3], ['missingActive', 'approved', 5],
  ['privilege', 'pending', 1],
].map(([name, status, count]) => [name, {
  id: randomUUID(), owner: name.startsWith('cross') ? 'shared-cross-owner' : `owner-${randomUUID()}`, status, count,
}]));
const rpc = async (name, ...args) => (await db.query(
  `select public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) result`, args)).rows[0].result;
const status = (pet, submissionId = null, owner = pet.owner) => rpc('get_pet_photo_addition_status', owner, pet.id, submissionId);
const prepare = (pet, submissionId, photoIndex = 0, owner = pet.owner) =>
  rpc('prepare_pet_photo_addition', owner, pet.id, submissionId, photoIndex);
const review = pet => rpc('get_pet_photo_review', pet.id);
const selected = state => state.photos.filter(photo => photo.isActive).map(({ photoId, caption }) => ({ photoId, caption }));
const saveReview = (state, selection = selected(state)) =>
  rpc('save_pet_photo_review', state.petId, state.revision, JSON.stringify(selection), 'local-test-creator');

async function addPet(pet) {
  const path = `existing-addition-fixture/${pet.id}/0.jpg`;
  await db.query(`insert into public.pets(id,owner_hash,name,storage_path,status,traits,submitted_traits,
    published_style,submitted_style,accessory_selection_mode,requested_accessory,published_accessory)
    values($1,$2,'친구',$3,$4,$5,$5,$6,$6,'owner',$7,$7)`,
  [pet.id, pet.owner, path, pet.status, JSON.stringify(traits), JSON.stringify(style), JSON.stringify(accessory)]);
  await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
  for (let index = 1; index < pet.count; index++) {
    const next = `existing-addition-fixture/${pet.id}/${index}.jpg`;
    await db.query('insert into public.pet_photos(pet_id,storage_path,sort_order) values($1,$2,$3)', [pet.id, next, index]);
    await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [next]);
  }
}

async function submission(pet, count = 1, submissionId = randomUUID()) {
  const paths = Array.from({ length: count }, (_, index) =>
    `${pet.owner}/${submissionId}/photo-addition/${pet.id}/staged/${index}-${randomUUID()}.jpg`);
  for (const path of paths) await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
  return { pet, submissionId, paths, hashes: paths.map((_, index) => index.toString(16).repeat(64)) };
}
const submit = (request, overrides = {}) => {
  const value = { owner: request.pet.owner, petId: request.pet.id, ...request, ...overrides };
  return rpc('submit_pet_photo_addition', value.owner, value.petId, value.submissionId, value.paths, value.hashes);
};
async function batchRows(pet) {
  return (await db.query('select * from public.pet_photo_addition_submissions where pet_id=$1 order by created_at,id', [pet.id])).rows;
}
async function itemRows(pet) {
  return (await db.query(`select item.* from public.pet_photo_addition_items item
    join public.pet_photo_addition_submissions batch on batch.id=item.batch_id
    where batch.pet_id=$1 order by batch.id,item.photo_index`, [pet.id])).rows;
}
async function preservedState(pet) {
  return (await db.query(`select (select to_jsonb(pet) from public.pets pet where id=$1) pet,
    (select jsonb_agg(to_jsonb(photo) order by photo.id) from public.pet_photos photo where pet_id=$1) photos,
    (select count(*)::int from public.pets) dog_count,
    (select count(*)::int from public.upload_rewards) rewards,
    (select count(*)::int from public.user_photo_unlocks) unlocks,
    (select count(*)::int from public.pet_daily_photo_collections) collections,
    (select count(*)::int from public.pet_favorites) favorites,
    (select count(*)::int from public.admin_audit_logs) audits`, [pet.id])).rows[0];
}

let historicalBefore;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,
      created_at timestamptz default now(),primary key(bucket_id,name));`);
  const files = (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name) && name < migration)
    .filter(name => !['20260829000100_fix_wooyoo_white_traits.sql', '20260905000400_recharge_notifications.sql'].includes(name)).sort();
  // Create approved historical fixtures before the SVG publication guard, just
  // like real pre-existing dogs. No publication bypass or approval RPC is added.
  for (const file of files.filter(name => name < '20260906000100')) await db.exec(await readFile(resolve(directory, file), 'utf8'));
  for (const pet of Object.values(fixtures)) await addPet(pet);
  for (const file of files.filter(name => name >= '20260906000100')) await db.exec(await readFile(resolve(directory, file), 'utf8'));
  const firstPhoto = (await review(fixtures.happy)).photos[0].photoId;
  await db.query("insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source) values('fixture-viewer',$1,$2,'reveal')", [firstPhoto, fixtures.happy.id]);
  await db.query("insert into public.pet_daily_photo_collections(owner_hash,pet_id,collection_date,photo_id) values('fixture-viewer',$1,current_date,$2)", [fixtures.happy.id, firstPhoto]);
  await db.query("insert into public.pet_favorites(owner_hash,pet_id) values('fixture-viewer',$1)", [fixtures.happy.id]);
  historicalBefore = await preservedState(fixtures.historical);
  await db.exec(await readFile(resolve(directory, migration), 'utf8'));
}, { timeout: 120000 });
after(() => db.close());

test('additive migration preserves historical dogs above five and offers no destructive normalization', async () => {
  assert.deepEqual(await preservedState(fixtures.historical), historicalBefore);
  const result = await status(fixtures.historical);
  assert.equal(result.activePhotoCount, 8);
  assert.equal(result.remainingCount, 0);
  assert.equal(result.canSubmit, false);
  assert.equal(result.unavailableReason, 'PHOTO_ADDITION_CAPACITY_REACHED');
  const request = await submission(fixtures.historical);
  await assert.rejects(submit(request), /PHOTO_ADDITION_CAPACITY_REACHED/);
  assert.equal((await batchRows(fixtures.historical)).length, 0);
});

test('staging and final submission require the owner and reject unavailable dog statuses', async () => {
  const request = await submission(fixtures.malformed);
  for (const operation of [
    status(fixtures.malformed, null, 'different-owner'),
    prepare(fixtures.malformed, request.submissionId, 0, 'different-owner'),
    submit(request, { owner: 'different-owner' }),
    rpc('get_pet_photo_addition_status', fixtures.malformed.owner, randomUUID(), null),
  ]) await assert.rejects(operation, /PHOTO_ADDITION_PET_NOT_FOUND/);
  for (const pet of [fixtures.paused, fixtures.rejected, fixtures.deleted]) {
    assert.equal((await status(pet)).unavailableReason, 'PHOTO_ADDITION_NOT_ALLOWED');
    const attempt = await submission(pet);
    await assert.rejects(prepare(pet, attempt.submissionId), /PHOTO_ADDITION_NOT_ALLOWED/);
    await assert.rejects(submit(attempt), /PHOTO_ADDITION_NOT_ALLOWED/);
    assert.equal((await batchRows(pet)).length, 0);
  }
  for (const values of [[null, fixtures.happy.id, randomUUID()], ['', fixtures.happy.id, randomUUID()], [fixtures.happy.owner, null, randomUUID()]]) {
    await assert.rejects(rpc('prepare_pet_photo_addition', ...values, 0), /INVALID_PHOTO_ADDITION_INPUT/);
  }
});

test('pending dog can propose photos without registering another dog, granting a reward, or changing its status', async () => {
  const pet = fixtures.pending;
  const before = await preservedState(pet);
  const request = await submission(pet, 4);
  const staged = await prepare(pet, request.submissionId, 3);
  assert.equal(staged.remainingCount, 4);
  assert.equal((await batchRows(pet)).length, 0);
  const result = await submit(request);
  assert.equal(result.submission.status, 'pending');
  assert.equal(result.submission.photoCount, 4);
  assert.equal(result.remainingCount, 0);
  assert.deepEqual(await preservedState(pet), before);
});

test('approved additions remain outside every public photo reader and preserve source identities, albums and rewards', async () => {
  const pet = fixtures.happy;
  const before = await preservedState(pet);
  const beforeReview = await review(pet);
  const beforePublic = (await db.query('select * from public.get_existing_pet_photos($1)', [[pet.id]])).rows;
  const beforeAlbum = await rpc('get_pet_album_state', 'fixture-viewer', [pet.id]);
  const request = await submission(pet, 3);
  const result = await submit(request);
  assert.equal(result.submission.petId, pet.id);
  assert.equal(result.submission.status, 'pending');
  assert.equal(result.submission.photoCount, 3);
  assert.equal(result.remainingCount, 0);
  assert.deepEqual(await preservedState(pet), before);
  assert.deepEqual(await review(pet), beforeReview);
  assert.deepEqual((await db.query('select * from public.get_existing_pet_photos($1)', [[pet.id]])).rows, beforePublic);
  assert.deepEqual(await rpc('get_pet_album_state', 'fixture-viewer', [pet.id]), beforeAlbum);
  const items = await itemRows(pet);
  assert.deepEqual(items.map(item => item.photo_index), [0, 1, 2]);
  assert.deepEqual(items.map(item => item.storage_path), request.paths);
  assert.deepEqual(items.map(item => item.sha256), request.hashes);
  assert.equal((await db.query('select count(*)::int n from public.pet_photos where storage_path=any($1)', [request.paths])).rows[0].n, 0);
  const ownedStatus = await status(pet, request.submissionId);
  assert.equal(ownedStatus.found, true);
  assert.equal(ownedStatus.pendingPhotoCount, 3);
  assert.equal(ownedStatus.unavailableReason, 'PHOTO_ADDITION_PENDING');
  const encoded = JSON.stringify(ownedStatus);
  for (const secret of [pet.owner, ...request.paths, ...request.hashes]) assert.equal(encoded.includes(secret), false);
});

test('capacity counts active photos even when a source is missing, and one-slot dogs accept only one staged index/photo', async () => {
  for (const pet of [fixtures.full, fixtures.missingActive]) {
    if (pet === fixtures.missingActive) {
      const first = (await review(pet)).photos[0];
      await db.query("delete from storage.objects where bucket_id='pet-photos' and name=$1", [first.storagePath]);
    }
    assert.equal((await status(pet)).remainingCount, 0);
    await assert.rejects(submit(await submission(pet)), /PHOTO_ADDITION_CAPACITY_REACHED/);
  }
  const pet = fixtures.oneSlot, request = await submission(pet, 2);
  assert.equal((await prepare(pet, request.submissionId)).remainingCount, 1);
  await assert.rejects(prepare(pet, request.submissionId, 1), /PHOTO_ADDITION_CAPACITY_REACHED/);
  for (const index of [-1, 5, null]) await assert.rejects(prepare(pet, request.submissionId, index), /INVALID_PHOTO_INDEX/);
  await assert.rejects(submit(request), /PHOTO_ADDITION_CAPACITY_REACHED/);
  await submit(request, { paths: request.paths.slice(0, 1), hashes: request.hashes.slice(0, 1) });
  assert.equal((await status(pet)).pendingPhotoCount, 1);
});

test('one pending batch blocks another even when reserved photos leave unused capacity', async () => {
  const pet = fixtures.retry, first = await submission(pet), second = await submission(pet);
  await submit(first);
  assert.equal((await status(pet)).remainingCount, 2);
  await assert.rejects(prepare(pet, second.submissionId), /PHOTO_ADDITION_PENDING/);
  await assert.rejects(submit(second), /PHOTO_ADDITION_PENDING/);
  await assert.rejects(prepare(pet, first.submissionId), /PHOTO_ADDITION_ALREADY_SUBMITTED/);
  assert.equal((await batchRows(pet)).length, 1);
});

test('immutable retries return the first items after rejection and later pet moderation without reopening the batch', async () => {
  const pet = fixtures.retry, original = (await batchRows(pet))[0], beforeItems = await itemRows(pet);
  await db.query("update public.pet_photo_addition_submissions set status='rejected',reviewed_at=now(),reviewed_by='fixture-creator',review_note='다른 사진을 골라 주세요' where id=$1", [original.id]);
  await db.query("update public.pets set status='paused' where id=$1", [pet.id]);
  const petBefore = await preservedState(pet);
  const result = await submit({ pet, submissionId: original.submission_id, paths: null, hashes: null });
  assert.equal(result.submission.status, 'rejected');
  assert.equal(result.submission.submissionId, original.submission_id);
  assert.equal(result.submission.photoCount, original.photo_count);
  assert.equal(result.submission.reviewNote, '다른 사진을 골라 주세요');
  assert.equal((await batchRows(pet)).length, 1);
  assert.deepEqual(await itemRows(pet), beforeItems);
  assert.deepEqual(await preservedState(pet), petBefore);
});

test('concurrent same-submission calls return one batch and different submissions have only one winner', async () => {
  // PGlite serializes its single backend; parallel API dispatch still tests the
  // observable idempotency/uniqueness contract, not multi-connection lock timing.
  const same = await submission(fixtures.sameRace, 2);
  const sameResults = await Promise.all([submit(same), submit(same)]);
  assert.deepEqual(sameResults[0], sameResults[1]);
  assert.equal((await batchRows(fixtures.sameRace)).length, 1);
  assert.equal((await itemRows(fixtures.sameRace)).length, 2);
  const first = await submission(fixtures.differentRace), second = await submission(fixtures.differentRace);
  const results = await Promise.allSettled([submit(first), submit(second)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /PHOTO_ADDITION_PENDING/);
  assert.equal((await batchRows(fixtures.differentRace)).length, 1);
});

test('one owner request ID cannot be rebound concurrently or retried onto a different pet', async () => {
  const submissionId = randomUUID();
  const first = await submission(fixtures.crossA, 1, submissionId), second = await submission(fixtures.crossB, 1, submissionId);
  const results = await Promise.allSettled([submit(first), submit(second)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /PHOTO_ADDITION_CONFLICT/);
  assert.equal((await batchRows(fixtures.crossA)).length + (await batchRows(fixtures.crossB)).length, 1);
});

test('finalization rechecks moderation after staging and creates no batch if the dog was paused', async () => {
  const pet = fixtures.statusChange, request = await submission(pet);
  await prepare(pet, request.submissionId);
  await db.query("update public.pets set status='paused' where id=$1", [pet.id]);
  await assert.rejects(submit(request), /PHOTO_ADDITION_NOT_ALLOWED/);
  assert.equal((await batchRows(pet)).length, 0);
  assert.equal((await itemRows(pet)).length, 0);
});

test('SQL rejects malformed counts, hashes and paths bound to another owner, submission, pet or index', async () => {
  const pet = fixtures.malformed, request = await submission(pet, 2);
  const malformed = [
    [{ paths: [], hashes: [] }, /INVALID_PHOTO_COUNT/],
    [{ paths: null }, /INVALID_PHOTO_COUNT/],
    [{ paths: Array(6).fill(request.paths[0]), hashes: Array(6).fill(request.hashes[0]) }, /INVALID_PHOTO_COUNT/],
    [{ hashes: null }, /INVALID_PHOTO_COUNT/], [{ hashes: [request.hashes[0]] }, /INVALID_PHOTO_COUNT/],
    [{ paths: [null, request.paths[1]] }, /INVALID_PHOTO_PATH/],
    [{ hashes: ['', request.hashes[1]] }, /INVALID_PHOTO_PATH/],
    [{ hashes: [null, request.hashes[1]] }, /INVALID_PHOTO_PATH/],
    [{ paths: [request.paths[0], request.paths[0]] }, /INVALID_PHOTO_PATH/],
    [{ paths: [...request.paths].reverse() }, /INVALID_PHOTO_PATH/],
    [{ paths: request.paths.map(path => path.replace(pet.owner, 'other-owner')) }, /INVALID_PHOTO_PATH/],
    [{ paths: request.paths.map(path => path.replace(pet.id, fixtures.crossA.id)) }, /INVALID_PHOTO_PATH/],
    [{ paths: request.paths.map(path => path.replace(request.submissionId, randomUUID())) }, /INVALID_PHOTO_PATH/],
    [{ paths: request.paths.map(path => path.replace(`/photo-addition/${pet.id}`, '')) }, /INVALID_PHOTO_PATH/],
    [{ paths: request.paths.map(path => path.replace('/staged/', '/staged/extra/')) }, /INVALID_PHOTO_PATH/],
  ];
  for (const [overrides, error] of malformed) {
    await assert.rejects(submit(request, overrides), error);
    assert.equal((await batchRows(pet)).length, 0);
    assert.equal((await itemRows(pet)).length, 0);
  }
});

test('missing Storage and a late item insertion failure roll back the entire addition atomically', async () => {
  const missing = await submission(fixtures.missing, 3);
  await db.query("delete from storage.objects where bucket_id='pet-photos' and name=$1", [missing.paths[2]]);
  await assert.rejects(submit(missing), /PET_PHOTO_MISSING/);
  assert.equal((await batchRows(fixtures.missing)).length, 0);
  assert.equal((await itemRows(fixtures.missing)).length, 0);
  const request = await submission(fixtures.atomic, 3), before = await preservedState(fixtures.atomic);
  await db.exec(`create function fail_second_addition_item_fixture() returns trigger language plpgsql as $$
    begin if new.photo_index=1 then raise exception 'ADDITION_ITEM_FIXTURE_FAILURE'; end if; return new; end; $$;
    create trigger fail_second_addition_item_fixture before insert on public.pet_photo_addition_items
    for each row execute function fail_second_addition_item_fixture();`);
  try {
    await assert.rejects(submit(request), /ADDITION_ITEM_FIXTURE_FAILURE/);
    assert.equal((await batchRows(fixtures.atomic)).length, 0);
    assert.equal((await itemRows(fixtures.atomic)).length, 0);
    assert.deepEqual(await preservedState(fixtures.atomic), before);
    assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='pet-photos' and name=any($1)", [request.paths])).rows[0].n, 3);
  } finally {
    await db.exec('drop trigger fail_second_addition_item_fixture on public.pet_photo_addition_items; drop function fail_second_addition_item_fixture();');
  }
  await submit(request);
  assert.equal((await itemRows(fixtures.atomic)).length, 3);
});

test('deferred capacity guard rolls back creator restoration after an addition reserves available slots', async () => {
  const pet = fixtures.restore;
  let state = await review(pet);
  state = await saveReview(state, selected(state).slice(0, 3));
  const inactive = state.photos.find(photo => !photo.isActive);
  const request = await submission(pet, 2);
  await submit(request);
  const before = await preservedState(pet), beforeReview = await review(pet);
  const auditCount = (await db.query('select count(*)::int n from public.pet_photo_review_audit where pet_id=$1', [pet.id])).rows[0].n;
  await assert.rejects(saveReview(beforeReview, [...selected(beforeReview), { photoId: inactive.photoId, caption: null }]), /PHOTO_ADDITION_CAPACITY_REACHED/);
  assert.deepEqual(await preservedState(pet), before);
  assert.deepEqual(await review(pet), beforeReview);
  assert.equal((await db.query('select count(*)::int n from public.pet_photo_review_audit where pet_id=$1', [pet.id])).rows[0].n, auditCount);
  assert.equal((await status(pet)).pendingPhotoCount, 2);
  // Legitimate reorder briefly clears active slots internally, then restores
  // the same final count; the deferred check permits that complete transaction.
  state = await saveReview(beforeReview, selected(beforeReview).reverse());
  assert.equal(state.photos.filter(photo => photo.isActive).length, 3);
  const historical = await review(fixtures.historical);
  const reordered = await saveReview(historical, selected(historical).reverse());
  assert.equal(reordered.photos.filter(photo => photo.isActive).length, 8);
});

test('deferred guard also rejects direct active insertion alongside pending reservations', async () => {
  const pet = fixtures.guardDirect;
  await submit(await submission(pet, 2));
  const before = await preservedState(pet);
  await assert.rejects(db.query('insert into public.pet_photos(pet_id,storage_path,sort_order) values($1,$2,3)', [pet.id, `guard-extra-${randomUUID()}.jpg`]), /PHOTO_ADDITION_CAPACITY_REACHED/);
  assert.deepEqual(await preservedState(pet), before);
});

test('private tables enable RLS; public roles cannot read/call and service role can only write through scoped RPCs', async () => {
  const tables = ['pet_photo_addition_submissions', 'pet_photo_addition_items'];
  for (const table of tables) {
    assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass', [`public.${table}`])).rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const privilege = (await db.query(`select has_table_privilege($1,$2,'SELECT') read,
        has_table_privilege($1,$2,'INSERT') insert,has_table_privilege($1,$2,'UPDATE') update,
        has_table_privilege($1,$2,'DELETE') delete`, [role, `public.${table}`])).rows[0];
      assert.deepEqual(privilege, { read: role === 'service_role', insert: false, update: false, delete: false });
    }
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const signature of ['get_pet_photo_addition_status(text,uuid,uuid)', 'prepare_pet_photo_addition(text,uuid,uuid,integer)', 'submit_pet_photo_addition(text,uuid,uuid,text[],text[])']) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed, role === 'service_role');
    }
    await db.exec(`set role ${role}`);
    try {
      if (role !== 'service_role') {
        await assert.rejects(status(fixtures.privilege), /permission denied/);
        await assert.rejects(db.query('select * from public.pet_photo_addition_items'), /permission denied/);
      } else {
        assert.equal((await status(fixtures.privilege)).canSubmit, true);
        await assert.rejects(db.query('delete from public.pet_photo_addition_items'), /permission denied/);
      }
    } finally { await db.exec('reset role'); }
  }
  assert.equal((await db.query("select public from storage.buckets where id='pet-photos'")).rows[0].public, false);
  for (const action of ['photoAdditionStatus', 'photoAdditionUpload', 'photoAdditionSubmit']) {
    assert.equal(await rpc('check_pet_api_rate_limit', fixtures.privilege.owner, action, 60, 10), true);
  }
});
