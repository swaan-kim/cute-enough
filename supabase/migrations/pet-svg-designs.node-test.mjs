import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { validatePetDesign, canonicalPetDesign, hashPetDesign } from '../functions/_shared/pet-design.ts';

const db = new PGlite();
const petId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const traits = { schemaVersion: 1, earShape: 'upright', headShape: 'round', baseColor: 'white', secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 0.4 };
const style = { schemaVersion: 1, coatMode: 'solid', furStyle: 'fluffy' };
const requested = { kind: 'ball', color: 'yellow' };
const document = validatePetDesign({ schemaVersion: 1, motionVersion: 1, viewBox: [0,0,180,156], nodes: [
  { tag: 'defs', children: [{ tag: 'mask', attrs: { id: 'face' }, children: [{ tag: 'rect', attrs: { width: 180, height: 156, fill: '#fff' } }] }] },
  { tag: 'g', attrs: { mask: 'url(#face)', 'data-custom-head': true }, children: [
    { tag: 'path', attrs: { d: 'M1 2L3 4', fill: '#eeddaa' } },
    { tag: 'g', motion: 'tongue', children: [{ tag: 'ellipse', attrs: { cx: 20, cy: 32, rx: 4, ry: 5, fill: '#ffaaaa' } }] },
  ] },
  { tag: 'g', motion: 'tail', children: [{ tag: 'path', attrs: { d: 'M8 9Q10 11 12 13', stroke: '#fff' } }] },
] });
const editor = { finalTraits: traits, finalStyle: style, publishedAccessory: null, editor: {
  schemaVersion: 1, document, baseDocument: document, input: { traits,style }, customParts: ['triangle-cheese'],
} };

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.objects(bucket_id text,name text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create type public.pet_status as enum('pending','approved','paused','rejected');
    create table public.pets(id uuid primary key,name text,status public.pet_status,submitted_traits jsonb,submitted_style jsonb,traits jsonb,
      published_style jsonb,published_accessory jsonb,design_version integer not null default 1,reviewed_at timestamptz,review_note text,
      reviewed_artwork jsonb,accessory_selection_mode text default 'owner',requested_accessory jsonb,owner_pinned_pending boolean default false,rejection_reason text);
    create table public.pet_photos(pet_id uuid,storage_path text,is_active boolean default true);
    create table public.admin_audit_logs(pet_id uuid,actor text,action text,detail jsonb);
    create function public.is_valid_pet_traits_v1(v jsonb) returns boolean language sql immutable as $$select v->'schemaVersion'='1'::jsonb$$;
    create function public.is_valid_pet_style_v1(v jsonb,t jsonb) returns boolean language sql immutable as $$select v->'schemaVersion'='1'::jsonb$$;
    create function public.is_valid_pet_accessory(v jsonb) returns boolean language sql immutable as $$select v->>'kind' in ('ball','scarf','ribbon','vest')$$;
    create function public.pet_design_similarity_score(t jsonb,s jsonb,t2 jsonb,s2 jsonb) returns integer language sql immutable as $$select 90$$;
    create function public.enforce_owner_accessory_immutability() returns trigger language plpgsql as $$begin return new;end$$;
    create trigger enforce_owner_accessory_immutability_on_pets before update of status,accessory_selection_mode,requested_accessory,published_accessory on public.pets
      for each row execute function public.enforce_owner_accessory_immutability();`);
  // Historical approved dogs are deliberately inserted before the migration; it must leave them untouched.
  await db.query("insert into pets(id,name,status,traits,submitted_traits,published_style,submitted_style,requested_accessory,published_accessory) values($1,'치즈','pending',$3,$3,$4,$4,$5,$5),($2,'과거','approved',$3,$3,$4,$4,$5,$5)", [petId,secondId,traits,style,requested]);
  await db.exec(await readFile(new URL('./20260906000100_reviewed_artwork_snapshots.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./20260906000300_pet_svg_designs.sql',import.meta.url),'utf8'));
});
after(() => db.close());
const save = (revision=0,version=1,doc=document,state=editor) => db.query('select save_pet_design_draft($1,\'creator\',$2,$3,$4,$5) result',[petId,doc,state,revision,version]);
const approve = (revision=1,version=1) => db.query("select review_pet_submission_with_design($1,'approved','creator',null,'치즈','확정',$2,$3) result",[petId,revision,version]);

test('migration preserves historical approved appearance and owner requests', async () => {
  const pet=(await db.query('select * from pets where id=$1',[secondId])).rows[0];
  assert.equal(pet.status,'approved'); assert.equal(pet.published_design_id,null);
  assert.deepEqual(pet.published_accessory,requested);
  assert.equal((await db.query('select count(*)::int n from admin_audit_logs')).rows[0].n,0);
});

test('SQL canonical bytes and SHA match the normalized JavaScript document', async () => {
  const {rows}=await db.query('select canonical_pet_design_json($1) canonical,pet_design_sha256($1) hash,is_valid_pet_design_v1($1) valid',[document]);
  assert.equal(rows[0].valid,true); assert.equal(rows[0].canonical,canonicalPetDesign(document));
  assert.equal(rows[0].hash,await hashPetDesign(document));
});

test('unsafe nodes, external references, unresolved masks and unsupported motion cannot save', async () => {
  for(const bad of [
    { ...document,nodes:[{tag:'script'}] },
    { ...document,nodes:[{tag:'g',attrs:{onClick:'evil'}}] },
    { ...document,nodes:[{tag:'g',attrs:{mask:'url(https://bad)'}}] },
    { ...document,nodes:[{tag:'g',attrs:{mask:'url(#d0)'}}] },
    { ...document,nodes:[{tag:'g',motion:'arbitrary'}] },
    { ...document,nodes:[{tag:'path',attrs:{d:'javascript:bad'}}] },
    { ...document,nodes:[{tag:'g',attrs:{transform:'rotate(99999999)'}}] },
    { ...document,viewBox:[0,0,9000,156] },
    { ...document,nodes:[{tag:'circle',attrs:{cx:'1.0',cy:'2',r:'3'}}] },
  ]) await assert.rejects(()=>save(0,1,bad),/INVALID_PET_DESIGN_DOCUMENT/);
  assert.equal((await db.query('select count(*)::int n from pet_design_drafts')).rows[0].n,0);
});

test('draft save changes no published appearance and stale saves cannot overwrite',async()=>{
  const {result}= (await save()).rows[0];
  assert.equal(result.draftRevision,1); assert.equal(result.sha256,await hashPetDesign(document));
  assert.deepEqual(result.editorState,editor);
  await assert.rejects(()=>save(),/REVIEW_DRAFT_CHANGED/);
  await assert.rejects(()=>save(1,2),/REVIEW_DESIGN_CHANGED/);
  const pet=(await db.query('select * from pets where id=$1',[petId])).rows[0];
  assert.equal(pet.status,'pending'); assert.equal(pet.published_design_id,null); assert.deepEqual(pet.requested_accessory,requested);
});

test('private editor must reopen the exact design and safe variant inputs',async()=>{
  for(const invalidEditor of [
    {...editor,editor:{...editor.editor,input:{style}}},
    {...editor,editor:{...editor.editor,input:{traits,style,earVariant:'unknown'}}},
    {...editor,editor:{...editor.editor,input:{traits,style,accessory:requested}}},
  ]) await assert.rejects(()=>save(1,1,document,invalidEditor),/INVALID_PET_DESIGN_EDITOR/);
});

test('missing photo and stale draft approval roll back the whole publication',async()=>{
  await assert.rejects(()=>approve(),/PET_PHOTO_MISSING/);
  await assert.rejects(()=>approve(2),/REVIEW_DRAFT_CHANGED/);
  assert.equal((await db.query('select count(*)::int n from pet_design_versions')).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from admin_audit_logs where action='review_approved'")).rows[0].n,0);
});

test('approval stores exact scene plus identity and permits creator accessories without changing owner intent',async()=>{
  await db.exec("insert into storage.objects values('pet-photos','real-photo')");
  await db.query("insert into pet_photos values($1,'real-photo',true)",[petId]);
  const {result}=(await approve()).rows[0];
  assert.equal(result.status,'approved'); assert.equal(result.designVersion,2);
  assert.deepEqual(result.publishedDesign.document,document);
  assert.equal(result.publishedDesign.sha256,await hashPetDesign(document));
  const pet=(await db.query('select * from pets where id=$1',[petId])).rows[0];
  assert.equal(pet.published_design_id,result.publishedDesign.id); assert.equal(pet.published_accessory,null);
  assert.deepEqual(pet.requested_accessory,requested);
  await assert.rejects(()=>db.query("update pets set requested_accessory=null where id=$1",[petId]),/OWNER_REQUEST_IMMUTABLE/);
});

test('immutable versions, approval bypass and crossed dog pointers are rejected',async()=>{
  await assert.rejects(()=>db.query("update pet_design_versions set document='{}'"),/PET_DESIGN_VERSION_IMMUTABLE/);
  await assert.rejects(()=>db.query('delete from pet_design_versions'),/PET_DESIGN_VERSION_IMMUTABLE/);
  await assert.rejects(()=>db.query("update pets set traits=jsonb_set(traits,'{earShape}','\"floppy\"') where id=$1",[petId]),/REVIEW_DESIGN_REQUIRED/);
  await assert.rejects(()=>db.query('update pets set published_design_id=(select published_design_id from pets where id=$1) where id=$2',[petId,secondId]),/REVIEW_DESIGN_REQUIRED|foreign key/);
  assert.equal((await db.query('select design_version from pets where id=$1',[petId])).rows[0].design_version,2);
});

test('pause keeps scene identity; republish requires freshly saved version and old versions survive',async()=>{
  const old=(await db.query('select published_design_id from pets where id=$1',[petId])).rows[0].published_design_id;
  await db.query("select manage_pet_publication_with_design($1,'pause','creator','일시중지',null,2)",[petId]);
  const paused=(await db.query('select * from pets where id=$1',[petId])).rows[0];
  assert.equal(paused.design_version,2); assert.equal(paused.published_design_id,old);
  await assert.rejects(()=>db.query("select manage_pet_publication_with_design($1,'republish','creator','재공개',1,2)",[petId]),/REVIEW_DESIGN_CHANGED/);
  await save(1,2);
  const {rows}=await db.query("select manage_pet_publication_with_design($1,'republish','creator','재공개',2,2) result",[petId]);
  assert.equal(rows[0].result.designVersion,3);
  assert.equal((await db.query('select count(*)::int n from pet_design_versions')).rows[0].n,2);
});

test('only creator RPCs can mutate and public roles cannot read editor state',async()=>{
  const row=(await db.query(`select has_table_privilege('anon','pet_design_drafts','select') draft_read,
    has_table_privilege('authenticated','pet_design_versions','select') version_read,
    has_table_privilege('service_role','pet_design_versions','insert') direct_insert,
    has_function_privilege('anon','save_pet_design_draft(uuid,text,jsonb,jsonb,integer,integer)','execute') save,
    has_function_privilege('service_role','publish_pet_design_draft(uuid,text,integer,integer)','execute') bypass,
    has_function_privilege('service_role','review_pet_submission_with_design(uuid,text,text,text,text,text,integer,integer)','execute') approve`)).rows[0];
  assert.deepEqual(row,{draft_read:false,version_read:false,direct_insert:false,save:false,bypass:false,approve:true});
});

test('actual exported dog scenes round-trip in local PGlite only with identical SHA and editor state',async(t)=>{
  const directory=new URL('../../.tmp/svg-transition/',import.meta.url);
  let index;
  try {index=JSON.parse(await readFile(new URL('index.json',directory),'utf8'));}
  catch(error){if(error.code==='ENOENT'){t.skip('local read-only export not present');return;}throw error;}
  for(const item of index.items){
    const input=JSON.parse(await readFile(new URL(item.file,directory),'utf8'));
    await db.exec('begin');
    try {
      await db.query("insert into pets(id,name,status,traits,submitted_traits,published_style,submitted_style,design_version) values($1,$2,'pending',$3,$3,$4,$4,$5)",
        [input.petId,item.name,input.editorState.finalTraits,input.editorState.finalStyle,input.expectedDesignVersion]);
      await db.query("insert into storage.objects values('pet-photos',$1)",[`local-only-${input.petId}`]);
      await db.query('insert into pet_photos values($1,$2,true)',[input.petId,`local-only-${input.petId}`]);
      const checked=(await db.query('select is_valid_pet_design_v1($1) valid,pet_design_sha256($1) hash',[input.document])).rows[0];
      assert.equal(checked.valid,true,`${item.name} SQL validation`);assert.equal(checked.hash,item.sha256,`${item.name} canonical hash`);
      const saved=(await db.query("select save_pet_design_draft($1,'local-test',$2,$3,0,$4) result",[input.petId,input.document,input.editorState,input.expectedDesignVersion])).rows[0].result;
      assert.equal(saved.sha256,item.sha256);assert.deepEqual(saved.editorState,input.editorState);
      const approved=(await db.query("select review_pet_submission_with_design($1,'approved','local-test',null,$2,'로컬 테스트',1,$3) result",[input.petId,item.name??'친구',input.expectedDesignVersion])).rows[0].result;
      assert.deepEqual(approved.publishedDesign.document,input.document,`${item.name} roundtrip`);assert.equal(approved.publishedDesign.sha256,item.sha256);
    } finally {await db.exec('rollback');}
  }
  assert.equal(index.items.length,13);
});

test('post-rollout cleanup refuses incomplete conversion, then removes PNG dependencies while preserving photos and audits',async()=>{
  const cleanup=await readFile(new URL('../rollout/retire-png-after-svg.sql',import.meta.url),'utf8');
  await assert.rejects(()=>db.exec(cleanup),/SVG_TRANSITION_INCOMPLETE/);await db.exec('rollback');
  await db.query("insert into storage.objects values('pet-photos','historical-photo')");
  await db.query("insert into pet_photos values($1,'historical-photo',true)",[secondId]);
  await db.query("select save_pet_design_draft($1,'local-test',$2,$3,0,1)",[secondId,document,editor]);
  await db.query("select manage_pet_publication_with_design($1,'revise','local-test','로컬 전환',1,1)",[secondId]);
  await db.exec("insert into storage.objects values('pet-artwork','old.png')");
  await assert.rejects(()=>db.exec(cleanup),/PNG_STORAGE_CLEANUP_PENDING/);await db.exec('rollback');
  await db.exec("delete from storage.objects where bucket_id='pet-artwork'");
  const auditCount=(await db.query('select count(*)::int n from admin_audit_logs')).rows[0].n;
  await db.exec(cleanup);
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='pets' and column_name='reviewed_artwork'")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='pet-photos'")).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from pet_photos')).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from admin_audit_logs')).rows[0].n,auditCount);
  assert.equal((await db.query('select count(*)::int n from pet_design_versions')).rows[0].n,3);
  assert.equal((await db.query("select to_regprocedure('review_pet_submission_with_artwork(uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,integer)') rpc")).rows[0].rpc,null);
});
