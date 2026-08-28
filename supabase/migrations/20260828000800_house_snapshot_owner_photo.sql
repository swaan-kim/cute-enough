-- Keep house state internally consistent, expose owner-only photo access, and
-- provide service-role-only review/integrity operations.

-- Keep rate limiting enforced for the new owner-only read action.
alter table public.pet_api_rate_limits
  drop constraint if exists pet_api_rate_limits_action_check;

alter table public.pet_api_rate_limits
  add constraint pet_api_rate_limits_action_check
  check (action in ('house', 'shared', 'mine', 'reveal', 'ownerPhoto', 'submit', 'submissionStatus', 'report'));

-- Only return photo rows whose private Storage object still exists. Edge
-- Functions use this instead of trusting pet_photos.is_active by itself.
create or replace function public.get_existing_pet_photos(
  p_pet_ids uuid[]
) returns table(pet_id uuid, storage_path text, sort_order smallint)
language sql
stable
security definer
set search_path = public, storage
as $$
  select photo.pet_id, photo.storage_path, photo.sort_order
  from public.pet_photos as photo
  join storage.objects as object
    on object.bucket_id = 'pet-photos'
   and object.name = photo.storage_path
  where photo.is_active = true
    and photo.pet_id = any(coalesce(p_pet_ids, '{}'::uuid[]))
  order by photo.pet_id, photo.sort_order;
$$;

revoke all on function public.get_existing_pet_photos(uuid[])
  from public, anon, authenticated;
grant execute on function public.get_existing_pet_photos(uuid[])
  to service_role;

-- One owner-wide advisory lock is shared with record_pet_reveal_v2. As a
-- result, allowance, upload reward, and active-revisit rows cannot represent
-- different sides of the same reveal transaction in a house response.
create or replace function public.get_pet_house_snapshot(
  p_owner_hash text,
  p_date date
) returns table(snapshot jsonb)
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_now timestamptz;
  v_day_start timestamptz := p_date::timestamp at time zone 'Asia/Seoul';
  v_free_remaining integer;
  v_next_free_at timestamptz;
  v_today_reveals jsonb;
  v_active_reveals jsonb;
  v_upload_reward jsonb;
  v_owned_pets jsonb;
  v_approved_pets jsonb;
  v_active_pets jsonb;
begin
  if nullif(p_owner_hash, '') is null or p_date is null then
    raise exception 'INVALID_HOUSE_SNAPSHOT_INPUT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  v_now := clock_timestamp();

  select allowance.free_remaining, allowance.next_free_at
    into v_free_remaining, v_next_free_at
  from public.get_pet_free_allowance(p_owner_hash) as allowance;

  select coalesce(jsonb_agg(row_data.item order by row_data.created_at desc), '[]'::jsonb)
    into v_today_reveals
  from (
    select reveal.created_at,
      jsonb_build_object(
        'petId', reveal.pet_id,
        'unlockMethod', reveal.unlock_method,
        'revealDate', reveal.reveal_date,
        'revisitUntil', reveal.revisit_until,
        'createdAt', reveal.created_at
      ) as item
    from public.daily_reveals as reveal
    where reveal.owner_hash = p_owner_hash
      and reveal.reveal_date = p_date
  ) as row_data;

  select coalesce(jsonb_agg(row_data.item order by row_data.created_at desc), '[]'::jsonb)
    into v_active_reveals
  from (
    select reveal.created_at,
      jsonb_build_object(
        'petId', reveal.pet_id,
        'unlockMethod', reveal.unlock_method,
        'revealDate', reveal.reveal_date,
        'revisitUntil', reveal.revisit_until,
        'createdAt', reveal.created_at
      ) as item
    from public.daily_reveals as reveal
    where reveal.owner_hash = p_owner_hash
      and reveal.revisit_until > v_now
  ) as row_data;

  select jsonb_build_object(
      'petId', reward.pet_id,
      'usedAt', reward.used_at
    )
    into v_upload_reward
  from public.upload_rewards as reward
  where reward.owner_hash = p_owner_hash
    and reward.reward_date = p_date
  limit 1;

  select coalesce(jsonb_agg(row_data.item order by row_data.created_at desc), '[]'::jsonb)
    into v_owned_pets
  from (
    select pet.created_at,
      jsonb_build_object(
        'id', pet.id,
        'name', pet.name,
        'traits', pet.traits,
        'status', pet.status,
        'ownerHash', pet.owner_hash
      ) as item
    from public.pets as pet
    where pet.owner_hash = p_owner_hash
      and pet.status in ('pending', 'approved')
      and exists (
        select 1
        from public.pet_photos as photo
        join storage.objects as object
          on object.bucket_id = 'pet-photos'
         and object.name = photo.storage_path
        where photo.pet_id = pet.id
          and photo.is_active = true
      )
    order by pet.created_at desc
    limit 1
  ) as row_data;

  select coalesce(jsonb_agg(row_data.item order by row_data.reviewed_at desc, row_data.created_at desc), '[]'::jsonb)
    into v_approved_pets
  from (
    select pet.reviewed_at, pet.created_at,
      jsonb_build_object(
        'id', pet.id,
        'name', pet.name,
        'traits', pet.traits,
        'status', pet.status,
        'ownerHash', pet.owner_hash
      ) as item
    from public.pets as pet
    where pet.status = 'approved'
      and pet.owner_hash <> p_owner_hash
      -- Approval is immediately visible through shared, but enters another
      -- user's deterministic house pool only on the following KST date.
      and coalesce(pet.reviewed_at, pet.created_at) < v_day_start
      and exists (
        select 1
        from public.pet_photos as photo
        join storage.objects as object
          on object.bucket_id = 'pet-photos'
         and object.name = photo.storage_path
        where photo.pet_id = pet.id
          and photo.is_active = true
      )
    order by pet.reviewed_at desc nulls last, pet.created_at desc
    limit 200
  ) as row_data;

  select coalesce(jsonb_agg(row_data.item order by row_data.reveal_created_at desc), '[]'::jsonb)
    into v_active_pets
  from (
    select reveal.created_at as reveal_created_at,
      jsonb_build_object(
        'id', pet.id,
        'name', pet.name,
        'traits', pet.traits,
        'status', pet.status,
        'ownerHash', pet.owner_hash
      ) as item
    from public.daily_reveals as reveal
    join public.pets as pet on pet.id = reveal.pet_id
    where reveal.owner_hash = p_owner_hash
      and reveal.revisit_until > v_now
      and (
        pet.status = 'approved'
        or (pet.owner_hash = p_owner_hash and pet.status = 'pending')
      )
      and exists (
        select 1
        from public.pet_photos as photo
        join storage.objects as object
          on object.bucket_id = 'pet-photos'
         and object.name = photo.storage_path
        where photo.pet_id = pet.id
          and photo.is_active = true
      )
  ) as row_data;

  return query select jsonb_build_object(
    'date', p_date,
    'freeAllowance', jsonb_build_object(
      'remaining', v_free_remaining,
      'nextChargeAt', v_next_free_at
    ),
    'todayReveals', v_today_reveals,
    'activeReveals', v_active_reveals,
    'uploadReward', v_upload_reward,
    'ownedPets', v_owned_pets,
    'approvedPets', v_approved_pets,
    'activePets', v_active_pets
  );
end;
$$;

revoke all on function public.get_pet_house_snapshot(text,date)
  from public, anon, authenticated;
grant execute on function public.get_pet_house_snapshot(text,date)
  to service_role;

-- Reviewers get one narrow service-role-only queue instead of browsing raw
-- user and allowance tables. Storage existence is shown explicitly.
create or replace view public.pending_pet_review_queue
with (security_barrier = true)
as
select
  pet.id as pet_id,
  pet.submission_id,
  pet.name,
  pet.traits,
  pet.created_at,
  pet.storage_path as primary_storage_path,
  coalesce(photos.paths, '[]'::jsonb) as storage_paths,
  coalesce(photos.photo_present, false) as photo_present
from public.pets as pet
left join lateral (
  select
    jsonb_agg(photo.storage_path order by photo.sort_order)
      filter (where photo.is_active) as paths,
    bool_or(object.id is not null) filter (where photo.is_active) as photo_present
  from public.pet_photos as photo
  left join storage.objects as object
    on object.bucket_id = 'pet-photos'
   and object.name = photo.storage_path
  where photo.pet_id = pet.id
) as photos on true
where pet.status = 'pending';

revoke all on table public.pending_pet_review_queue
  from public, anon, authenticated;
grant select on table public.pending_pet_review_queue
  to service_role;

-- Planned removals pause the character and deactivate every DB photo row in
-- the same transaction, so no share/house response can retain a dangling pet.
create or replace function public.pause_pet_publication(
  p_pet_id uuid,
  p_actor text,
  p_reason text default 'photo_unavailable'
) returns public.pet_status
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_actor), '') is null then
    raise exception 'REVIEW_ACTOR_REQUIRED';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'PAUSE_REASON_REQUIRED';
  end if;

  perform 1
  from public.pets
  where id = p_pet_id
    and status in ('pending', 'approved')
  for update;
  if not found then raise exception 'PET_NOT_PUBLISHABLE'; end if;

  update public.pet_photos
  set is_active = false
  where pet_id = p_pet_id
    and is_active = true;

  update public.pets
  set status = 'paused',
      owner_pinned_pending = false
  where id = p_pet_id;

  insert into public.admin_audit_logs(pet_id, actor, action, detail)
  values (
    p_pet_id,
    trim(p_actor),
    'pause_publication',
    jsonb_build_object('reason', trim(p_reason))
  );

  return 'paused'::public.pet_status;
end;
$$;

revoke all on function public.pause_pet_publication(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.pause_pet_publication(uuid,text,text)
  to service_role;

-- This can be run manually or on a scheduler. Missing Storage objects are
-- first deactivated and pets with no surviving photo are then paused/audited,
-- all within one transaction.
create or replace function public.reconcile_missing_pet_photos(
  p_actor text
) returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_paused_ids uuid[];
begin
  if nullif(trim(p_actor), '') is null then
    raise exception 'REVIEW_ACTOR_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pet-photo-integrity', 0));

  update public.pet_photos as photo
  set is_active = false
  where photo.is_active = true
    and not exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'pet-photos'
        and object.name = photo.storage_path
    );

  select coalesce(array_agg(pet.id), '{}'::uuid[])
    into v_paused_ids
  from public.pets as pet
  where pet.status in ('pending', 'approved')
    and not exists (
      select 1
      from public.pet_photos as photo
      join storage.objects as object
        on object.bucket_id = 'pet-photos'
       and object.name = photo.storage_path
      where photo.pet_id = pet.id
        and photo.is_active = true
    );

  update public.pets
  set status = 'paused',
      owner_pinned_pending = false
  where id = any(v_paused_ids);

  insert into public.admin_audit_logs(pet_id, actor, action, detail)
  select
    pet_id,
    trim(p_actor),
    'pause_missing_pet_photo',
    jsonb_build_object('reason', 'active storage object not found')
  from unnest(v_paused_ids) as pet_id;

  return cardinality(v_paused_ids);
end;
$$;

revoke all on function public.reconcile_missing_pet_photos(text)
  from public, anon, authenticated;
grant execute on function public.reconcile_missing_pet_photos(text)
  to service_role;
