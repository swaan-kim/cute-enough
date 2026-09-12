// Real local PostgreSQL via PGlite; production is never contacted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { after,before,test } from 'node:test';
const moduleUrl=process.env.PGLITE_MODULE_PATH?pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href:import.meta.resolve('@electric-sql/pglite');
const {PGlite}=await import(moduleUrl),{pgcrypto}=await import(new URL('./contrib/pgcrypto.js',moduleUrl).href);
const db=new PGlite({extensions:{pgcrypto}}),dir=dirname(fileURLToPath(import.meta.url));
const migration='20260905000700_daily_photo_collection.sql';
const owner=()=>`collection-${randomUUID()}`;
const pets=Array.from({length:8},()=>randomUUID()),historical=owner();
const rpc=async(name,...args)=>(await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args)).rows[0].result;
const today=async()=>(await db.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as date")).rows[0].date;
const chosen=async viewer=>(await rpc('get_pet_house_snapshot_v2',viewer,await today())).dailyPets[0].id;
const photos=async pet=>(await db.query('select id from public.pet_photos where pet_id=$1 and is_active order by sort_order,id',[pet])).rows.map(row=>row.id);
const collect=async(viewer,pet,request=randomUUID(),method='FREE',ad=null,photo=null)=>{
  const prepared=photo??(await rpc('prepare_pet_photo_unlock',viewer,pet,request,method,ad)).photoId;
  return rpc('record_pet_photo_unlock',viewer,await today(),pet,prepared,method,request,ad);
};
const replay=async(viewer,pet,request=randomUUID())=>{
  const selected=await rpc('prepare_pet_photo_replay',viewer,pet,request);
  return rpc('record_pet_photo_replay',viewer,pet,request,selected.photoId);
};
const balance=async viewer=>(await db.query('select * from public.get_pet_free_allowance($1)',[viewer])).rows[0];
const setAllowance=async(viewer,remaining=0)=>db.query(`insert into public.pet_free_allowances(owner_hash,balance,last_refill_at)
  values($1,$2,clock_timestamp()) on conflict(owner_hash) do update
  set balance=excluded.balance,last_refill_at=excluded.last_refill_at`,[viewer,remaining]);
const rewardMutationSnapshot=async viewers=>(await db.query(`select jsonb_build_object(
  'allowances',(select coalesce(jsonb_agg(jsonb_build_object('owner',owner_hash,'balance',balance,'refill',last_refill_at) order by owner_hash),'[]') from public.pet_free_allowances where owner_hash=any($1::text[])),
  'bonus',(select coalesce(jsonb_agg(to_jsonb(b) order by owner_hash),'[]') from public.pet_bonus_accounts b where owner_hash=any($1::text[])),
  'sessions',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.pet_ad_reward_sessions s where owner_hash=any($1::text[])),
  'grants',(select coalesce(jsonb_agg(to_jsonb(g) order by photo_id),'[]') from public.user_photo_unlocks g where owner_hash=any($1::text[])),
  'reveals',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.daily_reveals r where owner_hash=any($1::text[])),
  'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by request_id),'[]') from public.pet_photo_reveal_requests r where owner_hash=any($1::text[])),
  'collections',(select coalesce(jsonb_agg(to_jsonb(c) order by pet_id,collection_date),'[]') from public.pet_daily_photo_collections c where owner_hash=any($1::text[]))
) as snapshot`,[viewers])).rows[0].snapshot;
const collection=(viewer,pet)=>rpc('get_pet_photo_collection',viewer,pet);
const addPet=async(pet,status='approved',reviewed="now()-interval '2 days'")=>{
  const path=`collection/${pet}/0.jpg`;
  await db.query(`insert into public.pets(id,owner_hash,name,storage_path,traits,status,created_at,reviewed_at)
    values($1,'fixture-owner','친구',$2,'{}',$3,now()-interval '2 days',${reviewed})`,[pet,path,status]);
  await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)",[path]);
  for(let index=1;index<3;index++){
    const next=`collection/${pet}/${index}.jpg`;
    await db.query('insert into public.pet_photos(pet_id,storage_path,sort_order) values($1,$2,$3)',[pet,next,index]);
    await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)",[next]);
  }
};
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,primary key(bucket_id,name));`);
  const files=(await readdir(dir)).filter(name=>/^\d+.*\.sql$/.test(name)&&name<migration)
    .filter(name=>!['20260829000100_fix_wooyoo_white_traits.sql','20260905000400_recharge_notifications.sql'].includes(name)).sort();
  for(const file of files)await db.exec(await readFile(resolve(dir,file),'utf8'));
  for(const pet of pets)await addPet(pet);
  const oldPhotos=await photos(pets[0]);
  for(const[index,id]of oldPhotos.entries())await db.query(`insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source,unlocked_at)
    values($1,$2,$3,$4,clock_timestamp()-make_interval(secs=>$5))`,[historical,id,pets[0],index===0?'legacy_gift':'reveal',3-index]);
  await db.exec(await readFile(resolve(dir,migration),'utf8'));
  await db.exec('update public.pet_reward_settings set ads_enabled=true,share_enabled=true');
},{timeout:120000});
after(async()=>db.close());

test('007 executes; existing multi-photo grants survive and latest non-gift is today representative',async()=>{
  const state=await collection(historical,pets[0]);
  assert.deepEqual(state,{collectedCount:3,totalCount:3,collectedToday:true,canCollectToday:false,todayPhotoId:(await photos(pets[0]))[2]});
  assert.equal((await db.query('select count(*)::int as n from public.user_photo_unlocks where owner_hash=$1',[historical])).rows[0].n,3);
  const grants=await db.query(`select has_table_privilege('anon','public.pet_daily_photo_collections','SELECT') as public,
    has_function_privilege('service_role','public.record_pet_photo_unlock_album_v1(text,date,uuid,uuid,text,uuid,uuid)','EXECUTE') as bypass,
    has_function_privilege('service_role','public.record_pet_photo_unlock(text,date,uuid,uuid,text,uuid,uuid)','EXECUTE') as current`);
  assert.deepEqual(grants.rows[0],{public:false,bypass:false,current:true});
});
test('caption accepts 30 plain Unicode characters and rejects HTML/control/zero-width/over-limit text',async()=>{
  const id=(await photos(pets[1]))[0];
  await db.query('update public.pet_photos set caption=$1 where id=$2',['가'.repeat(30),id]);
  for(const caption of ['가'.repeat(31),'<img src=x>',"hello\nworld",'안\u200B녕'])
    await assert.rejects(db.query('update public.pet_photos set caption=$1 where id=$2',[caption,id]),/pet_photos_caption_plain_text_check/);
  await db.query('update public.pet_photos set caption=null where id=$1',[id]);
});
test('legacy album v1 names cannot collect a second photo today, even with a different request ID',async()=>{
  const viewer=owner(),pet=await chosen(viewer),a=await collect(viewer,pet),b=await collect(viewer,pet);
  assert.equal(b.photoId,a.photoId);assert.equal(b.alreadyRevealed,true);
  assert.equal((await balance(viewer)).free_remaining,1);
  assert.deepEqual(await collection(viewer,pet),{collectedCount:1,totalCount:3,collectedToday:true,canCollectToday:false,todayPhotoId:a.photoId});
  const summary=(await rpc('get_pet_album_state',viewer,[pet]))[0];assert.equal(summary.collection.collectedToday,true);
});
test('concurrent distinct request IDs debit once and return the same collected photo',async()=>{
  const viewer=owner(),pet=await chosen(viewer),a=randomUUID(),b=randomUUID();
  const first=await rpc('prepare_pet_photo_unlock',viewer,pet,a,'FREE',null),second=await rpc('prepare_pet_photo_unlock',viewer,pet,b,'FREE',null);
  const result=await Promise.all([collect(viewer,pet,a,'FREE',null,first.photoId),collect(viewer,pet,b,'FREE',null,second.photoId)]);
  assert.equal(result[0].photoId,result[1].photoId);assert.equal((await balance(viewer)).free_remaining,1);
  assert.equal((await db.query('select count(*)::int as n from public.pet_daily_photo_collections where owner_hash=$1',[viewer])).rows[0].n,1);
});
test('legacy gifts do not use today collection; ordinary new photo is selected by stable sort order',async()=>{
  const viewer=owner(),pet=await chosen(viewer),ids=await photos(pet);
  await rpc('ensure_pet_album_adopted',viewer);
  await db.query("insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source) values($1,$2,$3,'legacy_gift')",[viewer,ids[0],pet]);
  assert.equal((await collection(viewer,pet)).canCollectToday,true);
  const result=await collect(viewer,pet);assert.equal(result.photoId,ids[1]);
  assert.equal((await collection(viewer,pet)).collectedCount,2);
});
test('free replay of gifts never calls paid consumption or creates daily collection',async()=>{
  const viewer=owner(),pet=await chosen(viewer),ids=await photos(pet);await rpc('ensure_pet_album_adopted',viewer);
  await db.query("insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source) values($1,$2,$3,'legacy_gift')",[viewer,ids[0],pet]);
  const a=await replay(viewer,pet),b=await replay(viewer,pet);
  assert.equal(a.photoId,b.photoId);assert.equal(a.alreadyRevealed,true);
  assert.equal((await balance(viewer)).free_remaining,2);assert.equal((await collection(viewer,pet)).collectedToday,false);
  assert.equal((await db.query('select count(*)::int as n from public.daily_reveals where owner_hash=$1',[viewer])).rows[0].n,0);
});
test('completed collection rotates on every new request while retries retain the original photo',async()=>{
  const viewer=owner(),pet=await chosen(viewer),ids=await photos(pet);await rpc('ensure_pet_album_adopted',viewer);
  for(const id of ids)await db.query("insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source) values($1,$2,$3,'legacy_gift')",[viewer,id,pet]);
  const request=randomUUID(),first=await replay(viewer,pet,request);assert.equal(first.photoId,ids[0]);
  const next=await replay(viewer,pet);assert.equal(next.photoId,ids[1]);
  assert.equal((await replay(viewer,pet,request)).photoId,ids[0]);
  assert.equal((await replay(viewer,pet)).photoId,ids[2]);
  assert.equal((await replay(viewer,pet)).photoId,ids[0]);
  assert.equal((await balance(viewer)).free_remaining,2);
});
test('partial collection free replay retains last unlocked photo rather than rotating or exposing unseen photo',async()=>{
  const viewer=owner(),pet=await chosen(viewer),ids=await photos(pet);await rpc('ensure_pet_album_adopted',viewer);
  for(const[index,id]of ids.slice(0,2).entries())await db.query("insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source,unlocked_at) values($1,$2,$3,'legacy_gift',now()-make_interval(secs=>$4))",[viewer,id,pet,2-index]);
  assert.equal((await replay(viewer,pet)).photoId,ids[1]);assert.equal((await replay(viewer,pet)).photoId,ids[1]);
  assert.equal((await balance(viewer)).free_remaining,2);
});
test('next day collection permits one additional photo without refilling tickets at midnight',async()=>{
  const viewer=owner(),pet=await chosen(viewer),first=await collect(viewer,pet);
  await db.query('update public.pet_daily_photo_collections set collection_date=collection_date-1 where owner_hash=$1',[viewer]);
  assert.equal((await collection(viewer,pet)).canCollectToday,true);
  const second=await collect(viewer,pet);assert.notEqual(second.photoId,first.photoId);
  assert.equal((await balance(viewer)).free_remaining,0);assert.equal((await replay(viewer,pet)).photoId,second.photoId);
});
test('approved first share remains allowed but already-collected friend outside house cannot collect on another day',async()=>{
  const viewer=owner(),pet=randomUUID();await addPet(pet,'approved','now()');
  const first=await collect(viewer,pet);assert.equal(first.dailyProgress.metCount,0);
  assert.equal((await collect(viewer,pet)).photoId,first.photoId);
  await db.query('update public.pet_daily_photo_collections set collection_date=collection_date-1 where owner_hash=$1',[viewer]);
  await assert.rejects(collect(viewer,pet),/ALBUM_PET_NOT_TODAY/);
  assert.equal((await collection(viewer,pet)).canCollectToday,false);
  assert.equal((await replay(viewer,pet)).photoId,first.photoId);
});
test('withdrawal does not restore collection; replay only falls back to an existing grant',async()=>{
  const viewer=owner(),pet=await chosen(viewer),ids=await photos(pet);await rpc('ensure_pet_album_adopted',viewer);
  await db.query("insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source) values($1,$2,$3,'legacy_gift')",[viewer,ids[0],pet]);
  const first=await collect(viewer,pet);assert.equal(first.photoId,ids[1]);
  await db.query('update public.pet_photos set is_active=false where id=$1',[ids[1]]);
  try{
    const state=await collection(viewer,pet);assert.equal(state.collectedToday,true);assert.equal(state.canCollectToday,false);assert.equal(state.todayPhotoId,null);
    assert.equal((await replay(viewer,pet)).photoId,ids[0]);assert.equal((await collect(viewer,pet)).photoId,ids[0]);
    assert.equal((await balance(viewer)).free_remaining,1);
  }finally{await db.query('update public.pet_photos set is_active=true where id=$1',[ids[1]]);}
});
test('replay cannot view other users, owners, pending pets or never-unlocked photos',async()=>{
  const viewer=owner(),pet=await chosen(viewer);await collect(viewer,pet);
  await assert.rejects(replay(owner(),pet),/ALBUM_PHOTO_UNAVAILABLE/);
  await assert.rejects(replay('fixture-owner',pet),/ALBUM_PHOTO_UNAVAILABLE/);
  const pending=randomUUID();await addPet(pending,'pending');
  await assert.rejects(replay(viewer,pending),/ALBUM_PHOTO_UNAVAILABLE/);
  assert.equal((await balance(viewer)).free_remaining,1);
});
test('earned ad credit is not spent by same-day repeated collect; new ad start is blocked',async()=>{
  const viewer=owner(),pet=await chosen(viewer);const first=await collect(viewer,pet);
  const ad=randomUUID();await db.query(`insert into public.pet_ad_reward_sessions(id,owner_hash,pet_id,original_pet_id,
    started_date,expires_at,status,completed_at) values($1,$2,$3,$3,(now() at time zone 'Asia/Seoul')::date,now()+interval '10 minutes','completed',now())`,[ad,viewer,pet]);
  const repeated=await collect(viewer,pet,randomUUID(),'REWARDED',ad);assert.equal(repeated.photoId,first.photoId);
  assert.equal((await db.query('select status from public.pet_ad_reward_sessions where id=$1',[ad])).rows[0].status,'completed');
  await assert.rejects(rpc('start_pet_album_ad_reward',viewer,randomUUID(),pet),/DAILY_PHOTO_ALREADY_COLLECTED/);
  await db.query('update public.pet_daily_photo_collections set collection_date=collection_date-1 where owner_hash=$1',[viewer]);
  const next=await collect(viewer,pet);assert.equal(next.unlockMethod,'REWARDED');assert.equal((await balance(viewer)).free_remaining,1);
});
for(const requestedMethod of ['REWARDED','FREE'])test(`DB ads disabled: earned credit funds ${requestedMethod} album request exactly once without spending tickets`,async()=>{
  const viewer=owner(),pet=await chosen(viewer),ad=randomUUID(),request=randomUUID();
  await setAllowance(viewer);
  // Earn through the real album start/completion RPCs before switching off new ads.
  await rpc('start_pet_album_ad_reward',viewer,ad,pet);
  await rpc('complete_pet_ad_reward',viewer,ad);
  await setAllowance(viewer,1);
  await db.query('insert into public.pet_bonus_accounts(owner_hash,balance) values($1,2)',[viewer]);
  const earned=await rewardMutationSnapshot([viewer]);
  assert.equal(earned.sessions[0].status,'completed');
  await db.exec('update public.pet_reward_settings set ads_enabled=false');
  try{
    const requestedAd=requestedMethod==='REWARDED'?ad:null;
    const first=await collect(viewer,pet,request,requestedMethod,requestedAd);
    assert.equal(first.unlockMethod,'REWARDED');assert.equal(first.adSessionId,ad);
    assert.equal(first.freeRemaining,1);assert.equal(first.bonusTickets,2);
    const spent=await rewardMutationSnapshot([viewer]);
    assert.deepEqual(spent.allowances,earned.allowances);assert.deepEqual(spent.bonus,earned.bonus);
    assert.equal(spent.sessions.length,1);assert.equal(spent.sessions[0].status,'consumed');
    assert.equal(spent.sessions[0].completed_at,earned.sessions[0].completed_at);
    assert.ok(spent.sessions[0].consumed_at);
    for(const key of ['grants','reveals','requests','collections'])assert.equal(spent[key].length,1,key);
    const repeated=await collect(viewer,pet,request,requestedMethod,requestedAd);
    assert.equal(repeated.photoId,first.photoId);assert.equal(repeated.reusedRequest,true);
    assert.deepEqual(await rewardMutationSnapshot([viewer]),spent);
    const recovered=await rpc('complete_pet_ad_reward',viewer,ad);
    assert.equal(recovered.adsEnabled,false);assert.equal(recovered.adsCompletedToday,1);
    assert.equal(recovered.adRewards.length,0);
    assert.deepEqual(await rewardMutationSnapshot([viewer]),spent,'completion retry must not resurrect consumed credit');
    const freshPet=pets.find(id=>id!==pet),freshSession=randomUUID();
    await assert.rejects(rpc('start_pet_album_ad_reward',viewer,freshSession,freshPet),/ADS_DISABLED/);
    assert.deepEqual(await rewardMutationSnapshot([viewer]),spent,'kill switch must still block a fresh session');
  }finally{await db.exec('update public.pet_reward_settings set ads_enabled=true');}
});

for(const invalidCredit of ['wrong owner','wrong pet','missing','started','cancelled'])test(`DB ads disabled: ${invalidCredit} credit cannot grant an album photo or mutate balances`,async()=>{
  const viewer=owner(),pet=await chosen(viewer),ad=randomUUID(),creditOwner=invalidCredit==='wrong owner'?owner():viewer;
  const creditPet=invalidCredit==='wrong pet'?pets.find(id=>id!==pet):pet;
  await setAllowance(viewer);
  await rpc('ensure_pet_album_adopted',viewer);
  if(invalidCredit!=='missing'){
    if(creditOwner!==viewer)await setAllowance(creditOwner);
    await rpc('start_pet_album_ad_reward',creditOwner,ad,creditPet);
    if(['wrong owner','wrong pet'].includes(invalidCredit))await rpc('complete_pet_ad_reward',creditOwner,ad);
    if(invalidCredit==='cancelled')await rpc('cancel_pet_ad_reward',creditOwner,ad);
  }
  // Even available tickets must not mask an invalid explicitly requested credit.
  await setAllowance(viewer,1);
  await db.query('insert into public.pet_bonus_accounts(owner_hash,balance) values($1,2)',[viewer]);
  const viewers=[...new Set([viewer,creditOwner])],beforeAttempt=await rewardMutationSnapshot(viewers);
  await db.exec('update public.pet_reward_settings set ads_enabled=false');
  try{
    await assert.rejects(collect(viewer,pet,randomUUID(),'REWARDED',ad),/AD_REWARD_UNAVAILABLE/);
    assert.deepEqual(await rewardMutationSnapshot(viewers),beforeAttempt);
    assert.equal((await collection(viewer,pet)).collectedCount,0);
    await assert.rejects(rpc('start_pet_album_ad_reward',viewer,randomUUID(),pet),/ADS_DISABLED/);
    assert.deepEqual(await rewardMutationSnapshot(viewers),beforeAttempt);
  }finally{await db.exec('update public.pet_reward_settings set ads_enabled=true');}
});

test('captions belong to the exact authorized image including prepared collection and replay',async()=>{
  const viewer=owner(),pet=await chosen(viewer),ids=await photos(pet);
  await db.query('update public.pet_photos set caption=$1 where id=$2',['산책이 좋아요',ids[0]]);
  try{
    assert.equal((await rpc('prepare_pet_photo_unlock',viewer,pet,randomUUID(),'FREE',null)).photoCaption,'산책이 좋아요');
    await collect(viewer,pet);
    assert.equal((await rpc('authorize_pet_album_photo',viewer,ids[0])).photoCaption,'산책이 좋아요');
    assert.equal((await rpc('prepare_pet_photo_replay',viewer,pet,randomUUID())).photoCaption,'산책이 좋아요');
  }finally{await db.query('update public.pet_photos set caption=null where id=$1',[ids[0]]);}
});
test('progress failure rolls back collection cap, grant and debit atomically',async()=>{
  const viewer=owner(),pet=await chosen(viewer);
  await db.exec(`create function public.collection_test_fail() returns trigger language plpgsql as $$begin
    if new.owner_hash='${viewer}' then raise exception 'TEST_PROGRESS_FAILURE';end if;return new;end;$$;
    create trigger collection_test_fail before update on public.daily_house_assignments for each row execute function public.collection_test_fail();`);
  try{await assert.rejects(collect(viewer,pet),/TEST_PROGRESS_FAILURE/);assert.equal((await balance(viewer)).free_remaining,2);
    assert.equal((await collection(viewer,pet)).collectedToday,false);assert.equal((await collection(viewer,pet)).collectedCount,0);
  }finally{await db.exec('drop trigger collection_test_fail on public.daily_house_assignments;drop function public.collection_test_fail();');}
});
