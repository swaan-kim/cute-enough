-- Permanent, exact-photo entitlements. All access remains behind the verified
-- Edge identity; these tables and helpers are never exposed to app clients.
begin;
-- Keep the SQL action allowlist aligned with the existing Edge rate limiter.
alter table public.pet_api_rate_limits drop constraint pet_api_rate_limits_action_check;
alter table public.pet_api_rate_limits add constraint pet_api_rate_limits_action_check
  check(action in ('house','shared','mine','reveal','ownerPhoto','submit','submissionStatus','report',
    'album','albumPhoto','setFavorite','rewardStart','rewardComplete','rewardCancel','rewardStatus',
    'rewardRebind','shareStart','shareReward','shareClose','notificationSettings','setNotificationSettings'));
create table public.user_photo_unlocks (
  owner_hash text not null check (length(owner_hash) > 0),
  photo_id uuid not null references public.pet_photos(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  unlocked_at timestamptz not null default clock_timestamp(),
  source text not null check (source in ('reveal', 'legacy_gift')),
  primary key (owner_hash, photo_id)
);
create index user_photo_unlocks_pet_idx
  on public.user_photo_unlocks(owner_hash, pet_id, unlocked_at desc, photo_id);
create table public.pet_album_adoptions (
  owner_hash text primary key check (length(owner_hash)>0),
  adopted_at timestamptz not null default clock_timestamp()
);
-- No photo FK: retain the gift receipt even when moderation hard-deletes its
-- photo. A withdrawn gift must not quietly turn into a different free image.
create table public.pet_album_legacy_gift_receipts (
  owner_hash text not null,
  pet_id uuid not null,
  photo_id uuid not null,
  gifted_at timestamptz not null default clock_timestamp(),
  primary key(owner_hash,pet_id)
);
create table public.pet_favorites (
  owner_hash text not null check (length(owner_hash) > 0),
  pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_hash, pet_id)
);
create index pet_favorites_count_idx on public.pet_favorites(pet_id);
create table public.pet_photo_reveal_requests (
  owner_hash text not null check (length(owner_hash) > 0),
  request_id uuid not null,
  pet_id uuid not null,
  photo_id uuid not null,
  requested_method text not null check (requested_method in ('FREE','SHARE','REWARDED')),
  requested_ad_session_id uuid,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_hash, request_id)
);

-- A legacy reveal did not record the exact displayed photo. Gift one CURRENT
-- representative per historical non-owner friendship; do not pretend to restore
-- a photograph that was never recorded. This is deliberately a one-time backfill.
insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,unlocked_at,source)
select history.owner_hash, photo.id, history.pet_id, history.first_met_at, 'legacy_gift'
from (
  select owner_hash,pet_id,min(created_at) as first_met_at
  from public.daily_reveals group by owner_hash,pet_id
) history
join public.pets pet on pet.id=history.pet_id and pet.status='approved'
  and pet.owner_hash<>history.owner_hash
join lateral (
  select candidate.id from public.pet_photos candidate
  join storage.objects object on object.bucket_id='pet-photos' and object.name=candidate.storage_path
  where candidate.pet_id=pet.id and candidate.is_active
  order by candidate.sort_order,candidate.id limit 1
) photo on true
on conflict (owner_hash,photo_id) do nothing;

insert into public.pet_album_legacy_gift_receipts(owner_hash,pet_id,photo_id)
select owner_hash,pet_id,photo_id from public.user_photo_unlocks where source='legacy_gift'
on conflict(owner_hash,pet_id) do nothing;

-- Complete legacy migration once when EACH viewer first uses the new client.
-- Old AITs can keep recording encounters between the global migration and that
-- visit. New photo unlocks call this BEFORE writing their grant, and adoption is
-- durable, so their ordinary purchases can never be mistaken for new gifts.
create or replace function public.ensure_pet_album_adopted(p_owner_hash text)
returns void language plpgsql security definer set search_path=public,storage as $$
begin
  if nullif(p_owner_hash,'') is null then raise exception 'INVALID_ALBUM_INPUT'; end if;
  if exists(select 1 from public.pet_album_adoptions where owner_hash=p_owner_hash) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:'||p_owner_hash,0));
  if exists(select 1 from public.pet_album_adoptions where owner_hash=p_owner_hash) then return; end if;
  with gifted as (
    insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,unlocked_at,source)
    select p_owner_hash,photo.id,history.pet_id,history.first_met_at,'legacy_gift'
    from (
      select pet_id,min(created_at) as first_met_at from public.daily_reveals
      where owner_hash=p_owner_hash group by pet_id
    ) history
    join public.pets pet on pet.id=history.pet_id and pet.status='approved' and pet.owner_hash<>p_owner_hash
    join lateral (
      select candidate.id from public.pet_photos candidate
      join storage.objects object on object.bucket_id='pet-photos' and object.name=candidate.storage_path
      where candidate.pet_id=pet.id and candidate.is_active
      order by candidate.sort_order,candidate.id limit 1
    ) photo on true
    where not exists(select 1 from public.user_photo_unlocks granted
      where granted.owner_hash=p_owner_hash and granted.pet_id=pet.id)
      and not exists(select 1 from public.pet_album_legacy_gift_receipts receipt
        where receipt.owner_hash=p_owner_hash and receipt.pet_id=pet.id)
    on conflict(owner_hash,photo_id) do nothing
    returning owner_hash,pet_id,photo_id
  ) insert into public.pet_album_legacy_gift_receipts(owner_hash,pet_id,photo_id)
    select owner_hash,pet_id,photo_id from gifted on conflict(owner_hash,pet_id) do nothing;
  insert into public.pet_album_adoptions(owner_hash) values(p_owner_hash)
    on conflict(owner_hash) do nothing;
end;
$$;

-- Replacing the primary image must not grant the new image to everyone who saw
-- the old one. Keep the withdrawn identity and its grants for audit, vacate its
-- sort slot, and create a fresh photo ID. Existing sort positions stay unique.
alter table public.pet_photos alter column sort_order drop not null;
create or replace function public.guard_pet_photo_identity()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.id is distinct from old.id or new.pet_id is distinct from old.pet_id
    or new.storage_path is distinct from old.storage_path then
    raise exception 'PHOTO_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger guard_pet_photo_identity before update on public.pet_photos
for each row execute function public.guard_pet_photo_identity();
create or replace function public.sync_primary_pet_photo()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_primary public.pet_photos%rowtype;
begin
  select * into v_primary from public.pet_photos
    where pet_id=new.id and sort_order=0 for update;
  if found and v_primary.storage_path=new.storage_path then
    update public.pet_photos set is_active=true where id=v_primary.id;
    return new;
  end if;
  if found then
    update public.pet_photos set is_active=false,sort_order=null where id=v_primary.id;
  end if;
  -- Old withdrawn paths cannot be re-used for a different identity. Upload a
  -- replacement under a new path instead of upserting bytes at the old path.
  insert into public.pet_photos(pet_id,storage_path,sort_order,is_active)
    values(new.id,new.storage_path,0,true);
  return new;
end;
$$;

create or replace function public.get_pet_album_state(p_owner_hash text,p_pet_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_result jsonb;
begin
  if nullif(p_owner_hash,'') is null or p_pet_ids is null or cardinality(p_pet_ids)>100
    then raise exception 'INVALID_ALBUM_INPUT'; end if;
  perform public.ensure_pet_album_adopted(p_owner_hash);
  select coalesce(jsonb_agg(jsonb_build_object(
    'petId',pet.id,
    'isFavorite',exists(select 1 from public.pet_favorites favorite
      where favorite.owner_hash=p_owner_hash and favorite.pet_id=pet.id),
    'unlockedPhotoCount',case when pet.status='approved' and pet.owner_hash<>p_owner_hash
      then coalesce(grants.photo_count,0) else 0 end,
    'albumPhotoId',case when pet.status='approved' and pet.owner_hash<>p_owner_hash
      then grants.photo_id else null end,
    'hasUnseenPhotos',pet.status='approved' and pet.owner_hash<>p_owner_hash and exists(
      select 1 from public.pet_photos photo
      join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
      where photo.pet_id=pet.id and photo.is_active and not exists(
        select 1 from public.user_photo_unlocks unlocked
        where unlocked.owner_hash=p_owner_hash and unlocked.photo_id=photo.id)),
    'favoriteCount',(select count(*) from public.pet_favorites favorite where favorite.pet_id=pet.id)
  )), '[]'::jsonb) into v_result
  from public.pets pet
  left join lateral (
    select count(*) as photo_count,(array_agg(unlocked.photo_id
      order by unlocked.unlocked_at desc,unlocked.photo_id desc))[1] as photo_id
    from public.user_photo_unlocks unlocked
    join public.pet_photos photo on photo.id=unlocked.photo_id and photo.pet_id=pet.id and photo.is_active
    join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
    where unlocked.owner_hash=p_owner_hash and unlocked.pet_id=pet.id
  ) grants on true
  where pet.id=any(p_pet_ids);
  return v_result;
end;
$$;

create or replace function public.get_pet_album(
  p_owner_hash text,p_before_unlocked_at timestamptz default null,
  p_before_pet_id uuid default null,p_limit integer default 20,
  p_favorites_only boolean default false
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_items jsonb; v_count integer; v_cursor jsonb; v_gifts integer;
begin
  if nullif(p_owner_hash,'') is null or p_limit is null or p_limit not between 1 and 50
    or p_favorites_only is null
    or ((p_before_unlocked_at is null) <> (p_before_pet_id is null))
    then raise exception 'INVALID_ALBUM_INPUT'; end if;
  perform public.ensure_pet_album_adopted(p_owner_hash);
  with available as (
    select pet.id,pet.name,pet.traits,pet.published_accessory,pet.published_style,pet.design_version,
      max(unlocked.unlocked_at) as last_unlocked_at,
      count(*) as unlocked_count,
      jsonb_agg(jsonb_build_object('photoId',photo.id,'unlockedAt',unlocked.unlocked_at,'source',unlocked.source)
        order by unlocked.unlocked_at desc,photo.id desc) as photos,
      exists(select 1 from public.pet_favorites favorite
        where favorite.owner_hash=p_owner_hash and favorite.pet_id=pet.id) as favorite
    from public.user_photo_unlocks unlocked
    join public.pets pet on pet.id=unlocked.pet_id and pet.status='approved' and pet.owner_hash<>p_owner_hash
    join public.pet_photos photo on photo.id=unlocked.photo_id and photo.pet_id=pet.id and photo.is_active
    join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
    where unlocked.owner_hash=p_owner_hash
    group by pet.id
  ), page as (
    select * from available
    where (not p_favorites_only or favorite)
      and (p_before_unlocked_at is null or (last_unlocked_at,id)<(p_before_unlocked_at,p_before_pet_id))
    order by last_unlocked_at desc,id desc limit p_limit+1
  ), numbered as (
    select *,row_number() over(order by last_unlocked_at desc,id desc) as ordinal from page
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'pet',jsonb_build_object('id',id,'name',name,'traits',traits,
        'publishedAccessory',published_accessory,'publishedStyle',published_style,
        'designVersion',design_version,'approvalStatus','approved','photoAvailable',true,'isMine',false),
      'unlockedPhotos',photos,'unlockedPhotoCount',unlocked_count,
      'lastUnlockedAt',last_unlocked_at,'isFavorite',favorite
    ) order by last_unlocked_at desc,id desc) filter(where ordinal<=p_limit),'[]'::jsonb),
    count(*),
    (jsonb_agg(jsonb_build_object('at',last_unlocked_at,'id',id)) filter(where ordinal=p_limit))->0
  into v_items,v_count,v_cursor from numbered;
  select count(*) into v_gifts from public.user_photo_unlocks unlocked
  join public.pets pet on pet.id=unlocked.pet_id and pet.status='approved' and pet.owner_hash<>p_owner_hash
  join public.pet_photos photo on photo.id=unlocked.photo_id and photo.is_active
  join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
  where unlocked.owner_hash=p_owner_hash and unlocked.source='legacy_gift';
  return jsonb_build_object('items',v_items,'hasMore',v_count>p_limit,
    'nextCursor',case when v_count>p_limit then v_cursor else null end,'legacyGiftCount',v_gifts);
end;
$$;

create or replace function public.authorize_pet_album_photo(p_owner_hash text,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_result jsonb;
begin
  if nullif(p_owner_hash,'') is null or p_photo_id is null then raise exception 'INVALID_ALBUM_INPUT'; end if;
  select jsonb_build_object('petId',pet.id,'photoId',photo.id,'storagePath',photo.storage_path)
    into v_result
  from public.user_photo_unlocks unlocked
  join public.pets pet on pet.id=unlocked.pet_id and pet.status='approved' and pet.owner_hash<>p_owner_hash
  join public.pet_photos photo on photo.id=unlocked.photo_id and photo.pet_id=pet.id and photo.is_active
  join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
  where unlocked.owner_hash=p_owner_hash and unlocked.photo_id=p_photo_id;
  if v_result is null then raise exception 'ALBUM_PHOTO_UNAVAILABLE'; end if;
  return v_result;
end;
$$;

create or replace function public.set_pet_favorite(p_owner_hash text,p_pet_id uuid,p_is_favorite boolean)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
begin
  if nullif(p_owner_hash,'') is null or p_pet_id is null or p_is_favorite is null
    then raise exception 'INVALID_ALBUM_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-favorite:'||p_owner_hash||':'||p_pet_id::text,0));
  if p_is_favorite then
    if not exists (
      select 1 from public.user_photo_unlocks unlocked
      join public.pets pet on pet.id=unlocked.pet_id and pet.status='approved' and pet.owner_hash<>p_owner_hash
      join public.pet_photos photo on photo.id=unlocked.photo_id and photo.pet_id=pet.id and photo.is_active
      join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
      where unlocked.owner_hash=p_owner_hash and unlocked.pet_id=p_pet_id
    ) then raise exception 'FAVORITE_PHOTO_REQUIRED'; end if;
    insert into public.pet_favorites(owner_hash,pet_id) values(p_owner_hash,p_pet_id)
      on conflict(owner_hash,pet_id) do nothing;
  else
    delete from public.pet_favorites where owner_hash=p_owner_hash and pet_id=p_pet_id;
  end if;
  return jsonb_build_object('petId',p_pet_id,'isFavorite',p_is_favorite,
    'favoriteCount',(select count(*) from public.pet_favorites where pet_id=p_pet_id));
end;
$$;

-- Prepare chooses an identity before the Edge signs it; no ticket is consumed.
-- A completed request always pins the same photo, even after KST midnight.
create or replace function public.prepare_pet_photo_unlock(
  p_owner_hash text,p_pet_id uuid,p_request_id uuid,p_unlock_method text,
  p_ad_session_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_existing public.pet_photo_reveal_requests%rowtype;
  v_photo public.pet_photos%rowtype; v_today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
begin
  if nullif(p_owner_hash,'') is null or p_pet_id is null or p_request_id is null
    or p_unlock_method is null or p_unlock_method not in ('FREE','SHARE','REWARDED')
    or (p_unlock_method<>'REWARDED' and p_ad_session_id is not null)
    or (p_unlock_method='REWARDED' and p_ad_session_id is null)
    then raise exception 'INVALID_REVEAL_INPUT'; end if;
  perform public.ensure_pet_album_adopted(p_owner_hash);
  if not public.is_pet_reward_photo_available(p_pet_id) then raise exception 'PET_NOT_AVAILABLE'; end if;
  if exists(select 1 from public.pets where id=p_pet_id and owner_hash=p_owner_hash)
    then raise exception 'OWNER_PHOTO_FREE'; end if;
  select * into v_existing from public.pet_photo_reveal_requests
    where owner_hash=p_owner_hash and request_id=p_request_id;
  if found then
    if v_existing.pet_id<>p_pet_id or v_existing.requested_method<>p_unlock_method
      or v_existing.requested_ad_session_id is distinct from p_ad_session_id
      then raise exception 'REVEAL_REQUEST_CONFLICT'; end if;
    return public.authorize_pet_album_photo(p_owner_hash,v_existing.photo_id)
      || jsonb_build_object('reusedRequest',true,'alreadyRevealed',true);
  end if;
  -- An already-met friend may expose MORE photos only from today's fixed house.
  -- First encounters through approved share links remain possible.
  if exists(select 1 from public.user_photo_unlocks where owner_hash=p_owner_hash and pet_id=p_pet_id)
    and not exists(select 1 from public.daily_house_assignments
      where owner_hash=p_owner_hash and assignment_date=v_today and pet_id=p_pet_id)
    then raise exception 'ALBUM_PET_NOT_TODAY'; end if;
  select photo.* into v_photo from public.pet_photos photo
  join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
  where photo.pet_id=p_pet_id and photo.is_active and not exists(
    select 1 from public.user_photo_unlocks unlocked where unlocked.owner_hash=p_owner_hash and unlocked.photo_id=photo.id)
  order by photo.sort_order,photo.id limit 1;
  if not found then raise exception 'ALBUM_ALL_PHOTOS_UNLOCKED'; end if;
  return jsonb_build_object('petId',p_pet_id,'photoId',v_photo.id,'storagePath',v_photo.storage_path,
    'reusedRequest',false,'alreadyRevealed',false);
end;
$$;

-- This is a separate ledger/RPC so older live builds retain their v2/v3/v4
-- revisit contracts. Lock order matches reward v4: reveal -> house -> free.
create or replace function public.record_pet_photo_unlock(
  p_owner_hash text,p_reveal_date date,p_pet_id uuid,p_photo_id uuid,
  p_unlock_method text,p_request_id uuid,p_ad_session_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare
  v_now timestamptz:=clock_timestamp(); v_existing public.pet_photo_reveal_requests%rowtype;
  v_ad public.pet_ad_reward_sessions%rowtype; v_grant public.user_photo_unlocks%rowtype;
  v_free integer; v_next timestamptz; v_until timestamptz;
  v_method text:=p_unlock_method; v_ad_id uuid:=p_ad_session_id;
  v_progress jsonb; v_response jsonb; v_candidate jsonb; v_already boolean:=false;
  v_locked_photo_id uuid:=p_photo_id;
begin
  if nullif(p_owner_hash,'') is null or p_reveal_date is null or p_pet_id is null
    or p_photo_id is null or p_request_id is null or p_unlock_method is null
    or p_unlock_method not in ('FREE','SHARE','REWARDED')
    or (p_unlock_method<>'REWARDED' and p_ad_session_id is not null)
    or (p_unlock_method='REWARDED' and p_ad_session_id is null)
    then raise exception 'INVALID_REVEAL_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:'||p_owner_hash,0));
  v_now:=clock_timestamp();
  select * into v_existing from public.pet_photo_reveal_requests
    where owner_hash=p_owner_hash and request_id=p_request_id;
  if found then
    if v_existing.pet_id<>p_pet_id or v_existing.requested_method<>p_unlock_method
      or v_existing.requested_ad_session_id is distinct from p_ad_session_id
      then raise exception 'REVEAL_REQUEST_CONFLICT'; end if;
    -- Two in-flight preparations of the same request can straddle another
    -- completed request. The committed identity wins; Edge signs this pinned
    -- photo if its earlier candidate differed, without another consumption.
    v_locked_photo_id:=v_existing.photo_id;
  end if;
  -- Shared row locks keep moderation/photo withdrawal serialized with commit.
  perform 1 from public.pets pet join public.pet_photos photo on photo.pet_id=pet.id
    join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
    where pet.id=p_pet_id and pet.status='approved' and pet.owner_hash<>p_owner_hash
      and photo.id=v_locked_photo_id and photo.is_active for share of pet,photo,object;
  if not found then raise exception 'PET_NOT_AVAILABLE'; end if;
  if v_existing.request_id is not null then
    perform public.authorize_pet_album_photo(p_owner_hash,v_existing.photo_id);
    return v_existing.response||jsonb_build_object('reusedRequest',true);
  end if;
  if p_reveal_date<>(v_now at time zone 'Asia/Seoul')::date then raise exception 'INVALID_REVEAL_DATE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('daily-house-v2:'||p_owner_hash||':'||p_reveal_date::text,0));
  select * into v_grant from public.user_photo_unlocks
    where owner_hash=p_owner_hash and photo_id=p_photo_id and pet_id=p_pet_id;
  v_already:=found;
  if not v_already then
    v_candidate:=public.prepare_pet_photo_unlock(p_owner_hash,p_pet_id,p_request_id,p_unlock_method,p_ad_session_id);
    if (v_candidate->>'photoId')::uuid<>p_photo_id then raise exception 'PHOTO_SELECTION_CHANGED'; end if;
  end if;
  select free_remaining,next_free_at into v_free,v_next from public.get_pet_free_allowance(p_owner_hash);
  v_until:=coalesce(v_next,v_now+interval '3 hours');
  if not v_already then
    if p_unlock_method<>'REWARDED' then
      select * into v_ad from public.pet_ad_reward_sessions
        where owner_hash=p_owner_hash and pet_id=p_pet_id and status='completed'
        order by completed_at,id limit 1 for update;
      if found then v_method:='REWARDED'; v_ad_id:=v_ad.id;
      elsif v_free>0 then v_method:='FREE'; v_ad_id:=null;
      else v_method:='SHARE'; v_ad_id:=null; end if;
    end if;
    if v_method='REWARDED' then
      select * into v_ad from public.pet_ad_reward_sessions where id=v_ad_id
        and owner_hash=p_owner_hash and pet_id=p_pet_id and status='completed' for update;
      if not found then raise exception 'AD_REWARD_UNAVAILABLE'; end if;
      update public.pet_ad_reward_sessions set status='consumed',consumed_at=v_now where id=v_ad.id;
    elsif v_method='FREE' then
      update public.pet_free_allowances set balance=v_free-1,
        last_refill_at=case when v_free=2 then v_now else last_refill_at end,updated_at=v_now
        where owner_hash=p_owner_hash;
      if v_free=2 then v_next:=v_now+interval '3 hours'; end if;
      v_free:=v_free-1;
    else
      update public.pet_bonus_accounts set balance=balance-1,updated_at=v_now
        where owner_hash=p_owner_hash and balance>0;
      if not found then raise exception 'FREE_ALLOWANCE_EMPTY'; end if;
    end if;
    v_until:=coalesce(v_next,v_now+interval '3 hours');
    insert into public.daily_reveals(owner_hash,reveal_date,pet_id,unlock_method,ad_session_id,revisit_until)
      values(p_owner_hash,p_reveal_date,p_pet_id,v_method,
        case when v_method='REWARDED' then v_ad_id else null end,v_until);
    insert into public.user_photo_unlocks(owner_hash,photo_id,pet_id,source)
      values(p_owner_hash,p_photo_id,p_pet_id,'reveal');
  end if;
  v_progress:=public.mark_daily_house_pet_met(p_owner_hash,p_reveal_date,p_pet_id);
  v_response:=jsonb_build_object('petId',p_pet_id,'photoId',p_photo_id,'revisitUntil',v_until,
    'revealDate',p_reveal_date,'dailyProgress',v_progress,'unlockMethod',v_method,'adSessionId',v_ad_id,
    'alreadyRevealed',v_already,'reusedRequest',false,'freeRemaining',v_free,'nextChargeAt',v_next,
    'bonusTickets',coalesce((select balance from public.pet_bonus_accounts where owner_hash=p_owner_hash),0));
  insert into public.pet_photo_reveal_requests(owner_hash,request_id,pet_id,photo_id,requested_method,
    requested_ad_session_id,response) values(p_owner_hash,p_request_id,p_pet_id,p_photo_id,p_unlock_method,p_ad_session_id,v_response);
  return v_response;
end;
$$;

-- Photo-aware ad start: a legacy active revisit must not prevent an earned ad
-- for a DIFFERENT, unseen photo. Existing ad starts keep their old guard.
create or replace function public.start_pet_album_ad_reward(p_owner_hash text,p_session_id uuid,p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_now timestamptz:=clock_timestamp(); v_today date;
  v_session public.pet_ad_reward_sessions%rowtype; v_free integer; v_state jsonb;
begin
  if nullif(p_owner_hash,'') is null or p_session_id is null or p_pet_id is null
    then raise exception 'INVALID_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:'||p_owner_hash,0));
  v_now:=clock_timestamp();
  v_today:=(v_now at time zone 'Asia/Seoul')::date;
  select * into v_session from public.pet_ad_reward_sessions where id=p_session_id;
  if found then
    if v_session.owner_hash<>p_owner_hash or v_session.original_pet_id<>p_pet_id
      then raise exception 'REWARD_SESSION_CONFLICT'; end if;
    return public.get_pet_reward_state(p_owner_hash)||jsonb_build_object('sessionId',p_session_id);
  end if;
  if not(select ads_enabled from public.pet_reward_settings where singleton) then raise exception 'ADS_DISABLED'; end if;
  perform public.prepare_pet_photo_unlock(p_owner_hash,p_pet_id,p_session_id,'REWARDED',p_session_id);
  select free_remaining into v_free from public.get_pet_free_allowance(p_owner_hash);
  if v_free>0 then raise exception 'FREE_ALLOWANCE_AVAILABLE'; end if;
  if coalesce((select balance from public.pet_bonus_accounts where owner_hash=p_owner_hash),0)>0
    then raise exception 'BONUS_ALLOWANCE_AVAILABLE'; end if;
  if exists(select 1 from public.pet_ad_reward_sessions where owner_hash=p_owner_hash and pet_id=p_pet_id and status='completed')
    then raise exception 'AD_REWARD_AVAILABLE'; end if;
  if exists(select 1 from public.pet_ad_reward_sessions where owner_hash=p_owner_hash and status='started' and expires_at>v_now)
    then raise exception 'AD_SESSION_ACTIVE'; end if;
  v_state:=public.get_pet_reward_state(p_owner_hash);
  if (v_state->>'adsRemainingToday')::integer<1 then raise exception 'REWARDED_LIMIT_REACHED'; end if;
  insert into public.pet_ad_reward_sessions(id,owner_hash,pet_id,original_pet_id,started_date,started_at,expires_at)
    values(p_session_id,p_owner_hash,p_pet_id,p_pet_id,v_today,v_now,v_now+interval '10 minutes');
  return public.get_pet_reward_state(p_owner_hash)||jsonb_build_object('sessionId',p_session_id);
end;
$$;

create or replace function public.rebind_pet_album_ad_reward(p_owner_hash text,p_session_id uuid,p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_session public.pet_ad_reward_sessions%rowtype;
begin
  if nullif(p_owner_hash,'') is null or p_session_id is null or p_pet_id is null
    then raise exception 'INVALID_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:'||p_owner_hash,0));
  select * into v_session from public.pet_ad_reward_sessions
    where id=p_session_id and owner_hash=p_owner_hash;
  if not found then raise exception 'AD_SESSION_NOT_FOUND'; end if;
  if v_session.pet_id<>p_pet_id then
    perform public.prepare_pet_photo_unlock(p_owner_hash,p_pet_id,gen_random_uuid(),'REWARDED',p_session_id);
  end if;
  return public.rebind_pet_ad_reward(p_owner_hash,p_session_id,p_pet_id);
end;
$$;

alter table public.user_photo_unlocks enable row level security;
alter table public.pet_album_adoptions enable row level security;
alter table public.pet_album_legacy_gift_receipts enable row level security;
alter table public.pet_favorites enable row level security;
alter table public.pet_photo_reveal_requests enable row level security;
revoke all on table public.user_photo_unlocks,public.pet_favorites,public.pet_photo_reveal_requests,
  public.pet_album_adoptions,public.pet_album_legacy_gift_receipts
  from public,anon,authenticated;
grant select,insert,update,delete on table public.user_photo_unlocks,public.pet_favorites,public.pet_photo_reveal_requests,
  public.pet_album_adoptions,public.pet_album_legacy_gift_receipts
  to service_role;
revoke all on function public.guard_pet_photo_identity(),public.ensure_pet_album_adopted(text),
  public.get_pet_album_state(text,uuid[]),public.get_pet_album(text,timestamptz,uuid,integer,boolean),
  public.authorize_pet_album_photo(text,uuid),public.set_pet_favorite(text,uuid,boolean),
  public.prepare_pet_photo_unlock(text,uuid,uuid,text,uuid),
  public.record_pet_photo_unlock(text,date,uuid,uuid,text,uuid,uuid),
  public.start_pet_album_ad_reward(text,uuid,uuid),
  public.rebind_pet_album_ad_reward(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.guard_pet_photo_identity(),public.ensure_pet_album_adopted(text),
  public.get_pet_album_state(text,uuid[]),public.get_pet_album(text,timestamptz,uuid,integer,boolean),
  public.authorize_pet_album_photo(text,uuid),public.set_pet_favorite(text,uuid,boolean),
  public.prepare_pet_photo_unlock(text,uuid,uuid,text,uuid),
  public.record_pet_photo_unlock(text,date,uuid,uuid,text,uuid,uuid),
  public.start_pet_album_ad_reward(text,uuid,uuid),
  public.rebind_pet_album_ad_reward(text,uuid,uuid) to service_role;

comment on table public.user_photo_unlocks is 'Permanent permission for an exact active approved photo; never a Storage URL or ownership bypass.';
comment on table public.pet_favorites is 'One removable fan per viewer/pet. Decorative heart animation does not create a row.';
commit;
