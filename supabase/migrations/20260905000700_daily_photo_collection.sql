-- Photo collection v2: one new photograph per viewer/pet/KST day, and a
-- completely separate, free replay path. Preserve every prior entitlement.
begin;

alter table public.pet_photos add column caption text;
alter table public.pet_photos add constraint pet_photos_caption_plain_text_check check (
  caption is null or (char_length(caption)<=30 and caption !~ '[<>[:cntrl:]]'
    and caption !~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]')
);

-- No cascading photo FK: withdrawal must not restore today's collection slot.
create table public.pet_daily_photo_collections (
  owner_hash text not null,pet_id uuid not null,collection_date date not null,
  photo_id uuid not null,collected_at timestamptz not null default clock_timestamp(),
  primary key(owner_hash,pet_id,collection_date)
);
insert into public.pet_daily_photo_collections(owner_hash,pet_id,collection_date,photo_id,collected_at)
select distinct on(owner_hash,pet_id,(unlocked_at at time zone 'Asia/Seoul')::date)
  owner_hash,pet_id,(unlocked_at at time zone 'Asia/Seoul')::date,photo_id,unlocked_at
from public.user_photo_unlocks where source='reveal'
order by owner_hash,pet_id,(unlocked_at at time zone 'Asia/Seoul')::date,unlocked_at desc,photo_id desc;

create table public.pet_daily_photo_replays (
  owner_hash text not null,pet_id uuid not null,replay_date date not null,
  photo_id uuid not null,recorded_at timestamptz not null default clock_timestamp(),
  primary key(owner_hash,pet_id,replay_date)
);
create table public.pet_photo_replay_requests (
  owner_hash text not null,request_id uuid not null,pet_id uuid not null,
  photo_id uuid not null,response jsonb not null,created_at timestamptz not null default clock_timestamp(),
  primary key(owner_hash,request_id)
);

-- Retain the previous implementations as private implementation helpers. The
-- original public RPC names are wrapped below, so album v1 cannot bypass v2.
alter function public.prepare_pet_photo_unlock(text,uuid,uuid,text,uuid) rename to prepare_pet_photo_unlock_album_v1;
alter function public.record_pet_photo_unlock(text,date,uuid,uuid,text,uuid,uuid) rename to record_pet_photo_unlock_album_v1;
alter function public.get_pet_album_state(text,uuid[]) rename to get_pet_album_state_album_v1;
alter function public.authorize_pet_album_photo(text,uuid) rename to authorize_pet_album_photo_album_v1;
alter function public.start_pet_album_ad_reward(text,uuid,uuid) rename to start_pet_album_ad_reward_album_v1;
alter function public.rebind_pet_album_ad_reward(text,uuid,uuid) rename to rebind_pet_album_ad_reward_album_v1;

create function public.authorize_pet_album_photo(p_owner_hash text,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_result jsonb;
begin
  v_result:=public.authorize_pet_album_photo_album_v1(p_owner_hash,p_photo_id);
  return v_result||jsonb_build_object('photoCaption',(select caption from public.pet_photos where id=p_photo_id));
end;
$$;

create function public.get_pet_photo_collection(p_owner_hash text,p_pet_id uuid)
returns jsonb language sql security definer set search_path=public,storage as $$
  with eligible as (
    select photo.id from public.pet_photos photo
    join public.pets pet on pet.id=photo.pet_id and pet.status='approved' and pet.owner_hash<>p_owner_hash
    join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
    where photo.pet_id=p_pet_id and photo.is_active
  ), collected as (
    select eligible.id from eligible join public.user_photo_unlocks unlocked
      on unlocked.photo_id=eligible.id and unlocked.pet_id=p_pet_id and unlocked.owner_hash=p_owner_hash
  ), today as (
    select photo_id from public.pet_daily_photo_collections
    where owner_hash=p_owner_hash and pet_id=p_pet_id
      and collection_date=(clock_timestamp() at time zone 'Asia/Seoul')::date
  ) select jsonb_build_object(
    'collectedCount',(select count(*) from collected),'totalCount',(select count(*) from eligible),
    'collectedToday',exists(select 1 from today),
    'todayPhotoId',(select today.photo_id from today join collected on collected.id=today.photo_id),
    'canCollectToday',not exists(select 1 from today)
      and (select count(*) from eligible)>(select count(*) from collected)
      and (not exists(select 1 from public.user_photo_unlocks where owner_hash=p_owner_hash and pet_id=p_pet_id)
        or exists(select 1 from public.daily_house_assignments where owner_hash=p_owner_hash and pet_id=p_pet_id
          and assignment_date=(clock_timestamp() at time zone 'Asia/Seoul')::date))
  );
$$;

create function public.get_pet_album_state(p_owner_hash text,p_pet_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_states jsonb;
begin
  v_states:=public.get_pet_album_state_album_v1(p_owner_hash,p_pet_ids);
  return (select coalesce(jsonb_agg(value||jsonb_build_object('collection',
    public.get_pet_photo_collection(p_owner_hash,(value->>'petId')::uuid))),'[]'::jsonb)
    from jsonb_array_elements(v_states));
end;
$$;

-- When today's exact photo was withdrawn, permit only another already-owned
-- active photo. Do not give out a replacement or restore the daily slot.
create function public.get_collected_pet_photo_today(p_owner_hash text,p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_photo_id uuid; v_selected uuid;
begin
  select photo_id into v_photo_id from public.pet_daily_photo_collections
    where owner_hash=p_owner_hash and pet_id=p_pet_id
      and collection_date=(clock_timestamp() at time zone 'Asia/Seoul')::date;
  if not found then return null; end if;
  select photo.id into v_selected from public.user_photo_unlocks unlocked
    join public.pet_photos photo on photo.id=unlocked.photo_id and photo.pet_id=p_pet_id and photo.is_active
    join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
    where unlocked.owner_hash=p_owner_hash and unlocked.pet_id=p_pet_id
    order by (photo.id=v_photo_id) desc,unlocked.unlocked_at desc,photo.id desc limit 1;
  if v_selected is null then raise exception 'ALBUM_PHOTO_UNAVAILABLE'; end if;
  return public.authorize_pet_album_photo(p_owner_hash,v_selected);
end;
$$;

create function public.prepare_pet_photo_unlock(
  p_owner_hash text,p_pet_id uuid,p_request_id uuid,p_unlock_method text,p_ad_session_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_today jsonb; v_result jsonb;
begin
  if nullif(p_owner_hash,'') is null or p_pet_id is null or p_request_id is null
    or p_unlock_method is null or p_unlock_method not in ('FREE','SHARE','REWARDED')
    or (p_unlock_method<>'REWARDED' and p_ad_session_id is not null)
    or (p_unlock_method='REWARDED' and p_ad_session_id is null) then raise exception 'INVALID_REVEAL_INPUT'; end if;
  if exists(select 1 from public.pet_photo_replay_requests where owner_hash=p_owner_hash and request_id=p_request_id)
    then raise exception 'REVEAL_REQUEST_CONFLICT'; end if;
  perform public.ensure_pet_album_adopted(p_owner_hash);
  if not exists(select 1 from public.pet_photo_reveal_requests where owner_hash=p_owner_hash and request_id=p_request_id) then
    v_today:=public.get_collected_pet_photo_today(p_owner_hash,p_pet_id);
    if v_today is not null then return v_today||jsonb_build_object('alreadyRevealed',true,'reusedRequest',false); end if;
  end if;
  v_result:=public.prepare_pet_photo_unlock_album_v1(p_owner_hash,p_pet_id,p_request_id,p_unlock_method,p_ad_session_id);
  return v_result||jsonb_build_object('photoCaption',(select caption from public.pet_photos where id=(v_result->>'photoId')::uuid));
end;
$$;

create function public.record_pet_photo_unlock(
  p_owner_hash text,p_reveal_date date,p_pet_id uuid,p_photo_id uuid,
  p_unlock_method text,p_request_id uuid,p_ad_session_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_today jsonb; v_result jsonb; v_date date;
begin
  if nullif(p_owner_hash,'') is null or p_pet_id is null or p_photo_id is null or p_request_id is null
    or p_reveal_date is null or p_unlock_method is null or p_unlock_method not in ('FREE','SHARE','REWARDED')
    or (p_unlock_method<>'REWARDED' and p_ad_session_id is not null)
    or (p_unlock_method='REWARDED' and p_ad_session_id is null) then raise exception 'INVALID_REVEAL_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:'||p_owner_hash,0));
  if exists(select 1 from public.pet_photo_replay_requests where owner_hash=p_owner_hash and request_id=p_request_id)
    then raise exception 'REVEAL_REQUEST_CONFLICT'; end if;
  if exists(select 1 from public.pet_photo_reveal_requests where owner_hash=p_owner_hash and request_id=p_request_id) then
    return public.record_pet_photo_unlock_album_v1(p_owner_hash,p_reveal_date,p_pet_id,p_photo_id,p_unlock_method,p_request_id,p_ad_session_id);
  end if;
  v_date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
  if p_reveal_date<>v_date then raise exception 'INVALID_REVEAL_DATE'; end if;
  v_today:=public.get_collected_pet_photo_today(p_owner_hash,p_pet_id);
  if v_today is not null then
    -- This branch is also reached by two different in-flight request IDs. It
    -- consumes neither a natural ticket nor a previously earned ad credit.
    perform pg_advisory_xact_lock(hashtextextended('daily-house-v2:'||p_owner_hash||':'||v_date::text,0));
    perform 1 from public.pets pet join public.pet_photos photo on photo.pet_id=pet.id
      join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
      where pet.id=p_pet_id and pet.status='approved' and photo.id=(v_today->>'photoId')::uuid and photo.is_active
      for share of pet,photo,object;
    if not found then raise exception 'ALBUM_PHOTO_UNAVAILABLE'; end if;
    v_result:=jsonb_build_object('petId',p_pet_id,'photoId',v_today->>'photoId','revealDate',v_date,
      'dailyProgress',public.mark_daily_house_pet_met(p_owner_hash,v_date,p_pet_id),
      'alreadyRevealed',true,'reusedRequest',false,'unlockMethod',p_unlock_method,'adSessionId',p_ad_session_id);
    insert into public.pet_photo_reveal_requests(owner_hash,request_id,pet_id,photo_id,requested_method,requested_ad_session_id,response)
      values(p_owner_hash,p_request_id,p_pet_id,(v_today->>'photoId')::uuid,p_unlock_method,p_ad_session_id,v_result);
    return v_result;
  end if;
  v_result:=public.record_pet_photo_unlock_album_v1(p_owner_hash,p_reveal_date,p_pet_id,p_photo_id,p_unlock_method,p_request_id,p_ad_session_id);
  if not coalesce((v_result->>'alreadyRevealed')::boolean,false) then
    insert into public.pet_daily_photo_collections(owner_hash,pet_id,collection_date,photo_id)
      values(p_owner_hash,p_pet_id,v_date,(v_result->>'photoId')::uuid);
    insert into public.pet_daily_photo_replays(owner_hash,pet_id,replay_date,photo_id)
      values(p_owner_hash,p_pet_id,v_date,(v_result->>'photoId')::uuid)
      on conflict(owner_hash,pet_id,replay_date) do update set photo_id=excluded.photo_id,recorded_at=clock_timestamp();
  end if;
  return v_result;
end;
$$;

create function public.prepare_pet_photo_replay(p_owner_hash text,p_pet_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_request public.pet_photo_replay_requests%rowtype; v_photo_id uuid;
  v_today jsonb; v_previous uuid; v_collection jsonb;
begin
  if nullif(p_owner_hash,'') is null or p_pet_id is null or p_request_id is null then raise exception 'INVALID_REVEAL_INPUT'; end if;
  if exists(select 1 from public.pet_photo_reveal_requests where owner_hash=p_owner_hash and request_id=p_request_id)
    then raise exception 'REVEAL_REQUEST_CONFLICT'; end if;
  perform public.ensure_pet_album_adopted(p_owner_hash);
  select * into v_request from public.pet_photo_replay_requests where owner_hash=p_owner_hash and request_id=p_request_id;
  if found then
    if v_request.pet_id<>p_pet_id then raise exception 'REVEAL_REQUEST_CONFLICT'; end if;
    return public.authorize_pet_album_photo(p_owner_hash,v_request.photo_id);
  end if;
  v_today:=public.get_collected_pet_photo_today(p_owner_hash,p_pet_id);
  if v_today is not null then return v_today; end if;
  v_collection:=public.get_pet_photo_collection(p_owner_hash,p_pet_id);
  if (v_collection->>'collectedCount')::integer<(v_collection->>'totalCount')::integer then
    -- While still collecting, free replays keep the most recently collected
    -- photo. No random unseen image can sneak through this free branch.
    select photo.id into v_photo_id from public.user_photo_unlocks unlocked
      join public.pet_photos photo on photo.id=unlocked.photo_id and photo.pet_id=p_pet_id and photo.is_active
      join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
      where unlocked.owner_hash=p_owner_hash and unlocked.pet_id=p_pet_id
      order by unlocked.unlocked_at desc,photo.id desc limit 1;
    if v_photo_id is null then raise exception 'ALBUM_PHOTO_UNAVAILABLE'; end if;
    return public.authorize_pet_album_photo(p_owner_hash,v_photo_id);
  end if;
  -- Once the collection is complete, EVERY new request advances the rotation.
  -- The daily record stores the latest replay, not an all-day fixed photo;
  -- only the request receipt above pins a retry to its original image.
  select photo_id into v_previous from public.pet_daily_photo_replays
    where owner_hash=p_owner_hash and pet_id=p_pet_id order by recorded_at desc,replay_date desc limit 1;
  with owned as (
    select photo.id,row_number() over(order by photo.sort_order,photo.id) as ordinal
    from public.user_photo_unlocks unlocked join public.pet_photos photo on photo.id=unlocked.photo_id and photo.pet_id=p_pet_id and photo.is_active
    join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
    where unlocked.owner_hash=p_owner_hash and unlocked.pet_id=p_pet_id
  ) select id into v_photo_id from owned
    order by case when ordinal>coalesce((select ordinal from owned where id=v_previous),0) then 0 else 1 end,ordinal limit 1;
  if v_photo_id is null then raise exception 'ALBUM_PHOTO_UNAVAILABLE'; end if;
  return public.authorize_pet_album_photo(p_owner_hash,v_photo_id);
end;
$$;

create function public.record_pet_photo_replay(p_owner_hash text,p_pet_id uuid,p_request_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_request public.pet_photo_replay_requests%rowtype; v_selected jsonb; v_result jsonb; v_date date;
begin
  if nullif(p_owner_hash,'') is null or p_pet_id is null or p_request_id is null or p_photo_id is null
    then raise exception 'INVALID_REVEAL_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:'||p_owner_hash,0));
  v_selected:=public.prepare_pet_photo_replay(p_owner_hash,p_pet_id,p_request_id);
  select * into v_request from public.pet_photo_replay_requests where owner_hash=p_owner_hash and request_id=p_request_id;
  if found then return v_request.response||jsonb_build_object('reusedRequest',true); end if;
  perform 1 from public.pets pet join public.pet_photos photo on photo.pet_id=pet.id
    join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
    where pet.id=p_pet_id and pet.status='approved' and photo.id=(v_selected->>'photoId')::uuid and photo.is_active
    for share of pet,photo,object;
  if not found then raise exception 'ALBUM_PHOTO_UNAVAILABLE'; end if;
  v_date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
  perform pg_advisory_xact_lock(hashtextextended('daily-house-v2:'||p_owner_hash||':'||v_date::text,0));
  insert into public.pet_daily_photo_replays(owner_hash,pet_id,replay_date,photo_id)
    values(p_owner_hash,p_pet_id,v_date,(v_selected->>'photoId')::uuid)
    on conflict(owner_hash,pet_id,replay_date) do update set photo_id=excluded.photo_id,recorded_at=clock_timestamp();
  v_result:=jsonb_build_object('photoId',v_selected->>'photoId','petId',p_pet_id,
    'revealDate',v_date,'alreadyRevealed',true,'reusedRequest',false,
    'dailyProgress',public.mark_daily_house_pet_met(p_owner_hash,v_date,p_pet_id));
  insert into public.pet_photo_replay_requests(owner_hash,request_id,pet_id,photo_id,response)
    values(p_owner_hash,p_request_id,p_pet_id,(v_selected->>'photoId')::uuid,v_result);
  return v_result;
end;
$$;

create function public.start_pet_album_ad_reward(p_owner_hash text,p_session_id uuid,p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:'||p_owner_hash,0));
  if not exists(select 1 from public.pet_ad_reward_sessions where id=p_session_id)
    and exists(select 1 from public.pet_daily_photo_collections where owner_hash=p_owner_hash and pet_id=p_pet_id
      and collection_date=(clock_timestamp() at time zone 'Asia/Seoul')::date)
    then raise exception 'DAILY_PHOTO_ALREADY_COLLECTED'; end if;
  return public.start_pet_album_ad_reward_album_v1(p_owner_hash,p_session_id,p_pet_id);
end;
$$;
create function public.rebind_pet_album_ad_reward(p_owner_hash text,p_session_id uuid,p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:'||p_owner_hash,0));
  if not exists(select 1 from public.pet_ad_reward_sessions where id=p_session_id and pet_id=p_pet_id and owner_hash=p_owner_hash)
    and exists(select 1 from public.pet_daily_photo_collections where owner_hash=p_owner_hash and pet_id=p_pet_id
      and collection_date=(clock_timestamp() at time zone 'Asia/Seoul')::date)
    then raise exception 'DAILY_PHOTO_ALREADY_COLLECTED'; end if;
  return public.rebind_pet_album_ad_reward_album_v1(p_owner_hash,p_session_id,p_pet_id);
end;
$$;

alter table public.pet_daily_photo_collections enable row level security;
alter table public.pet_daily_photo_replays enable row level security;
alter table public.pet_photo_replay_requests enable row level security;
revoke all on table public.pet_daily_photo_collections,public.pet_daily_photo_replays,public.pet_photo_replay_requests from public,anon,authenticated;
grant select,insert,update,delete on table public.pet_daily_photo_collections,public.pet_daily_photo_replays,public.pet_photo_replay_requests to service_role;
revoke all on function public.prepare_pet_photo_unlock_album_v1(text,uuid,uuid,text,uuid),
  public.record_pet_photo_unlock_album_v1(text,date,uuid,uuid,text,uuid,uuid),public.get_pet_album_state_album_v1(text,uuid[]),
  public.authorize_pet_album_photo_album_v1(text,uuid),public.start_pet_album_ad_reward_album_v1(text,uuid,uuid),
  public.rebind_pet_album_ad_reward_album_v1(text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.prepare_pet_photo_unlock(text,uuid,uuid,text,uuid),
  public.record_pet_photo_unlock(text,date,uuid,uuid,text,uuid,uuid),public.get_pet_album_state(text,uuid[]),
  public.authorize_pet_album_photo(text,uuid),public.get_pet_photo_collection(text,uuid),public.get_collected_pet_photo_today(text,uuid),
  public.prepare_pet_photo_replay(text,uuid,uuid),public.record_pet_photo_replay(text,uuid,uuid,uuid),
  public.start_pet_album_ad_reward(text,uuid,uuid),public.rebind_pet_album_ad_reward(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_pet_photo_unlock(text,uuid,uuid,text,uuid),
  public.record_pet_photo_unlock(text,date,uuid,uuid,text,uuid,uuid),public.get_pet_album_state(text,uuid[]),
  public.authorize_pet_album_photo(text,uuid),public.get_pet_photo_collection(text,uuid),public.get_collected_pet_photo_today(text,uuid),
  public.prepare_pet_photo_replay(text,uuid,uuid),public.record_pet_photo_replay(text,uuid,uuid,uuid),
  public.start_pet_album_ad_reward(text,uuid,uuid),public.rebind_pet_album_ad_reward(text,uuid,uuid) to service_role;
commit;
