// Execute real PostgreSQL SQL locally with PGlite. No production DB is contacted.
// PGLITE_MODULE_PATH=.../pglite/dist/index.js node --test supabase/migrations/photo-album-and-favorites.node-test.mjs
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
const migration = '20260905000600_photo_album_and_favorites.sql';
const petIds = Array.from({ length: 8 }, () => randomUUID());
const legacyViewer = `legacy-${randomUUID()}`;
const legacyWithdrawnViewer = `legacy-withdrawn-${randomUUID()}`;
const legacyWithdrawnPet = randomUUID();
const owner = () => `album-${randomUUID()}`;
const rpc = async (name, ...args) => {
  assert.match(name, /^[a-z_0-9]+$/);
  return (await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`, args)).rows[0].result;
};
const today = async () => (await db.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
const photoIds = async pet => (await db.query('select id from public.pet_photos where pet_id=$1 and is_active order by sort_order,id', [pet])).rows.map(x=>x.id);
const prepare = (viewer,pet,request=randomUUID(),method='FREE',ad=null) => rpc('prepare_pet_photo_unlock',viewer,pet,request,method,ad);
const unlock = async (viewer,pet,request=randomUUID(),method='FREE',ad=null,photo=null) => {
  const candidate = photo ?? (await prepare(viewer,pet,request,method,ad)).photoId;
  return rpc('record_pet_photo_unlock',viewer,await today(),pet,candidate,method,request,ad);
};
const balance = async viewer => (await rpc('get_pet_reward_state',viewer),
  (await db.query('select * from public.get_pet_free_allowance($1)',[viewer])).rows[0]);
const chosen = async viewer => (await rpc('get_pet_house_snapshot_v2',viewer,await today())).dailyPets[0].id;
const addPet = async (pet, status='approved', reviewed="now()-interval '2 days'") => {
  const path=`fixtures/${pet}/0.jpg`;
  await db.query(`insert into public.pets(id,owner_hash,name,storage_path,status,traits,created_at,reviewed_at)
    values($1,'fixture-owner','친구',$2,$3,'{}',now()-interval '2 days',${reviewed})`,[pet,path,status]);
  await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)",[path]);
  for (let index=1;index<=2;index++) {
    const photoPath=`fixtures/${pet}/${index}.jpg`;
    await db.query('insert into public.pet_photos(pet_id,storage_path,sort_order) values($1,$2,$3)',[pet,photoPath,index]);
    await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)",[photoPath]);
  }
};

before(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,primary key(bucket_id,name));`);
  const files=(await readdir(migrationDirectory)).filter(name=>/^\d+.*\.sql$/.test(name) && name<migration)
    .filter(name=>!['20260829000100_fix_wooyoo_white_traits.sql','20260905000400_recharge_notifications.sql'].includes(name)).sort();
  for(const file of files) {
    try { await db.exec(await readFile(resolve(migrationDirectory,file),'utf8')); }
    catch(error){throw new Error(`Migration ${file}: ${error.message}`,{cause:error});}
  }
  for(const pet of petIds) await addPet(pet);
  await addPet(legacyWithdrawnPet);
  await db.query(`insert into public.daily_reveals(owner_hash,reveal_date,pet_id,unlock_method)
    values($1,(now() at time zone 'Asia/Seoul')::date,$2,'FREE')`,[legacyWithdrawnViewer,legacyWithdrawnPet]);
  for(const pet of petIds.slice(0,4)) {
    await db.query(`insert into public.daily_reveals(owner_hash,reveal_date,pet_id,unlock_method,created_at)
      values($1,(now() at time zone 'Asia/Seoul')::date,$2,'FREE',now()-interval '2 days'),
        ($1,(now() at time zone 'Asia/Seoul')::date,$2,'FREE',now()-interval '1 day')`,[legacyViewer,pet]);
  }
  // Owner history and pending shared history must never become public album gifts.
  await db.query(`insert into public.daily_reveals(owner_hash,reveal_date,pet_id,unlock_method)
    values('fixture-owner',(now() at time zone 'Asia/Seoul')::date,$1,'UPLOAD')`,[petIds[0]]);
  const pending=randomUUID(); await addPet(pending,'pending');
  await db.query(`insert into public.daily_reveals(owner_hash,reveal_date,pet_id,unlock_method)
    values($1,(now() at time zone 'Asia/Seoul')::date,$2,'FREE')`,[legacyViewer,pending]);
  await db.exec(await readFile(resolve(migrationDirectory,migration),'utf8'));
  await db.exec('update public.pet_reward_settings set ads_enabled=true,share_enabled=true');
},{timeout:120000});
after(async()=>db.close());

test('migration applies; direct public access and RPC execution are denied',async()=>{
  const result=await db.query(`select
    has_table_privilege('anon','public.user_photo_unlocks','SELECT') as photos,
    has_table_privilege('authenticated','public.pet_favorites','INSERT') as favorites,
    has_function_privilege('anon','public.authorize_pet_album_photo(text,uuid)','EXECUTE') as access,
    has_function_privilege('service_role','public.set_pet_favorite(text,uuid,boolean)','EXECUTE') as service`);
  assert.deepEqual(result.rows[0],{photos:false,favorites:false,access:false,service:true});
  for(const action of ['album','albumPhoto','setFavorite','rewardStart','rewardComplete','rewardCancel',
    'rewardStatus','rewardRebind','shareStart','shareReward','shareClose','notificationSettings','setNotificationSettings']) {
    assert.equal(await rpc('check_pet_api_rate_limit',owner(),action,60,10),true);
  }
});

test('legacy backfill grants one actual representative per historical approved friend',async()=>{
  const album=await rpc('get_pet_album',legacyViewer);
  assert.equal(album.items.length,4); assert.equal(album.legacyGiftCount,4);
  for(const item of album.items){
    assert.equal(item.unlockedPhotos.length,1); assert.equal(item.unlockedPhotos[0].source,'legacy_gift');
    assert.equal(item.unlockedPhotos[0].photoId,(await photoIds(item.pet.id))[0]);
    assert.equal(item.pet.approvalStatus,'approved');
    assert.equal(JSON.stringify(item).includes('storagePath'),false);
    assert.equal(JSON.stringify(item).includes('ownerHash'),false);
  }
  assert.equal((await rpc('get_pet_album','fixture-owner')).items.length,0);
});

test('album keyset pagination is stable and favorite filter is accurate',async()=>{
  const page=await rpc('get_pet_album',legacyViewer,null,null,2,false);
  assert.equal(page.items.length,2); assert.equal(page.hasMore,true);
  const next=await rpc('get_pet_album',legacyViewer,page.nextCursor.at,page.nextCursor.id,2,false);
  assert.equal(next.items.length,2); assert.equal(next.nextCursor,null);
  assert.equal(new Set([...page.items,...next.items].map(item=>item.pet.id)).size,4);
  await rpc('set_pet_favorite',legacyViewer,page.items[0].pet.id,true);
  const favorite=await rpc('get_pet_album',legacyViewer,null,null,20,true);
  assert.deepEqual(favorite.items.map(item=>item.pet.id),[page.items[0].pet.id]);
});

test('preparation has no charge, exact photo unlock is permanent and second photo costs once',async()=>{
  const viewer=owner(), pet=await chosen(viewer), request=randomUUID();
  const candidate=await prepare(viewer,pet,request);
  assert.equal((await balance(viewer)).free_remaining,2);
  const first=await unlock(viewer,pet,request,'FREE',null,candidate.photoId);
  assert.equal(first.photoId,candidate.photoId); assert.equal(first.freeRemaining,1);
  const original=await rpc('record_pet_photo_unlock',viewer,'2000-01-01',pet,candidate.photoId,'FREE',request,null);
  assert.equal(original.reusedRequest,true); assert.equal(original.photoId,candidate.photoId);
  assert.equal((await balance(viewer)).free_remaining,1);
  await db.query("update public.user_photo_unlocks set unlocked_at=now()-interval '400 days' where owner_hash=$1",[viewer]);
  assert.equal((await rpc('authorize_pet_album_photo',viewer,candidate.photoId)).photoId,candidate.photoId);
  const second=await unlock(viewer,pet); assert.notEqual(second.photoId,first.photoId);
  assert.equal(second.freeRemaining,0); assert.equal(second.dailyProgress.metCount,1);
  const state=(await rpc('get_pet_album_state',viewer,[pet]))[0];
  assert.equal(state.unlockedPhotoCount,2); assert.equal(state.albumPhotoId,second.photoId);
  assert.equal(state.hasUnseenPhotos,true);
});

test('racing prepared requests for the same photo never charge twice',async()=>{
  const viewer=owner(),pet=await chosen(viewer),a=randomUUID(),b=randomUUID();
  const [candidateA,candidateB]=await Promise.all([prepare(viewer,pet,a),prepare(viewer,pet,b)]);
  assert.equal(candidateA.photoId,candidateB.photoId);
  // PGlite serializes queued transactions; this checks the second transaction's
  // state after the first commit, not true separate-server lock contention.
  const results=await Promise.all([
    unlock(viewer,pet,a,'FREE',null,candidateA.photoId),
    unlock(viewer,pet,b,'FREE',null,candidateB.photoId),
  ]);
  assert.deepEqual(results.map(row=>row.alreadyRevealed).sort(),[false,true]);
  assert.equal((await balance(viewer)).free_remaining,1);
  assert.equal((await rpc('get_pet_album_state',viewer,[pet]))[0].unlockedPhotoCount,1);
  const pinned=await unlock(viewer,pet,a,'FREE',null,(await photoIds(pet))[1]);
  assert.equal(pinned.photoId,candidateA.photoId);assert.equal(pinned.reusedRequest,true);
  await assert.rejects(unlock(viewer,pet,a,'SHARE',null,candidateA.photoId),/REVEAL_REQUEST_CONFLICT/);
});

test('invalid or withdrawn candidate cannot consume allowance and skipping selection is rejected',async()=>{
  const viewer=owner(),pet=await chosen(viewer),request=randomUUID();
  const ids=await photoIds(pet);
  await assert.rejects(unlock(viewer,pet,request,'FREE',null,ids[1]),/PHOTO_SELECTION_CHANGED/);
  assert.equal((await balance(viewer)).free_remaining,2);
  const ownPet=randomUUID(); await addPet(ownPet);
  const candidate=await prepare(viewer,ownPet,request);
  await db.query('update public.pet_photos set is_active=false where id=$1',[candidate.photoId]);
  await assert.rejects(unlock(viewer,ownPet,request,'FREE',null,candidate.photoId),/PET_NOT_AVAILABLE/);
  assert.equal((await balance(viewer)).free_remaining,2);
});

test('approved first share opens today; further photos require its actual house assignment',async()=>{
  const viewer=owner(),pet=randomUUID(); await addPet(pet,'approved','now()');
  const first=await unlock(viewer,pet);
  assert.equal(first.dailyProgress.metCount,0);
  await assert.rejects(prepare(viewer,pet),/ALBUM_PET_NOT_TODAY/);
  assert.equal((await rpc('authorize_pet_album_photo',viewer,first.photoId)).petId,pet);
  assert.equal((await balance(viewer)).free_remaining,1);
});

test('ownership, pending photos and another viewer exact photo IDs cannot bypass access',async()=>{
  const viewer=owner(),pet=await chosen(viewer),revealed=await unlock(viewer,pet);
  await assert.rejects(rpc('authorize_pet_album_photo',owner(),revealed.photoId),/ALBUM_PHOTO_UNAVAILABLE/);
  await assert.rejects(prepare('fixture-owner',pet),/OWNER_PHOTO_FREE/);
  await assert.rejects(rpc('set_pet_favorite','fixture-owner',pet,true),/FAVORITE_PHOTO_REQUIRED/);
  await assert.rejects(rpc('set_pet_favorite',owner(),pet,true),/FAVORITE_PHOTO_REQUIRED/);
  const pending=randomUUID(); await addPet(pending,'pending');
  await assert.rejects(prepare(viewer,pending),/PET_NOT_AVAILABLE/);
});

test('favorites are idempotent, removable and never erase photo ownership',async()=>{
  const viewer=owner(),pet=await chosen(viewer),revealed=await unlock(viewer,pet);
  const beforeCount=(await rpc('get_pet_album_state',viewer,[pet]))[0].favoriteCount;
  assert.equal((await rpc('set_pet_favorite',viewer,pet,true)).favoriteCount,beforeCount+1);
  assert.equal((await rpc('set_pet_favorite',viewer,pet,true)).favoriteCount,beforeCount+1);
  assert.equal((await rpc('set_pet_favorite',viewer,pet,false)).favoriteCount,beforeCount);
  assert.equal((await rpc('set_pet_favorite',viewer,pet,false)).favoriteCount,beforeCount);
  assert.equal((await rpc('authorize_pet_album_photo',viewer,revealed.photoId)).petId,pet);
});

test('moderation hides album immediately, but existing favorite can still be removed',async()=>{
  const viewer=owner(),pet=randomUUID(); await addPet(pet);
  const revealed=await unlock(viewer,pet); await rpc('set_pet_favorite',viewer,pet,true);
  await db.query("update public.pets set status='paused' where id=$1",[pet]);
  await assert.rejects(rpc('authorize_pet_album_photo',viewer,revealed.photoId),/ALBUM_PHOTO_UNAVAILABLE/);
  assert.equal((await rpc('get_pet_album',viewer)).items.length,0);
  await assert.rejects(rpc('set_pet_favorite',viewer,pet,true),/FAVORITE_PHOTO_REQUIRED/);
  assert.equal((await rpc('set_pet_favorite',viewer,pet,false)).isFavorite,false);
});

test('primary replacement creates a new ID and old grants cannot open replacement',async()=>{
  const viewer=owner(),pet=randomUUID(); await addPet(pet);
  const first=await unlock(viewer,pet),path=`fixtures/${pet}/replacement.jpg`;
  await assert.rejects(db.query('update public.pet_photos set storage_path=$1 where id=$2',[path,first.photoId]),/PHOTO_IDENTITY_IMMUTABLE/);
  await db.query("insert into storage.objects(bucket_id,name) values('pet-photos',$1)",[path]);
  await db.query('update public.pets set storage_path=$1 where id=$2',[path,pet]);
  const replacement=(await photoIds(pet))[0]; assert.notEqual(replacement,first.photoId);
  await assert.rejects(rpc('authorize_pet_album_photo',viewer,first.photoId),/ALBUM_PHOTO_UNAVAILABLE/);
  await assert.rejects(rpc('authorize_pet_album_photo',viewer,replacement),/ALBUM_PHOTO_UNAVAILABLE/);
  const old=(await db.query('select sort_order,is_active from public.pet_photos where id=$1',[first.photoId])).rows[0];
  assert.deepEqual(old,{sort_order:null,is_active:false});
  assert.equal((await db.query('select count(*)::int as count from public.user_photo_unlocks where owner_hash=$1',[viewer])).rows[0].count,1);
});

test('completed ad opens new photo once and preserves natural recharge anchor',async()=>{
  // Earlier moderation tests intentionally withdraw/replace shared fixture
  // photos. A random house candidate may then have fewer than three photos.
  // Give this three-collection test its own untouched dog and assignment.
  const viewer=owner(),pet=randomUUID(); await addPet(pet);
  await db.query('insert into public.daily_house_assignments(owner_hash,assignment_date,slot,pet_id) values($1,$2,1,$3)',[viewer,await today(),pet]);
  assert.equal((await photoIds(pet)).length,3);
  await unlock(viewer,pet); await unlock(viewer,pet);
  const anchor=(await db.query('select last_refill_at from public.pet_free_allowances where owner_hash=$1',[viewer])).rows[0].last_refill_at;
  const ad=randomUUID(); await rpc('start_pet_album_ad_reward',viewer,ad,pet);
  await rpc('complete_pet_ad_reward',viewer,ad);
  const request=randomUUID(), third=await unlock(viewer,pet,request,'REWARDED',ad);
  assert.equal(third.unlockMethod,'REWARDED'); assert.equal(third.freeRemaining,0);
  assert.equal((await db.query('select last_refill_at from public.pet_free_allowances where owner_hash=$1',[viewer])).rows[0].last_refill_at.getTime(),anchor.getTime());
  assert.equal((await rpc('get_pet_reward_state',viewer)).adsCompletedToday,1);
  assert.equal((await unlock(viewer,pet,request,'REWARDED',ad)).reusedRequest,true);
  await assert.rejects(prepare(viewer,pet),/ALBUM_ALL_PHOTOS_UNLOCKED/);
  assert.equal((await rpc('get_pet_album_state',viewer,[pet]))[0].hasUnseenPhotos,false);
});

test('cancelled ad gives no photo and share bonus continues working',async()=>{
  const viewer=owner(),pet=await chosen(viewer);
  await db.query("insert into public.pet_free_allowances(owner_hash,balance,last_refill_at) values($1,0,now()) on conflict(owner_hash) do update set balance=0,last_refill_at=now()",[viewer]);
  const ad=randomUUID();await rpc('start_pet_album_ad_reward',viewer,ad,pet);await rpc('cancel_pet_ad_reward',viewer,ad);
  await assert.rejects(unlock(viewer,pet,randomUUID(),'REWARDED',ad),/AD_REWARD_UNAVAILABLE/);
  const share=randomUUID();await rpc('start_pet_share_reward',viewer,share);
  await rpc('record_pet_share_reward',viewer,share,randomUUID(),1,1);
  const result=await unlock(viewer,pet);assert.equal(result.unlockMethod,'SHARE');assert.equal(result.bonusTickets,0);
  assert.equal((await rpc('get_pet_album_state',viewer,[pet]))[0].unlockedPhotoCount,1);
});

test('ad rebind rejects a fully collected friend and preserves earned credit for a valid target',async()=>{
  const viewer=owner(),collected=await chosen(viewer),source=randomUUID(); await addPet(source);
  await db.query(`insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source)
    select $1,id,pet_id,'reveal' from public.pet_photos where pet_id=$2 and is_active`,[viewer,collected]);
  await db.query("update public.pet_free_allowances set balance=0,last_refill_at=now() where owner_hash=$1",[viewer]);
  const ad=randomUUID(); await rpc('start_pet_album_ad_reward',viewer,ad,source);
  await rpc('complete_pet_ad_reward',viewer,ad);
  await db.query("update public.pets set status='paused' where id=$1",[source]);
  await assert.rejects(rpc('rebind_pet_album_ad_reward',viewer,ad,collected),/ALBUM_ALL_PHOTOS_UNLOCKED/);
  const target=randomUUID();await addPet(target);
  const rebound=await rpc('rebind_pet_album_ad_reward',viewer,ad,target);
  assert.equal(rebound.adRewards.find(row=>row.sessionId===ad).petId,target);
  assert.equal((await rpc('rebind_pet_album_ad_reward',viewer,ad,target)).sessionId,ad);
  assert.equal((await unlock(viewer,target,randomUUID(),'REWARDED',ad)).unlockMethod,'REWARDED');
});

test('legacy v4 requests continue their existing behavior after album migration',async()=>{
  const viewer=owner(),pet=await chosen(viewer),request=randomUUID();
  const old=await rpc('record_pet_reveal_v4',viewer,await today(),pet,'FREE',request,null);
  assert.equal(old.alreadyRevealed,false);assert.equal(old.photoId,undefined);
  const retry=await rpc('record_pet_reveal_v4',viewer,await today(),pet,'FREE',request,null);
  assert.equal(retry.reusedRequest,true);assert.equal((await balance(viewer)).free_remaining,1);
});

test('first new-client visit fills legacy encounters made during rollout exactly once',async()=>{
  const viewer=owner(),pet=await chosen(viewer);
  await rpc('record_pet_reveal_v4',viewer,await today(),pet,'FREE',randomUUID(),null);
  assert.equal((await db.query('select count(*)::int as count from public.user_photo_unlocks where owner_hash=$1',[viewer])).rows[0].count,0);
  const album=await rpc('get_pet_album',viewer);
  assert.equal(album.legacyGiftCount,1);assert.equal(album.items[0].pet.id,pet);
  await rpc('ensure_pet_album_adopted',viewer);await rpc('get_pet_album_state',viewer,[pet]);
  assert.equal((await rpc('get_pet_album',viewer)).legacyGiftCount,1);
  const second=await unlock(viewer,pet);
  const upgraded=await rpc('get_pet_album',viewer);
  assert.equal(upgraded.legacyGiftCount,1);assert.equal(upgraded.items[0].unlockedPhotos.length,2);
  assert.equal(upgraded.items[0].unlockedPhotos.find(photo=>photo.photoId===second.photoId).source,'reveal');
  const receipts=await db.query(`select
    (select count(*)::int from public.pet_album_adoptions where owner_hash=$1) as adoptions,
    (select count(*)::int from public.pet_album_legacy_gift_receipts where owner_hash=$1) as gifts`,[viewer]);
  assert.deepEqual(receipts.rows[0],{adoptions:1,gifts:1});
});

test('withdrawn migration gifts and inactive preexisting grants never cause replacement gifts',async()=>{
  const gifted=(await db.query('select photo_id from public.user_photo_unlocks where owner_hash=$1',[legacyWithdrawnViewer])).rows[0].photo_id;
  await db.query('delete from public.pet_photos where id=$1',[gifted]);
  assert.equal((await rpc('get_pet_album',legacyWithdrawnViewer)).items.length,0);
  assert.equal((await db.query('select count(*)::int as count from public.pet_album_legacy_gift_receipts where owner_hash=$1',[legacyWithdrawnViewer])).rows[0].count,1);
  const viewer=owner(),pet=randomUUID();await addPet(pet);
  const ids=await photoIds(pet);
  await db.query("insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source) values($1,$2,$3,'reveal')",[viewer,ids[1],pet]);
  await db.query('update public.pet_photos set is_active=false where id=$1',[ids[1]]);
  await db.query(`insert into public.daily_reveals(owner_hash,reveal_date,pet_id,unlock_method)
    values($1,(now() at time zone 'Asia/Seoul')::date,$2,'FREE')`,[viewer,pet]);
  assert.equal((await rpc('get_pet_album',viewer)).items.length,0);
  const grants=(await db.query('select photo_id,source from public.user_photo_unlocks where owner_hash=$1',[viewer])).rows;
  assert.deepEqual(grants,[{photo_id:ids[1],source:'reveal'}]);
});

test('progress failure rolls back charge, exact-photo grant and request receipt together',async()=>{
  const viewer=owner(),pet=await chosen(viewer),request=randomUUID();
  await db.exec(`create function public.album_test_progress_failure() returns trigger language plpgsql as $$
    begin if new.owner_hash='${viewer}' then raise exception 'TEST_PROGRESS_FAILURE'; end if;return new;end;$$;
    create trigger album_test_progress_failure before update on public.daily_house_assignments
      for each row execute function public.album_test_progress_failure();`);
  try {
    await assert.rejects(unlock(viewer,pet,request),/TEST_PROGRESS_FAILURE/);
    assert.equal((await balance(viewer)).free_remaining,2);
    const writes=await db.query(`select
      (select count(*)::int from public.user_photo_unlocks where owner_hash=$1) as grants,
      (select count(*)::int from public.pet_photo_reveal_requests where owner_hash=$1) as receipts,
      (select count(*)::int from public.daily_reveals where owner_hash=$1) as reveals`,[viewer]);
    assert.deepEqual(writes.rows[0],{grants:0,receipts:0,reveals:0});
  } finally {
    await db.exec('drop trigger album_test_progress_failure on public.daily_house_assignments;drop function public.album_test_progress_failure();');
  }
  assert.equal((await unlock(viewer,pet,request)).freeRemaining,1);
});
