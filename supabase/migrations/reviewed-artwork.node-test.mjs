import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const petId = '11111111-1111-4111-8111-111111111111';
const path = `${petId}/22222222-2222-4222-8222-222222222222.png`;
const image = { path, sha256: 'a'.repeat(64), width: 1080, height: 936 };
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,created_at timestamptz default now());
    create type public.pet_status as enum('pending','approved','paused','rejected');
    create table public.pets(id uuid primary key,name text,status public.pet_status,submitted_traits jsonb,submitted_style jsonb,traits jsonb,published_style jsonb,published_accessory jsonb,design_version integer default 1,reviewed_at timestamptz,review_note text);
    create table public.admin_audit_logs(pet_id uuid,actor text,action text,detail jsonb);
    create function public.review_pet_submission_v5(p_pet_id uuid,p_decision text,p_actor text,p_reason text,p_final_name text,p_final_traits jsonb,p_final_style jsonb,p_published_accessory jsonb,p_review_note text)
    returns public.pet_status language plpgsql as $$ begin
      update public.pets set status=p_decision::public.pet_status,name=p_final_name,traits=p_final_traits,design_version=design_version+1 where id=p_pet_id;
      insert into public.admin_audit_logs values(p_pet_id,p_actor,'review_approved','{}');
      return p_decision::public.pet_status;
    end $$;
    create function public.manage_pet_publication_v3(p_pet_id uuid,p_action text,p_actor text,p_final_traits jsonb,p_final_style jsonb,p_published_accessory jsonb,p_review_note text)
    returns public.pet_status language plpgsql as $$ begin
      update public.pets set status=case when p_action='pause' then 'paused'::public.pet_status else 'approved'::public.pet_status end,design_version=design_version+1 where id=p_pet_id;
      return (select status from public.pets where id=p_pet_id);
    end $$;`);
  await db.exec(await readFile(new URL('./20260906000100_reviewed_artwork_snapshots.sql', import.meta.url), 'utf8'));
  await db.query("insert into public.pets(id,name,status) values($1,'친구','pending')", [petId]);
  await db.exec(await readFile(new URL('./20260906000200_reviewed_artwork_publication_guard.sql', import.meta.url), 'utf8'));
});
after(() => db.close());
const approve = (artwork, version = 1) => db.query('select public.review_pet_submission_with_artwork($1,\'approved\',\'test\',null,\'친구\',\'{}\',\'{}\',null,null,$2::jsonb,$3)', [petId, JSON.stringify(artwork), version]);
test('missing artwork rolls the approval and audit back together', async () => {
  await assert.rejects(() => approve(image), /REVIEW_ARTWORK_MISSING/);
  assert.equal((await db.query('select status from public.pets')).rows[0].status, 'pending');
  assert.equal((await db.query('select count(*)::int n from public.admin_audit_logs')).rows[0].n, 0);
});
test('missing image or stale design cannot approve even with an uploaded image', async () => {
  await db.query("insert into storage.objects(bucket_id,name) values('pet-artwork',$1)", [path]);
  await assert.rejects(() => approve(null), /REVIEW_ARTWORK_REQUIRED/);
  await assert.rejects(() => approve(image, 3), /REVIEW_DESIGN_CHANGED/);
});
test('success stores image identity, pixels metadata, and approval in one transaction', async () => {
  await approve(image);
  const pet = (await db.query('select * from public.pets')).rows[0];
  assert.equal(pet.status, 'approved');
  assert.equal(pet.reviewed_artwork.path, path);
  assert.equal(pet.reviewed_artwork.sha256, image.sha256);
  assert.equal(pet.reviewed_artwork.designVersion, pet.design_version);
  assert.equal((await db.query('select count(*)::int n from public.admin_audit_logs')).rows[0].n, 2);
});
test('failed revision preserves the previously approved image', async () => {
  await assert.rejects(() => db.query("select public.manage_pet_publication_with_artwork($1,'revise','test','{}','{}',null,'수정',$2::jsonb,2)", [petId, JSON.stringify({ ...image, path: `${petId}/33333333-3333-4333-8333-333333333333.png` })]), /REVIEW_ARTWORK_MISSING/);
  const pet = (await db.query('select * from public.pets')).rows[0];
  assert.equal(pet.design_version, 2);
  assert.equal(pet.reviewed_artwork.path, path);
});
test('snapshot mutators remain service-only and the bucket stays private', async () => {
  const rows = (await db.query("select has_function_privilege('anon','public.review_pet_submission_with_artwork(uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,integer)','execute') allowed, has_function_privilege('service_role','public.attach_reviewed_pet_artwork(uuid,text,jsonb)','execute') direct_attach")).rows;
  assert.equal(rows[0].allowed, false);
  assert.equal(rows[0].direct_attach, false);
  assert.equal((await db.query("select public from storage.buckets where id='pet-artwork'")).rows[0].public, false);
});

test('legacy RPC and direct SQL cannot commit an approval without a matching saved picture', async () => {
  const pendingId = '44444444-4444-4444-8444-444444444444';
  await db.query("insert into public.pets(id,name,status) values($1,'대기','pending')", [pendingId]);
  await assert.rejects(() => db.query("select public.review_pet_submission_v5($1,'approved','test',null,'대기','{}','{}',null,null)", [pendingId]), /REVIEW_ARTWORK_REQUIRED/);
  await assert.rejects(() => db.query("update public.pets set status='approved' where id=$1", [pendingId]), /REVIEW_ARTWORK_REQUIRED/);
  await assert.rejects(() => db.query("update public.pets set traits='{\"different\":true}' where id=$1", [petId]), /REVIEW_ARTWORK_REQUIRED/);
  await assert.rejects(() => db.query('update public.pets set reviewed_artwork=null where id=$1', [petId]), /REVIEW_ARTWORK_REQUIRED/);
  assert.equal((await db.query('select status from public.pets where id=$1', [pendingId])).rows[0].status, 'pending');
  const privilege = await db.query("select has_function_privilege('service_role','public.review_pet_submission_v5(uuid,text,text,text,text,jsonb,jsonb,jsonb,text)','execute') allowed");
  assert.equal(privilege.rows[0].allowed, false);
});

test('orphan inventory never includes current, audit-linked, or fresh uploads and never deletes files', async () => {
  await db.query("update storage.objects set created_at=now()-interval '2 days' where name=$1", [path]);
  for (const name of ['failed.png', 'historical.png']) {
    await db.query("insert into storage.objects values('pet-artwork',$1,now()-interval '2 days')", [name]);
  }
  await db.query("insert into storage.objects(bucket_id,name) values('pet-artwork','in-flight.png')");
  await db.query("insert into public.admin_audit_logs values($1,'test','review_artwork_saved','{\"after\":{\"path\":\"historical.png\"}}')", [petId]);
  assert.deepEqual((await db.query('select storage_path from public.unlinked_reviewed_artwork_candidates')).rows, [{ storage_path: 'failed.png' }]);
  assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n, 4);
});
