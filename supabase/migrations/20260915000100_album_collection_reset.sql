-- Installs an operator-only, one-time reset. Installing this migration does NOT
-- reset a collection. Originals, purchases and all prior receipts are retained.
begin;

create schema pet_collection_reset_private;
revoke all on schema pet_collection_reset_private from public,anon,authenticated,service_role;

create table pet_collection_reset_private.runs (
  singleton boolean primary key default true check(singleton),
  reset_id uuid not null unique,
  reset_at timestamptz not null,
  manifest jsonb not null default '{}'::jsonb
);
create table pet_collection_reset_private.archived_rows (
  reset_id uuid not null references pet_collection_reset_private.runs(reset_id),
  source_table text not null,
  row_sha256 text not null check(row_sha256 ~ '^[0-9a-f]{64}$'),
  row_data jsonb not null,
  primary key(reset_id,source_table,row_sha256)
);
create table pet_collection_reset_private.request_tombstones (
  reset_id uuid not null references pet_collection_reset_private.runs(reset_id),
  owner_hash text not null,
  request_id uuid not null,
  request_kind text not null check(request_kind in ('collection','replay','legacy')),
  primary key(owner_hash,request_id,request_kind)
);
alter table pet_collection_reset_private.runs enable row level security;
alter table pet_collection_reset_private.archived_rows enable row level security;
alter table pet_collection_reset_private.request_tombstones enable row level security;
revoke all on all tables in schema pet_collection_reset_private from public,anon,authenticated,service_role;

-- Fingerprints contain counts and hashes only, never rows or user identifiers.
create function pet_collection_reset_private.fingerprint(p_table regclass,p_ignore text[] default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp set timezone='UTC' as $$
declare v_result jsonb;
begin
  execute format('select jsonb_build_object(''rows'',count(*),''sha256'',
    encode(sha256(convert_to(coalesce(string_agg(h,'''' order by h),''''),''UTF8'')),''hex''))
    from (select encode(sha256(convert_to((to_jsonb(r)-$1)::text,''UTF8'')),''hex'') h from %s r) s',p_table)
    into v_result using p_ignore;
  return v_result;
end;
$$;

create function pet_collection_reset_private.assert_current_request(p_owner_hash text,p_request_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  -- Acquire before any existing per-user locks. Reset takes the exclusive form
  -- so an in-flight request cannot pass the tombstone check across its cutoff.
  perform pg_advisory_xact_lock_shared(hashtextextended('pet-album-reset:20260915',0));
  if exists(select 1 from pet_collection_reset_private.request_tombstones
    where owner_hash=p_owner_hash and request_id=p_request_id) then
    -- Existing Edge v30 and album clients already recognize this expiry code.
    -- Unlike relying on the missing grant, this still rejects the old request
    -- after the viewer legitimately collects the same photo again.
    raise exception 'PET_REVISIT_EXPIRED: ALBUM_COLLECTION_RESET'
      using detail='Start a new encounter; this request belongs to the archived collection.';
  end if;
end;
$$;

alter function public.prepare_pet_photo_unlock(text,uuid,uuid,text,uuid) rename to prepare_pet_photo_unlock_pre_album_reset;
alter function public.record_pet_photo_unlock(text,date,uuid,uuid,text,uuid,uuid) rename to record_pet_photo_unlock_pre_album_reset;
alter function public.prepare_pet_photo_replay(text,uuid,uuid) rename to prepare_pet_photo_replay_pre_album_reset;
alter function public.record_pet_photo_replay(text,uuid,uuid,uuid) rename to record_pet_photo_replay_pre_album_reset;
alter function public.record_pet_reveal_v4(text,date,uuid,text,uuid,uuid) rename to record_pet_reveal_v4_pre_album_reset;

create function public.prepare_pet_photo_unlock(p_owner_hash text,p_pet_id uuid,p_request_id uuid,p_unlock_method text,p_ad_session_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pet_collection_reset_private.assert_current_request(p_owner_hash,p_request_id);
  return public.prepare_pet_photo_unlock_pre_album_reset(p_owner_hash,p_pet_id,p_request_id,p_unlock_method,p_ad_session_id);
end;
$$;
create function public.record_pet_photo_unlock(p_owner_hash text,p_reveal_date date,p_pet_id uuid,p_photo_id uuid,p_unlock_method text,p_request_id uuid,p_ad_session_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pet_collection_reset_private.assert_current_request(p_owner_hash,p_request_id);
  return public.record_pet_photo_unlock_pre_album_reset(p_owner_hash,p_reveal_date,p_pet_id,p_photo_id,p_unlock_method,p_request_id,p_ad_session_id);
end;
$$;
create function public.prepare_pet_photo_replay(p_owner_hash text,p_pet_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pet_collection_reset_private.assert_current_request(p_owner_hash,p_request_id);
  return public.prepare_pet_photo_replay_pre_album_reset(p_owner_hash,p_pet_id,p_request_id);
end;
$$;
create function public.record_pet_photo_replay(p_owner_hash text,p_pet_id uuid,p_request_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pet_collection_reset_private.assert_current_request(p_owner_hash,p_request_id);
  return public.record_pet_photo_replay_pre_album_reset(p_owner_hash,p_pet_id,p_request_id,p_photo_id);
end;
$$;
create function public.record_pet_reveal_v4(p_owner_hash text,p_reveal_date date,p_pet_id uuid,p_unlock_method text,p_request_id uuid,p_ad_session_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pet_collection_reset_private.assert_current_request(p_owner_hash,p_request_id);
  return public.record_pet_reveal_v4_pre_album_reset(p_owner_hash,p_reveal_date,p_pet_id,p_unlock_method,p_request_id,p_ad_session_id);
end;
$$;

create function public.reset_all_pet_album_collections(
  p_reset_id uuid,p_expected_unlocks bigint,p_expected_collectors bigint,p_confirmation text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,pg_temp set timezone='UTC' set lock_timeout='3s' set statement_timeout='30s' as $$
declare
  v_at timestamptz; v_date date; v_table text; v_count bigint; v_collectors bigint;
  v_before jsonb:='{}'; v_after jsonb:='{}'; v_archives jsonb; v_manifest jsonb;
  v_new_adoptions bigint; v_tombstones bigint;
  v_protected text[]:=array[
    'public.pets','public.pet_photos','storage.objects','public.pet_design_drafts','public.pet_design_versions',
    'public.pet_photo_review_audit','public.pet_photo_addition_submissions','public.pet_photo_addition_items',
    'public.reports','public.admin_audit_logs','public.pet_favorites','public.pet_free_allowances',
    'public.pet_bonus_accounts','public.upload_rewards','public.pet_ad_reward_sessions',
    'public.pet_share_reward_sessions','public.pet_share_reward_events','public.pet_reward_settings',
    'public.pet_album_legacy_gift_receipts','public.pet_photo_reveal_requests',
    'public.pet_photo_replay_requests','public.pet_reveal_requests'];
  v_locks text[];
begin
  if p_reset_id is null or p_expected_unlocks is null or p_expected_unlocks<0
    or p_expected_collectors is null or p_expected_collectors<0
    or p_confirmation is distinct from 'RESET_ALL_USER_ALBUMS_KEEP_REGISTERED_DOGS' then
    raise exception 'INVALID_ALBUM_RESET_INPUT';
  end if;
  -- Request-ID wrappers take the shared form before user locks. Table locks
  -- also fence old reveal RPCs without request IDs and every other writer.
  if not pg_try_advisory_xact_lock(hashtextextended('pet-album-reset:20260915',0)) then
    raise exception 'ALBUM_RESET_BUSY';
  end if;
  if exists(select 1 from pet_collection_reset_private.runs) then
    raise exception 'ALBUM_RESET_ALREADY_APPLIED';
  end if;
  v_locks:=v_protected||array['public.user_photo_unlocks','public.pet_daily_photo_collections',
    'public.pet_daily_photo_replays','public.pet_album_adoptions','public.daily_reveals','public.daily_house_assignments'];
  -- SHARE ROW EXCLUSIVE conflicts with each writer's ROW EXCLUSIVE lock while
  -- allowing plain reads. All locks are acquired before determining the cutoff.
  -- No user advisory lock is taken here: a writer may already own that lock
  -- while waiting for one of these tables. A timeout/deadlock aborts atomically.
  for v_table in select distinct t from unnest(v_locks) t order by t loop
    execute format('lock table %s in share row exclusive mode',v_table::regclass);
  end loop;
  v_at:=clock_timestamp(); v_date:=(v_at at time zone 'Asia/Seoul')::date;
  select count(*),count(distinct owner_hash) into v_count,v_collectors from public.user_photo_unlocks;
  if v_count<>p_expected_unlocks or v_collectors<>p_expected_collectors then
    raise exception 'ALBUM_RESET_COUNTS_CHANGED';
  end if;
  foreach v_table in array v_protected loop
    v_before:=v_before||jsonb_build_object(v_table,pet_collection_reset_private.fingerprint(v_table::regclass));
  end loop;
  v_before:=v_before||jsonb_build_object(
    'public.daily_reveals_except_access',pet_collection_reset_private.fingerprint('public.daily_reveals',array['revisit_until']),
    'public.house_assignments_except_progress',pet_collection_reset_private.fingerprint('public.daily_house_assignments',array['met_at','met_pet_id']));
  insert into pet_collection_reset_private.runs(reset_id,reset_at) values(p_reset_id,v_at);

  foreach v_table in array array['public.user_photo_unlocks','public.pet_daily_photo_collections','public.pet_daily_photo_replays'] loop
    execute format('insert into pet_collection_reset_private.archived_rows(reset_id,source_table,row_sha256,row_data)
      select $1,$2,encode(sha256(convert_to(to_jsonb(r)::text,''UTF8'')),''hex''),to_jsonb(r) from %s r',v_table::regclass)
      using p_reset_id,v_table;
  end loop;
  insert into pet_collection_reset_private.archived_rows(reset_id,source_table,row_sha256,row_data)
    select p_reset_id,'public.daily_reveals',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),to_jsonb(r)
    from public.daily_reveals r where revisit_until>v_at;
  insert into pet_collection_reset_private.archived_rows(reset_id,source_table,row_sha256,row_data)
    select p_reset_id,'public.daily_house_assignments',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),to_jsonb(r)
    from public.daily_house_assignments r where assignment_date=v_date and (met_at is not null or met_pet_id is not null);

  -- Seal the legacy adoption path before removing grants. Keep both existing
  -- adoption markers and gift receipts, including withdrawn photo identities.
  with historical as (
    select owner_hash from public.user_photo_unlocks union select owner_hash from public.daily_reveals
    union select owner_hash from public.pet_photo_reveal_requests union select owner_hash from public.pet_photo_replay_requests
    union select owner_hash from public.pet_reveal_requests union select owner_hash from public.pet_album_legacy_gift_receipts
  ), added as (
    insert into public.pet_album_adoptions(owner_hash,adopted_at)
      select owner_hash,v_at from historical on conflict(owner_hash) do nothing returning *
  ) insert into pet_collection_reset_private.archived_rows(reset_id,source_table,row_sha256,row_data)
    select p_reset_id,'public.pet_album_adoptions_added',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),to_jsonb(a) from added a;
  get diagnostics v_new_adoptions=row_count;
  insert into pet_collection_reset_private.request_tombstones(reset_id,owner_hash,request_id,request_kind)
    select p_reset_id,owner_hash,request_id,'collection' from public.pet_photo_reveal_requests
    union all select p_reset_id,owner_hash,request_id,'replay' from public.pet_photo_replay_requests
    union all select p_reset_id,owner_hash,request_id,'legacy' from public.pet_reveal_requests;
  get diagnostics v_tombstones=row_count;

  delete from public.user_photo_unlocks;
  delete from public.pet_daily_photo_collections;
  delete from public.pet_daily_photo_replays;
  update public.daily_reveals set revisit_until=v_at where revisit_until>v_at;
  update public.daily_house_assignments set met_at=null,met_pet_id=null
    where assignment_date=v_date and (met_at is not null or met_pet_id is not null);

  foreach v_table in array v_protected loop
    v_after:=v_after||jsonb_build_object(v_table,pet_collection_reset_private.fingerprint(v_table::regclass));
  end loop;
  v_after:=v_after||jsonb_build_object(
    'public.daily_reveals_except_access',pet_collection_reset_private.fingerprint('public.daily_reveals',array['revisit_until']),
    'public.house_assignments_except_progress',pet_collection_reset_private.fingerprint('public.daily_house_assignments',array['met_at','met_pet_id']));
  if v_before is distinct from v_after then raise exception 'ALBUM_RESET_PRESERVATION_FAILED'; end if;
  if exists(select 1 from public.user_photo_unlocks) or exists(select 1 from public.pet_daily_photo_collections)
    or exists(select 1 from public.pet_daily_photo_replays) then raise exception 'ALBUM_RESET_INCOMPLETE'; end if;
  select coalesce(jsonb_object_agg(source_table,summary),'{}') into v_archives from (
    select source_table,jsonb_build_object('rows',count(*),'sha256',
      encode(sha256(convert_to(string_agg(row_sha256,'' order by row_sha256),'UTF8')),'hex')) summary
    from pet_collection_reset_private.archived_rows where reset_id=p_reset_id group by source_table
  ) s;
  v_manifest:=jsonb_build_object('resetId',p_reset_id,'resetAt',v_at,'collectionUsers',v_collectors,
    'archived',v_archives,'adoptionMarkersAdded',v_new_adoptions,'requestTombstones',v_tombstones,
    'preservedBefore',v_before,'preservedAfter',v_after,'preservationVerified',true);
  update pet_collection_reset_private.runs set manifest=v_manifest where reset_id=p_reset_id;
  return v_manifest;
end;
$$;

create function public.get_pet_album_collection_reset_status()
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
  select (select manifest from pet_collection_reset_private.runs where singleton);
$$;

revoke all on all functions in schema pet_collection_reset_private from public,anon,authenticated,service_role;
revoke all on function public.prepare_pet_photo_unlock_pre_album_reset(text,uuid,uuid,text,uuid),
  public.record_pet_photo_unlock_pre_album_reset(text,date,uuid,uuid,text,uuid,uuid),
  public.prepare_pet_photo_replay_pre_album_reset(text,uuid,uuid),
  public.record_pet_photo_replay_pre_album_reset(text,uuid,uuid,uuid),
  public.record_pet_reveal_v4_pre_album_reset(text,date,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.prepare_pet_photo_unlock(text,uuid,uuid,text,uuid),
  public.record_pet_photo_unlock(text,date,uuid,uuid,text,uuid,uuid),
  public.prepare_pet_photo_replay(text,uuid,uuid),public.record_pet_photo_replay(text,uuid,uuid,uuid),
  public.record_pet_reveal_v4(text,date,uuid,text,uuid,uuid),
  public.reset_all_pet_album_collections(uuid,bigint,bigint,text),public.get_pet_album_collection_reset_status()
  from public,anon,authenticated;
grant execute on function public.prepare_pet_photo_unlock(text,uuid,uuid,text,uuid),
  public.record_pet_photo_unlock(text,date,uuid,uuid,text,uuid,uuid),
  public.prepare_pet_photo_replay(text,uuid,uuid),public.record_pet_photo_replay(text,uuid,uuid,uuid),
  public.record_pet_reveal_v4(text,date,uuid,text,uuid,uuid),
  public.reset_all_pet_album_collections(uuid,bigint,bigint,text),public.get_pet_album_collection_reset_status()
  to service_role;

commit;
