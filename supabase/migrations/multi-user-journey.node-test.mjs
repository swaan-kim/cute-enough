// Actual SQL/RPC journey in isolated in-memory PostgreSQL. The Storage fixture
// contains metadata only; this does not claim UI, Edge, Toss, push or live QA.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { canonicalPetDesign, hashPetDesign, validatePetDesign } from '../functions/_shared/pet-design.ts';

const db = new PGlite({ extensions: { pgcrypto } });
const root = new URL('./', import.meta.url);
const migration = '20260912000100_photo_prepare_rate_limit.sql';
const actor = 'isolated-journey-creator', owner = `journey-A-${randomUUID()}`;
const viewer = `journey-B-${randomUUID()}`, stranger = `journey-C-${randomUUID()}`;
const petId = randomUUID(), submissionId = randomUUID();
const paths = [0, 1].map((index) => `${owner}/${submissionId}/${petId}/${index}.jpg`);
const traits = { schemaVersion: 1, earShape: 'rounded', headShape: 'round', baseColor: 'white',
  secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 1 };
const style = { schemaVersion: 1, coatMode: 'solid', furStyle: 'neat' };
const requested = { kind: 'scarf', color: 'sky', assetKey: 'builtin:scarf' };
const document = validatePetDesign({ schemaVersion: 1, motionVersion: 1, viewBox: [0, 0, 180, 156],
  nodes: [{ tag: 'circle', attrs: { cx: 90, cy: 78, r: 40, fill: '#fff' } },
    { tag: 'g', motion: 'tail', children: [{ tag: 'path', attrs: { d: 'M15 80Q2 70 8 55', stroke: '#ddd' } }] }] });
const editor = { finalTraits: traits, finalStyle: style, publishedAccessory: requested,
  editor: { schemaVersion: 1, document, baseDocument: document, input: { traits, style, accessory: requested } } };
const rpc = async (name, ...args) => {
  assert.match(name, /^[a-z_0-9]+$/);
  return (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result;
};
const today = async () => (await db.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text date")).rows[0].date;
const pet = async () => (await db.query('select * from public.pets where id=$1', [petId])).rows[0];
const photoRows = async () => (await db.query('select * from public.pet_photos where pet_id=$1 order by sort_order,id', [petId])).rows;
const state = async (who) => (await rpc('get_pet_album_state', who, [petId]))[0];
const submit = async () => (await db.query(`select * from public.register_pet_submission_v4(
  $1,$2,$3,$4,'하루',$5,$6,$7,1000,1000,'owner',$8)`,
  [owner, submissionId, petId, paths, JSON.stringify(traits), JSON.stringify(style), await today(), JSON.stringify(requested)])).rows;
const recordSnapshot = async () => (await db.query(`select jsonb_build_object(
  'pet',(select to_jsonb(p) from public.pets p where id=$1),
  'versions',(select coalesce(jsonb_agg(to_jsonb(v) order by design_version),'[]') from public.pet_design_versions v where pet_id=$1),
  'drafts',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.pet_design_drafts d where pet_id=$1),
  'grants',(select coalesce(jsonb_agg(to_jsonb(g) order by owner_hash,photo_id),'[]') from public.user_photo_unlocks g where pet_id=$1),
  'collections',(select coalesce(jsonb_agg(to_jsonb(c) order by owner_hash,collection_date),'[]') from public.pet_daily_photo_collections c where pet_id=$1),
  'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by owner_hash,request_id),'[]') from public.pet_photo_reveal_requests r where pet_id=$1),
  'favorites',(select coalesce(jsonb_agg(to_jsonb(f) order by owner_hash),'[]') from public.pet_favorites f where pet_id=$1),
  'rewards',(select coalesce(jsonb_agg(to_jsonb(u) order by owner_hash),'[]') from public.upload_rewards u where pet_id=$1)
) state`, [petId])).rows[0].state;
let previousActions, previousRateRows;
const rateOwner = `journey-rate-${randomUUID()}`;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),primary key(bucket_id,name));`);
  const files = (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name) && name < migration
    // Existing harness exceptions: named operational data repair and pg_net
    // notification worker. Notification behavior has its own isolated suite.
    && !['20260829000100_fix_wooyoo_white_traits.sql', '20260905000400_recharge_notifications.sql'].includes(name)).sort();
  for (const file of files) {
    try { await db.exec(await readFile(new URL(file, root), 'utf8')); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`, { cause: error }); }
  }
  const definition = (await db.query("select pg_get_constraintdef(oid) definition from pg_constraint where conname='pet_api_rate_limits_action_check'")).rows[0].definition;
  previousActions = [...definition.matchAll(/'([^']+)'::text/g)].map((match) => match[1]);
  assert.ok(previousActions.length > 20);
  for (const action of previousActions) assert.equal(await rpc('check_pet_api_rate_limit', rateOwner, action, 60, 30), true);
  previousRateRows = (await db.query('select * from public.pet_api_rate_limits where owner_hash=$1 order by action', [rateOwner])).rows;
  await assert.rejects(rpc('check_pet_api_rate_limit', rateOwner, 'photoPrepare', 60, 30), /pet_api_rate_limits_action_check/);
  await db.exec(await readFile(new URL(migration, root), 'utf8'));
}, { timeout: 120000 });
after(() => db.close());

test('additive photoPrepare rate limit preserves old actions and counters; 30 allowed, 31 rejected, then window resets', async () => {
  assert.deepEqual((await db.query('select * from public.pet_api_rate_limits where owner_hash=$1 order by action', [rateOwner])).rows, previousRateRows);
  for (const action of previousActions) assert.equal(await rpc('check_pet_api_rate_limit', rateOwner, action, 60, 30), true);
  for (let count = 1; count <= 30; count++) assert.equal(await rpc('check_pet_api_rate_limit', rateOwner, 'photoPrepare', 60, 30), true);
  assert.equal(await rpc('check_pet_api_rate_limit', rateOwner, 'photoPrepare', 60, 30), false);
  assert.equal(await rpc('check_pet_api_rate_limit', stranger, 'photoPrepare', 60, 30), true, 'another user has an independent bucket');
  assert.equal((await db.query("select request_count from public.pet_api_rate_limits where owner_hash=$1 and action='ownerPhoto'", [rateOwner])).rows[0].request_count, 2);
  await db.query("update public.pet_api_rate_limits set window_started_at=now()-interval '61 seconds' where owner_hash=$1 and action='photoPrepare'", [rateOwner]);
  assert.equal(await rpc('check_pet_api_rate_limit', rateOwner, 'photoPrepare', 60, 30), true);
  assert.equal((await db.query("select request_count from public.pet_api_rate_limits where owner_hash=$1 and action='photoPrepare'", [rateOwner])).rows[0].request_count, 1);
  await assert.rejects(rpc('check_pet_api_rate_limit', rateOwner, 'inventedAction', 60, 30), /pet_api_rate_limits_action_check/);
});

test('A registers and creator approves; B collects and favorites; A reloads counts; additions preserve the entire journey', async (t) => {
  let firstRegistration, firstPhotos, published, collectedPhotoId, preparedBatch, baseline;
  await t.test('two original photos register one pending dog and one reward; B has no photo or favorite permission', async () => {
    for (const path of paths) await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
    firstRegistration = await submit();
    assert.deepEqual(firstRegistration, [{ pet_id: petId, reward_granted: true }]);
    assert.deepEqual(await submit(), firstRegistration);
    const current = await pet();
    assert.equal(current.owner_hash, owner); assert.equal(current.status, 'pending');
    assert.deepEqual(current.requested_accessory, requested);
    firstPhotos = await photoRows();
    assert.deepEqual(firstPhotos.map((row) => row.storage_path), paths);
    assert.equal((await db.query('select count(*)::int n from public.upload_rewards where pet_id=$1', [petId])).rows[0].n, 1);
    await assert.rejects(rpc('authorize_pet_album_photo', viewer, firstPhotos[0].id), /ALBUM_PHOTO_UNAVAILABLE/);
    await assert.rejects(rpc('prepare_pet_photo_unlock', viewer, petId, randomUUID(), 'FREE', null), /PET_NOT_AVAILABLE/);
    await assert.rejects(rpc('set_pet_favorite', viewer, petId, true), /FAVORITE_PHOTO_REQUIRED/);
    assert.equal((await state(owner)).favoriteCount, 0);
  });

  await t.test('saving a draft keeps pending private; explicit creator approval publishes the exact normalized SVG', async () => {
    const draft = await rpc('save_pet_design_draft', petId, actor, JSON.stringify(document), JSON.stringify(editor), 0, 1);
    const digest = await hashPetDesign(document);
    assert.equal(draft.sha256, digest); assert.equal((await pet()).status, 'pending');
    assert.equal((await pet()).published_design_id, null);
    await assert.rejects(rpc('authorize_pet_album_photo', viewer, firstPhotos[0].id), /ALBUM_PHOTO_UNAVAILABLE/);
    published = await rpc('review_pet_submission_with_design', petId, 'approved', actor, null, '하루', '격리 테스트 확정', draft.draftRevision, 1);
    assert.equal(published.status, 'approved'); assert.equal(published.designVersion, 2);
    assert.equal(published.publishedDesign.sha256, digest);
    assert.deepEqual(published.publishedDesign.document, document);
    const saved = (await db.query('select * from public.pet_design_versions where id=$1', [published.publishedDesign.id])).rows[0];
    assert.equal(saved.sha256, digest); assert.equal(saved.design_version, 2);
    assert.equal(await rpc('canonical_pet_design_json', JSON.stringify(saved.document)), canonicalPetDesign(document));
    assert.equal((await pet()).published_design_id, saved.id);
    assert.deepEqual((await pet()).requested_accessory, requested);
    assert.deepEqual(await submit(), firstRegistration, 'retry does not undo review or create a second dog');
    assert.equal((await pet()).status, 'approved');
  });

  await t.test('B earns exact photo access and favorite writes stay idempotent; A independently reloads the public count', async () => {
    await assert.rejects(rpc('set_pet_favorite', viewer, petId, true), /FAVORITE_PHOTO_REQUIRED/);
    const request = randomUUID();
    const prepared = await rpc('prepare_pet_photo_unlock', viewer, petId, request, 'FREE', null);
    const collected = await rpc('record_pet_photo_unlock', viewer, await today(), petId, prepared.photoId, 'FREE', request, null);
    collectedPhotoId = collected.photoId;
    assert.equal((await rpc('authorize_pet_album_photo', viewer, collectedPhotoId)).photoId, collectedPhotoId);
    await assert.rejects(rpc('authorize_pet_album_photo', stranger, collectedPhotoId), /ALBUM_PHOTO_UNAVAILABLE/);
    await assert.rejects(rpc('set_pet_favorite', stranger, petId, true), /FAVORITE_PHOTO_REQUIRED/);
    await assert.rejects(rpc('set_pet_favorite', owner, petId, true), /FAVORITE_PHOTO_REQUIRED/);
    assert.deepEqual(await rpc('set_pet_favorite', viewer, petId, true), { petId, isFavorite: true, favoriteCount: 1 });
    assert.deepEqual(await rpc('set_pet_favorite', viewer, petId, true), { petId, isFavorite: true, favoriteCount: 1 });
    assert.equal((await state(viewer)).isFavorite, true);
    for (let reload = 0; reload < 2; reload++) {
      const ownerState = await state(owner);
      assert.equal(ownerState.favoriteCount, 1); assert.equal(ownerState.isFavorite, false);
      assert.equal(ownerState.unlockedPhotoCount, 0, 'owner count does not masquerade as an album grant');
    }
    const album = await rpc('get_pet_album', viewer, null, null, 20, true);
    assert.equal(album.items[0].pet.id, petId); assert.equal(album.items[0].isFavorite, true);
    assert.equal(album.items[0].unlockedPhotos[0].photoId, collectedPhotoId);
  });

  await t.test('B removes and restores a favorite without removing A photos, B grants or the approved SVG', async () => {
    assert.equal((await rpc('set_pet_favorite', viewer, petId, false)).favoriteCount, 0);
    assert.equal((await rpc('set_pet_favorite', viewer, petId, false)).favoriteCount, 0);
    assert.equal((await state(owner)).favoriteCount, 0);
    assert.equal((await state(viewer)).unlockedPhotoCount, 1);
    assert.equal((await rpc('get_pet_album', viewer, null, null, 20, true)).items.length, 0);
    assert.equal((await rpc('get_pet_album', viewer, null, null, 20, false)).items.length, 1);
    await rpc('set_pet_favorite', viewer, petId, true);
    assert.equal((await state(owner)).favoriteCount, 1);
    baseline = await recordSnapshot();
    assert.equal(baseline.versions[0].sha256, published.publishedDesign.sha256);
  });

  await t.test('A submits additional photos privately; B album and the published design are unchanged', async () => {
    const additionId = randomUUID();
    const addedPaths = [0, 1].map((index) => `${owner}/${additionId}/photo-addition/${petId}/staged/${index}-${randomUUID()}.jpg`);
    for (const path of addedPaths) await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
    const beforeState = await state(viewer);
    const result = await rpc('submit_pet_photo_addition', owner, petId, additionId, addedPaths, addedPaths.map(() => 'a'.repeat(64)));
    assert.equal(result.submission.status, 'pending');
    preparedBatch = (await rpc('get_pet_photo_addition_review_queue')).items.find((row) => row.petId === petId);
    assert.ok(preparedBatch); assert.deepEqual(preparedBatch.photos.map((row) => row.storagePath), addedPaths);
    assert.deepEqual(await photoRows(), firstPhotos);
    assert.deepEqual(await state(viewer), beforeState);
    assert.deepEqual(await recordSnapshot(), baseline);
    await assert.rejects(rpc('get_pet_photo_addition_status', viewer, petId, null), /PHOTO_ADDITION_PET_NOT_FOUND/);
  });

  await t.test('explicit addition approval adds exact sources once and preserves original photo IDs, grants, favorites, rewards and SVG', async () => {
    const decide = () => rpc('review_pet_photo_addition', preparedBatch.batchId, preparedBatch.expectedRevision, 'approved', '', actor);
    assert.equal((await decide()).status, 'approved'); await decide();
    const photos = await photoRows();
    assert.equal(photos.length, 4); assert.deepEqual(photos.slice(0, 2), firstPhotos);
    assert.deepEqual(photos.slice(2).map((row) => row.storage_path), preparedBatch.photos.map((row) => row.storagePath));
    assert.deepEqual(await recordSnapshot(), baseline);
    const current = await state(viewer);
    assert.equal(current.favoriteCount, 1); assert.equal(current.isFavorite, true);
    assert.equal(current.unlockedPhotoCount, 1); assert.equal(current.collection.collectedToday, true);
    assert.equal(current.collection.totalCount, 4); assert.equal(current.collection.canCollectToday, false);
    for (const photo of photos.slice(2)) await assert.rejects(rpc('authorize_pet_album_photo', viewer, photo.id), /ALBUM_PHOTO_UNAVAILABLE/);
    assert.equal((await rpc('authorize_pet_album_photo', viewer, collectedPhotoId)).photoId, collectedPhotoId);
    assert.equal((await state(owner)).favoriteCount, 1);
    assert.equal((await rpc('get_pet_photo_addition_status', owner, petId, null)).submission.status, 'approved');
    assert.equal((await db.query('select count(*)::int n from public.pet_photo_review_audit where pet_id=$1', [petId])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='pet-photos' and name=any($1)", [paths])).rows[0].n, 2);
  });
});
