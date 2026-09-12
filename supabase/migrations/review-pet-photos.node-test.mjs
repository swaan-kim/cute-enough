// Local PostgreSQL only. Exercise the real photo identity/sync, album, and SVG
// migrations together; never contact Supabase or alter production fixtures.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

const moduleUrl = process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href : import.meta.resolve('@electric-sql/pglite');
const { PGlite } = await import(moduleUrl);
const { pgcrypto } = await import(new URL('./contrib/pgcrypto.js', moduleUrl).href);
const db = new PGlite({ extensions: { pgcrypto } });
const dir = dirname(fileURLToPath(import.meta.url));
const migration = '20260906000500_review_pet_photos.sql';
const pets = Array.from({ length: 12 }, () => randomUUID());
const traits = { schemaVersion: 1, earShape: 'rounded', headShape: 'round', baseColor: 'white',
  secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 1 };
const style = { schemaVersion: 1, coatMode: 'solid', furStyle: 'neat' };
const accessory = { kind: 'scarf', color: 'sky', assetKey: 'builtin:scarf' };
const document = { schemaVersion: 1, motionVersion: 1, viewBox: [0, 0, 180, 180],
  nodes: [{ tag: 'circle', attrs: { cx: '90', cy: '90', r: '30', fill: '#fff' } }] };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const rpc = async (name, ...args) => (await db.query(
  `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args)).rows[0].result;
const get = pet => rpc('get_pet_photo_review', pet);
const selection = state => state.photos.filter(photo => photo.isActive)
  .map(({ photoId, caption }) => ({ photoId, caption }));
const save = (state, photos = selection(state), actor = 'creator') =>
  rpc('save_pet_photo_review', state.petId, state.revision, JSON.stringify(photos), actor);
const audit = async pet => (await db.query('select * from public.pet_photo_review_audit where pet_id=$1 order by id', [pet])).rows;
const petRow = async pet => (await db.query('select * from public.pets where id=$1', [pet])).rows[0];

async function addPet(id, status = 'approved', count = 3) {
  const path = `review/${id}/0.jpg`;
  await db.query(`insert into public.pets(id,owner_hash,name,storage_path,status,traits,submitted_traits,
    published_style,submitted_style,accessory_selection_mode,requested_accessory,published_accessory)
    values($1,'photo-review-owner','사진',$2,$3,$4,$4,$5,$5,'owner',$6,$6)`,
  [id, path, status, JSON.stringify(traits), JSON.stringify(style), JSON.stringify(accessory)]);
  await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
  for (let index = 1; index < count; index++) {
    const next = `review/${id}/${index}.jpg`;
    await db.query('insert into public.pet_photos(pet_id,storage_path,sort_order) values($1,$2,$3)', [id, next, index]);
    await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [next]);
  }
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,
      created_at timestamptz default now(),primary key(bucket_id,name));`);
  const files = (await readdir(dir)).filter(name => /^\d+.*\.sql$/.test(name) && name < migration)
    // Data correction requires its live dog; notifications require pg_net.
    .filter(name => !['20260829000100_fix_wooyoo_white_traits.sql', '20260905000400_recharge_notifications.sql'].includes(name)).sort();
  for (const file of files.filter(name => name < '20260906000100')) await db.exec(await readFile(resolve(dir, file), 'utf8'));
  for (const [index, pet] of pets.entries()) {
    const status = ({ 8: 'pending', 9: 'paused', 10: 'rejected', 11: 'deleted' })[index] ?? 'approved';
    await addPet(pet, status, index === 7 ? 16 : 3);
  }
  for (const file of files.filter(name => name >= '20260906000100')) await db.exec(await readFile(resolve(dir, file), 'utf8'));
  // Exact saved SVG fixture. Its existing publication, editor state and owner
  // request must survive representative-photo changes byte for byte.
  const version = randomUUID();
  const editorState = { finalTraits: traits, finalStyle: style, publishedAccessory: accessory };
  await db.query(`insert into public.pet_design_versions(id,pet_id,design_version,draft_revision,document,sha256,editor_state,created_by)
    values($1,$2,1,1,$3,public.pet_design_sha256($3),$4,'fixture')`,
  [version, pets[0], JSON.stringify(document), JSON.stringify(editorState)]);
  await db.query('update public.pets set published_design_id=$1 where id=$2', [version, pets[0]]);
  await db.query(`insert into public.pet_design_drafts(pet_id,revision,expected_design_version,document,sha256,editor_state,updated_by)
    values($1,1,1,$2,public.pet_design_sha256($2),$3,'fixture')`,
  [pets[0], JSON.stringify(document), JSON.stringify(editorState)]);
  await db.exec(await readFile(resolve(dir, migration), 'utf8'));
}, { timeout: 120000 });
after(async () => db.close());

test('migration is additive; get returns all photos and a canonical content SHA without signed URLs', async () => {
  assert.equal((await db.query('select count(*)::int as n from public.pet_photo_review_audit')).rows[0].n, 0);
  const state = await get(pets[0]);
  assert.deepEqual(Object.keys(state).sort(), ['petId', 'photos', 'revision']);
  assert.equal(state.photos.length, 3);
  assert.match(state.revision, /^[0-9a-f]{64}$/);
  assert.equal(state.revision, createHash('sha256').update(canonical({ petId: state.petId, photos: state.photos })).digest('hex'));
  assert.deepEqual(state.photos.map(photo => photo.sortOrder), [0, 1, 2]);
  assert.ok(state.photos.every(photo => photo.isActive && photo.available));
  assert.equal((await get(pets[0])).revision, state.revision);
  await db.query("update public.pet_photos set created_at=created_at-interval '1 day' where pet_id=$1", [pets[0]]);
  assert.equal((await get(pets[0])).revision, state.revision);
});

test('reorder uses existing IDs under unique slots, updates primary and preserves SVG/owner fields and all grants', async () => {
  const before = await get(pets[0]), original = await petRow(pets[0]);
  const ids = before.photos.map(photo => photo.photoId), viewer = `viewer-${randomUUID()}`;
  for (const photoId of ids) await db.query(`insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source)
    values($1,$2,$3,'reveal')`, [viewer, photoId, pets[0]]);
  await db.query('insert into public.pet_daily_photo_collections(owner_hash,pet_id,collection_date,photo_id) values($1,$2,current_date,$3)',
    [viewer, pets[0], ids[0]]);
  await db.query('insert into public.pet_favorites(owner_hash,pet_id) values($1,$2)', [viewer, pets[0]]);
  const records = await db.query(`select
    (select jsonb_agg(to_jsonb(v)) from public.pet_design_versions v where pet_id=$1) versions,
    (select jsonb_agg(to_jsonb(d)) from public.pet_design_drafts d where pet_id=$1) drafts`, [pets[0]]);
  const result = await save(before, [{ photoId: ids[2], caption: '바람이 좋아요' }, { photoId: ids[0], caption: null }], '  제작자  ');
  assert.deepEqual(result.photos.filter(photo => photo.isActive).map(photo => photo.photoId), [ids[2], ids[0]]);
  assert.deepEqual(result.photos.find(photo => photo.photoId === ids[1]), { ...before.photos[1], isActive: false, sortOrder: null });
  assert.deepEqual(result.photos.map(photo => photo.photoId).sort(), ids.slice().sort());
  const after = await petRow(pets[0]);
  assert.deepEqual(after, { ...original, storage_path: before.photos[2].storagePath });
  assert.deepEqual((await db.query(`select
    (select jsonb_agg(to_jsonb(v)) from public.pet_design_versions v where pet_id=$1) versions,
    (select jsonb_agg(to_jsonb(d)) from public.pet_design_drafts d where pet_id=$1) drafts`, [pets[0]])).rows, records.rows);
  assert.equal((await db.query('select count(*)::int n from public.user_photo_unlocks where owner_hash=$1', [viewer])).rows[0].n, 3);
  assert.equal((await db.query('select photo_id from public.pet_daily_photo_collections where owner_hash=$1', [viewer])).rows[0].photo_id, ids[0]);
  assert.equal((await db.query('select count(*)::int n from public.pet_favorites where owner_hash=$1', [viewer])).rows[0].n, 1);
  assert.equal(result.photos.filter(photo => photo.available).length, 3);
  const history = await audit(pets[0]);
  assert.equal(history[0].actor, '제작자');
  assert.equal(history[0].before_revision, before.revision);
  assert.equal(history[0].after_revision, result.revision);
  assert.deepEqual(history[0].before_snapshot, before);
  assert.deepEqual(history[0].after_snapshot, result);
  await assert.rejects(db.query('update public.pet_photos set storage_path=$1 where id=$2', ['other-path.jpg', ids[0]]), /PHOTO_IDENTITY_IMMUTABLE/);
});

test('excluded photos can be restored and made primary without creating a new photo identity', async () => {
  const state = await get(pets[0]), inactive = state.photos.find(photo => !photo.isActive);
  const selected = [{ photoId: inactive.photoId, caption: '다시 만나요' }, ...selection(state)];
  const result = await save(state, selected);
  assert.equal(result.photos.length, 3);
  assert.deepEqual(result.photos.map(photo => photo.photoId), selected.map(photo => photo.photoId));
  assert.ok(result.photos.every(photo => photo.isActive));
  assert.equal((await petRow(pets[0])).storage_path, inactive.storagePath);
});

test('same revision racing editors yield one success and one stale-write error with one audit entry', async () => {
  const state = await get(pets[1]);
  const outcomes = await Promise.allSettled([
    save(state, selection(state).reverse()),
    save(state, selection(state).map(photo => ({ ...photo, caption: '오래된 화면' }))),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /REVIEW_PHOTOS_CHANGED/);
  assert.equal((await audit(pets[1])).length, 1);
  for (const invalidRevision of [null, '', 'x'.repeat(64)]) {
    await assert.rejects(rpc('save_pet_photo_review', pets[1], invalidRevision, JSON.stringify(selection(state)), 'creator'), /REVIEW_PHOTOS_CHANGED/);
  }
});

test('rejects malformed/empty/oversized lists, duplicate and foreign IDs atomically', async () => {
  const state = await get(pets[2]), photo = selection(state)[0], foreign = selection(await get(pets[3]))[0];
  const invalid = [null, {}, 'bad', [], Array(17).fill(photo), [null], [3], [photo.photoId],
    [{ photoId: photo.photoId }], [{ caption: null }], [{ ...photo, sortOrder: 0 }],
    [{ ...photo, storagePath: 'forged' }], [{ ...photo, photoId: 1 }], [{ ...photo, photoId: 'not-a-uuid' }],
    [{ ...photo, caption: false }], [{ ...photo, caption: {} }], [photo, photo], [foreign], [{ ...photo, photoId: randomUUID() }]];
  for (const value of invalid) await assert.rejects(save(state, value), /INVALID_REVIEW_PHOTOS/);
  assert.deepEqual(await get(pets[2]), state);
  assert.equal((await audit(pets[2])).length, 0);
  for (const actor of [null, '', '  ']) await assert.rejects(save(state, selection(state), actor), /REVIEW_ACTOR_REQUIRED/);
});

test('captions follow existing 30 Unicode character rules and bind to exact photo IDs', async () => {
  let state = await get(pets[3]);
  for (const caption of ['가'.repeat(31), '🐶'.repeat(31), '<img src=x>', 'x>y', '첫줄\n둘째줄', '\u0001', '안\u200B녕', '\u202E역순', '\uFEFF문구']) {
    await assert.rejects(save(state, selection(state).map((photo, i) => ({ ...photo, caption: i ? null : caption }))), /INVALID_REVIEW_PHOTOS/);
  }
  const firstId = state.photos[0].photoId;
  state = await save(state, selection(state).map((photo, i) => ({ ...photo, caption: i ? null : '🐶'.repeat(30) })));
  assert.equal(state.photos.find(photo => photo.photoId === firstId).caption, '🐶'.repeat(30));
  state = await save(state, selection(state).reverse());
  assert.equal(state.photos.find(photo => photo.photoId === firstId).caption, '🐶'.repeat(30));
  assert.equal(state.photos[0].caption, null);
});

test('missing Storage changes revision, blocks retaining source and allows excluding only missing photos', async () => {
  const state = await get(pets[4]), missing = state.photos[1];
  await db.query("delete from storage.objects where bucket_id='pet-photos' and name=$1", [missing.storagePath]);
  const changed = await get(pets[4]);
  assert.notEqual(changed.revision, state.revision);
  assert.equal(changed.photos[1].available, false);
  await assert.rejects(save(state), /REVIEW_PHOTOS_CHANGED/);
  await assert.rejects(save(changed), /PET_PHOTO_MISSING/);
  const result = await save(changed, selection(changed).filter(photo => photo.photoId !== missing.photoId));
  assert.equal(result.photos.length, 3);
  assert.equal(result.photos.find(photo => photo.photoId === missing.photoId).isActive, false);
  await assert.rejects(save(result, [{ photoId: missing.photoId, caption: null }, ...selection(result)]), /PET_PHOTO_MISSING/);
  await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [missing.storagePath]);
  const restoredSource = await get(pets[4]);
  assert.notEqual(restoredSource.revision, result.revision);
  const restored = await save(restoredSource, [{ photoId: missing.photoId, caption: null }, ...selection(restoredSource)]);
  assert.equal(restored.photos[0].photoId, missing.photoId);
});

test('late audit failure rolls back sort slots, captions, primary path and all photo state', async () => {
  const state = await get(pets[5]), pet = await petRow(pets[5]);
  await db.exec(`create function public.fail_photo_review_audit_fixture() returns trigger language plpgsql as $$
    begin raise exception 'AUDIT_FIXTURE_FAILURE'; end; $$;
    create trigger fail_photo_review_audit_fixture before insert on public.pet_photo_review_audit
    for each row execute function public.fail_photo_review_audit_fixture();`);
  try {
    await assert.rejects(save(state, [{ photoId: state.photos[2].photoId, caption: '실패해야 함' }]), /AUDIT_FIXTURE_FAILURE/);
    assert.deepEqual(await get(pets[5]), state);
    assert.deepEqual(await petRow(pets[5]), pet);
    assert.equal((await audit(pets[5])).length, 0);
  } finally {
    await db.exec('drop trigger fail_photo_review_audit_fixture on public.pet_photo_review_audit; drop function public.fail_photo_review_audit_fixture();');
  }
});

test('all 16 unique slots can be reversed; inactive results use stable photo ID order', async () => {
  let state = await get(pets[7]);
  const reversed = selection(state).reverse();
  state = await save(state, reversed);
  assert.deepEqual(state.photos.map(photo => photo.photoId), reversed.map(photo => photo.photoId));
  assert.deepEqual(state.photos.map(photo => photo.sortOrder), Array.from({ length: 16 }, (_, i) => i));
  state = await save(state, selection(state).slice(0, 1));
  assert.deepEqual(state.photos.slice(1).map(photo => photo.photoId), state.photos.slice(1).map(photo => photo.photoId).sort());
  assert.ok(state.photos.slice(1).every(photo => !photo.isActive && photo.sortOrder === null));
});

test('pending/paused edits preserve status; rejected/deleted/unknown pets cannot be reviewed', async () => {
  for (const index of [8, 9]) {
    const state = await get(pets[index]), status = (await petRow(pets[index])).status;
    await save(state, selection(state).reverse());
    assert.equal((await petRow(pets[index])).status, status);
  }
  for (const pet of [pets[10], pets[11], randomUUID(), null]) {
    await assert.rejects(get(pet), /PHOTO_REVIEW_NOT_ALLOWED/);
    await assert.rejects(rpc('save_pet_photo_review', pet, '0'.repeat(64), JSON.stringify(selection(await get(pets[6]))), 'creator'), /PHOTO_REVIEW_NOT_ALLOWED/);
  }
});

test('new v4 multi-photo registration can be reviewed and retried without restoring excluded photos or rewarding twice', async () => {
  const petId = randomUUID(), submissionId = randomUUID(), owner = `register-${randomUUID()}`;
  const paths = Array.from({ length: 5 }, (_, index) => `${owner}/${submissionId}/${petId}/${index}.jpg`);
  for (const path of paths) await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
  const submit = () => db.query(`select * from public.register_pet_submission_v4(
    $1,$2,$3,$4,'친구',$5,$6,current_date,1000,1000,'owner',$7)`,
  [owner, submissionId, petId, paths, JSON.stringify(traits), JSON.stringify(style), JSON.stringify(accessory)]);
  const first = await submit();
  assert.equal(first.rows[0].pet_id, petId);
  let state = await get(petId);
  assert.equal(state.photos.length, 5);
  assert.deepEqual(state.photos.map(photo => photo.storagePath), paths);
  const kept = [state.photos[4], state.photos[1]].map(({ photoId }) => ({ photoId, caption: '등록 후 검수' }));
  state = await save(state, kept);
  const reviewedPet = await petRow(petId);
  const retried = await submit();
  assert.deepEqual(retried.rows, first.rows);
  assert.deepEqual(await get(petId), state);
  assert.deepEqual(await petRow(petId), reviewedPet);
  assert.equal(reviewedPet.status, 'pending');
  assert.equal(reviewedPet.storage_path, paths[4]);
  assert.equal((await db.query('select count(*)::int n from public.upload_rewards where pet_id=$1', [petId])).rows[0].n, 1);
  assert.equal((await audit(petId)).length, 1);
});

test('only service role executes RPCs or reads audit; direct audit writes are not granted', async () => {
  for (const role of ['anon', 'authenticated']) {
    const privileges = (await db.query(`select
      has_function_privilege($1,'public.get_pet_photo_review(uuid)','EXECUTE') read,
      has_function_privilege($1,'public.save_pet_photo_review(uuid,text,jsonb,text)','EXECUTE') save,
      has_table_privilege($1,'public.pet_photo_review_audit','SELECT') audit`, [role])).rows[0];
    assert.deepEqual(privileges, { read: false, save: false, audit: false });
    await db.exec(`set role ${role}`);
    try { await assert.rejects(get(pets[6]), /permission denied/); }
    finally { await db.exec('reset role'); }
  }
  assert.deepEqual((await db.query(`select
    has_function_privilege('service_role','public.get_pet_photo_review(uuid)','EXECUTE') read,
    has_function_privilege('service_role','public.save_pet_photo_review(uuid,text,jsonb,text)','EXECUTE') save,
    has_table_privilege('service_role','public.pet_photo_review_audit','SELECT') audit,
    has_table_privilege('service_role','public.pet_photo_review_audit','INSERT') insert,
    has_table_privilege('service_role','public.pet_photo_review_audit','UPDATE') update,
    has_table_privilege('service_role','public.pet_photo_review_audit','DELETE') delete`)).rows[0],
  { read: true, save: true, audit: true, insert: false, update: false, delete: false });
  await db.exec('set role service_role');
  try {
    const state = await get(pets[6]);
    const saved = await save(state, selection(state).reverse());
    assert.notEqual(saved.revision, state.revision);
    assert.equal((await audit(pets[6])).length, 1);
  } finally { await db.exec('reset role'); }
});
