begin;

-- An album credit buys an unseen photo. Already collected photos cannot keep
-- that credit bound after its last unseen source is withdrawn. Daily collection
-- and house eligibility remain target checks, not reasons to move a credit.
create function public.is_pet_album_reward_photo_available(p_owner_hash text,p_pet_id uuid)
returns boolean language sql stable security definer set search_path=public,storage as $$
  select exists (
    select 1 from public.pets pet
    join public.pet_photos photo on photo.pet_id=pet.id and photo.is_active
    join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
    where pet.id=p_pet_id and pet.status='approved' and pet.owner_hash<>p_owner_hash
      and not exists (select 1 from public.user_photo_unlocks unlocked
        where unlocked.owner_hash=p_owner_hash and unlocked.photo_id=photo.id)
  );
$$;

-- Keep the existing RPC and legacy rebind semantics unchanged. Album-aware
-- clients opt into this additive status RPC, including for existing credits.
create function public.get_pet_album_reward_state(p_owner_hash text)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_state jsonb; v_ads jsonb;
begin
  v_state:=public.get_pet_reward_state(p_owner_hash);
  select coalesce(jsonb_agg(reward.value||jsonb_build_object(
    'canRebind',session.rebound_at is null and
      not public.is_pet_album_reward_photo_available(p_owner_hash,session.pet_id)
  ) order by reward.ordinality),'[]'::jsonb) into v_ads
  from jsonb_array_elements(v_state->'adRewards') with ordinality reward(value,ordinality)
  join public.pet_ad_reward_sessions session on session.id=(reward.value->>'sessionId')::uuid
    and session.owner_hash=p_owner_hash;
  return jsonb_set(v_state,'{adRewards}',v_ads);
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
    where id=p_session_id and owner_hash=p_owner_hash for update;
  if not found then raise exception 'AD_SESSION_NOT_FOUND'; end if;
  if v_session.status<>'completed' then raise exception 'AD_REWARD_UNAVAILABLE'; end if;
  if v_session.pet_id=p_pet_id then
    return public.get_pet_album_reward_state(p_owner_hash)||jsonb_build_object('sessionId',p_session_id);
  end if;
  if v_session.rebound_at is not null
    or public.is_pet_album_reward_photo_available(p_owner_hash,v_session.pet_id)
    then raise exception 'AD_REWARD_RESELECT_UNAVAILABLE'; end if;
  if exists(select 1 from public.pet_daily_photo_collections where owner_hash=p_owner_hash
    and pet_id=p_pet_id and collection_date=(clock_timestamp() at time zone 'Asia/Seoul')::date)
    then raise exception 'DAILY_PHOTO_ALREADY_COLLECTED'; end if;
  -- The existing preparation checks approval, storage, ownership, unseen photos
  -- and today's house assignment before the credit can move to the target.
  perform public.prepare_pet_photo_unlock(p_owner_hash,p_pet_id,gen_random_uuid(),'REWARDED',p_session_id);
  update public.pet_ad_reward_sessions set pet_id=p_pet_id,rebound_at=clock_timestamp()
    where id=p_session_id;
  return public.get_pet_album_reward_state(p_owner_hash)||jsonb_build_object('sessionId',p_session_id);
end;
$$;

revoke all on function public.is_pet_album_reward_photo_available(text,uuid),
  public.get_pet_album_reward_state(text),public.rebind_pet_album_ad_reward(text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_pet_album_reward_state(text),
  public.rebind_pet_album_ad_reward(text,uuid,uuid) to service_role;
-- The availability predicate is only called inside owner-checking definer RPCs.
revoke all on function public.is_pet_album_reward_photo_available(text,uuid) from service_role;

commit;
