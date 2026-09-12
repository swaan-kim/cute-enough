import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const db = new PGlite({ extensions: { pgcrypto } });
const root = new URL('./', import.meta.url);
const migration = '20260906000700_review_photo_additions.sql';
const traits = { schemaVersion: 1, earShape: 'rounded', headShape: 'round', baseColor: 'white', secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 1 };
const rpc = async (name, ...args) => (await db.query(`select public.${name}(${args.map((_, i) => `$${i+1}`).join(',')}) result`, args)).rows[0].result;
const pets = Array.from({ length: 7 }, () => randomUUID());
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),primary key(bucket_id,name));`);
  const files = (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name) && name <= migration
    && !['20260829000100_fix_wooyoo_white_traits.sql','20260905000400_recharge_notifications.sql'].includes(name)).sort();
  for (const name of files.filter((name) => name < '20260906000100')) await db.exec(await readFile(new URL(name, root), 'utf8'));
  for (const [index, pet] of pets.entries()) {
    const path = `fixture/${pet}/primary.jpg`;
    await db.query(`insert into public.pets(id,owner_hash,name,storage_path,status,traits) values($1,$2,'친구',$3,$4,$5)`,
      [pet, `owner-${pet}`, path, index === 6 ? 'pending' : 'approved', JSON.stringify(traits)]);
    await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
  }
  for (const name of files.filter((name) => name >= '20260906000100')) await db.exec(await readFile(new URL(name, root), 'utf8'));
}, { timeout: 120000 });
after(() => db.close());
async function submit(pet, count = 2) {
  const id = randomUUID(), owner = `owner-${pet}`;
  const paths = Array.from({ length: count }, (_, i) => `${owner}/${id}/photo-addition/${pet}/staged/${i}-${randomUUID()}.jpg`);
  for (const path of paths) await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)", [path]);
  await rpc('submit_pet_photo_addition', owner, pet, id, paths, paths.map(() => 'a'.repeat(64)));
  return (await rpc('get_pet_photo_addition_review_queue')).items.find((row) => row.petId === pet);
}
const decide = (batch, decision = 'approved', note = '') => rpc('review_pet_photo_addition', batch.batchId, batch.expectedRevision, decision, note, 'test-creator');
test('approval appends exact sources; preserves original pet/SVG and photos; duplicate decision is idempotent', async () => {
  const pet = pets[0], original = (await db.query('select * from public.pets where id=$1', [pet])).rows[0];
  const beforePhotos = await rpc('get_pet_photo_review', pet), batch = await submit(pet);
  assert.equal(batch.photos.length, 2);
  assert.equal((await rpc('get_pet_photo_review',pet)).photos.length, 1);
  assert.equal((await decide(batch)).status, 'approved');
  await decide(batch);
  const photos = await rpc('get_pet_photo_review', pet);
  assert.equal(photos.photos.length, 3);
  assert.deepEqual(photos.photos[0], beforePhotos.photos[0]);
  assert.deepEqual(photos.photos.slice(1).map((p) => p.storagePath), batch.photos.map((p) => p.storagePath));
  assert.deepEqual((await db.query('select * from public.pets where id=$1', [pet])).rows[0], original);
  assert.equal((await db.query('select count(*)::int n from public.pet_photo_review_audit where pet_id=$1',[pet])).rows[0].n, 1);
  assert.equal((await rpc('get_pet_photo_addition_status',`owner-${pet}`,pet)).submission.status, 'approved');
  await assert.rejects(decide(batch,'rejected','반려'), /ALREADY_REVIEWED/);
});
test('rejection needs reason; preserves private sources, photos and batch history', async () => {
  const batch = await submit(pets[1]);
  await assert.rejects(decide(batch,'rejected'), /INVALID_PHOTO_ADDITION_REVIEW/);
  await decide(batch,'rejected','강아지 사진으로 다시 부탁드려요');
  assert.equal((await rpc('get_pet_photo_review', pets[1])).photos.length,1);
  assert.equal((await db.query('select count(*)::int n from public.pet_photo_addition_items where batch_id=$1',[batch.batchId])).rows[0].n,2);
  assert.equal((await rpc('get_pet_photo_addition_status',`owner-${pets[1]}`,pets[1])).remainingCount,4);
});
test('stale photo revision and missing source cannot approve or partly publish', async () => {
  const batch = await submit(pets[2]);
  await assert.rejects(decide({ ...batch, expectedRevision:'0'.repeat(64) }), /REVIEW_PHOTOS_CHANGED/);
  await db.query("delete from storage.objects where bucket_id='pet-photos' and name=$1",[batch.photos[1].storagePath]);
  await assert.rejects(decide(batch), /PET_PHOTO_MISSING/);
  assert.equal((await rpc('get_pet_photo_review',pets[2])).photos.length,1);
  assert.equal((await rpc('get_pet_photo_addition_status',`owner-${pets[2]}`,pets[2])).submission.status,'pending');
});
test('paused dog cannot gain public photos, rejection still available', async () => {
  const batch = await submit(pets[3]);
  await db.query("update public.pets set status='paused' where id=$1",[pets[3]]);
  await assert.rejects(decide(batch), /PHOTO_REVIEW_NOT_ALLOWED/);
  await decide(batch,'rejected','공개 중지 상태');
});
test('maximum five stays enforced and owner selection/publication is untouched', async () => {
  const batch = await submit(pets[4],4);
  await decide(batch);
  const status = await rpc('get_pet_photo_addition_status',`owner-${pets[4]}`,pets[4]);
  assert.equal(status.activePhotoCount,5); assert.equal(status.canSubmit,false);
});
test('pending dog is not approved by accepting photos; no rewards or unlocks', async () => {
  await decide(await submit(pets[6]));
  assert.equal((await db.query('select status from public.pets where id=$1',[pets[6]])).rows[0].status,'pending');
  for (const table of ['upload_rewards','user_photo_unlocks','pet_daily_photo_collections']) {
    assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
  }
});
test('review RPCs and private tables deny normal app roles', async () => {
  for (const role of ['anon','authenticated']) {
    for (const signature of ['get_pet_photo_addition_review_queue()','review_pet_photo_addition(uuid,text,text,text,text)']) {
      assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') ok',[role,`public.${signature}`])).rows[0].ok,false);
    }
  }
});
