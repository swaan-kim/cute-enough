-- New registrations contain one ordered set of 1..5 private photos. Existing
-- dogs, including creator-curated sets with more photos, are left untouched.
alter table public.pet_api_rate_limits drop constraint if exists pet_api_rate_limits_action_check;
alter table public.pet_api_rate_limits add constraint pet_api_rate_limits_action_check
  check(action in ('house','shared','mine','artwork','design','reveal','ownerPhoto','submit','submitPhoto','submissionStatus','report',
    'album','albumPhoto','setFavorite','rewardStart','rewardComplete','rewardCancel','rewardStatus',
    'rewardRebind','shareStart','shareReward','shareClose','notificationSettings','setNotificationSettings'));

create or replace function public.register_pet_submission_v4(
  p_owner_hash text,
  p_submission_id uuid,
  p_pet_id uuid,
  p_storage_paths text[],
  p_name text,
  p_traits jsonb,
  p_style jsonb,
  p_reveal_date date,
  p_global_daily_limit integer,
  p_global_pending_limit integer,
  p_accessory_selection_mode text,
  p_requested_accessory jsonb default null
) returns table(pet_id uuid, reward_granted boolean)
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_existing_id uuid;
  v_pet_id uuid;
  v_reward_granted boolean;
  v_photo record;
begin
  if nullif(p_owner_hash, '') is null or p_submission_id is null or p_pet_id is null then
    raise exception 'INVALID_SUBMISSION_INPUT';
  end if;
  -- Same lock order as v3/v2; retries return the whole original set without
  -- appending, replacing, rewarding again, or undoing a creator's review.
  perform pg_advisory_xact_lock(hashtextextended('pet-submit-global', 0));
  perform pg_advisory_xact_lock(hashtextextended('pet-submit-owner:' || p_owner_hash, 0));
  select p.id into v_existing_id from public.pets p
  where p.owner_hash = p_owner_hash and p.submission_id = p_submission_id;
  if v_existing_id is not null then
    return query select v_existing_id, exists (
      select 1 from public.upload_rewards r where r.pet_id = v_existing_id
    );
    return;
  end if;

  if p_storage_paths is null or cardinality(p_storage_paths) not between 1 and 5
    or array_ndims(p_storage_paths) <> 1 or array_lower(p_storage_paths, 1) <> 1 then
    raise exception 'INVALID_PHOTO_COUNT';
  end if;
  -- The first path remains pets.storage_path for installed legacy clients.
  -- Exact per-attempt paths prevent references to another user's stored photos.
  for v_photo in select path, ordinality from unnest(p_storage_paths) with ordinality as photo(path, ordinality)
  loop
    if v_photo.path is null or not (
      v_photo.path = p_owner_hash || '/' || p_submission_id::text
        || '/' || p_pet_id::text || '/' || (v_photo.ordinality - 1)::text || '.jpg'
      or (
        starts_with(v_photo.path, p_owner_hash || '/' || p_submission_id::text || '/staged/' || (v_photo.ordinality - 1)::text || '-')
        and v_photo.path ~ '/[0-4]-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jpg$'
      )
    ) then
      raise exception 'INVALID_PHOTO_PATH';
    end if;
    -- Keep confirmed Storage metadata alive for the registration transaction.
    perform 1 from storage.objects o
    where o.bucket_id = 'pet-photos' and o.name = v_photo.path for key share;
    if not found then raise exception 'PET_PHOTO_MISSING'; end if;
  end loop;

  -- v3 applies the existing dog/day, pending, capacity and single-credit rules.
  -- Its primary-photo trigger and every additional row share this transaction.
  select registered.pet_id, registered.reward_granted into v_pet_id, v_reward_granted
  from public.register_pet_submission_v3(
    p_owner_hash, p_submission_id, p_pet_id, p_storage_paths[1], p_name,
    p_traits, p_style, p_reveal_date, p_global_daily_limit, p_global_pending_limit,
    p_accessory_selection_mode, p_requested_accessory
  ) registered;
  insert into public.pet_photos(pet_id, storage_path, sort_order, is_active)
  select v_pet_id, photo.path, (photo.ordinality - 1)::smallint, true
  from unnest(p_storage_paths) with ordinality as photo(path, ordinality)
  where photo.ordinality > 1;

  return query select v_pet_id, v_reward_granted;
end;
$$;

revoke all on function public.register_pet_submission_v4(text,uuid,uuid,text[],text,jsonb,jsonb,date,integer,integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.register_pet_submission_v4(text,uuid,uuid,text[],text,jsonb,jsonb,date,integer,integer,text,jsonb)
  to service_role;

comment on table public.pet_photos is
  '검수 대기 또는 승인된 강아지의 비공개 원본 사진. 신규 제출은 순서가 있는 1~5장, 기존 제작자 선별 사진은 보존한다. 공개 열람은 강아지 승인 및 사진 접근 권한 검사 후에만 허용한다.';
