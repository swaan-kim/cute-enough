-- Reduce the daily public house from five friends to four without touching pet,
-- photo, upload, approval, or audit records. Only the disposable fifth daily
-- assignment slot is removed.

delete from public.daily_house_assignments
where slot = 5;

alter table public.daily_house_assignments
  drop constraint if exists daily_house_assignments_slot_check;
alter table public.daily_house_assignments
  add constraint daily_house_assignments_slot_check check (slot between 1 and 4);

-- Separate earned slot progress from the pet currently occupying that slot.
-- met_pet_id deliberately has no foreign key: removing a moderated pet must not
-- erase progress already earned for the viewer/date.
alter table public.daily_house_assignments
  add column if not exists met_pet_id uuid;

-- Before this migration met_at always referred to the row's current pet_id.
update public.daily_house_assignments
set met_pet_id = pet_id
where met_at is not null
  and met_pet_id is null;

create or replace function public.get_pet_house_snapshot_v2(
  p_owner_hash text,
  p_date date
) returns table(snapshot jsonb)
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_day_start timestamptz := p_date::timestamp at time zone 'Asia/Seoul';
  v_created boolean := false;
  v_slot smallint;
  v_candidate_id uuid;
  v_free_remaining integer;
  v_next_free_at timestamptz;
  v_today_reveals jsonb;
  v_active_reveals jsonb;
  v_upload_reward jsonb;
  v_daily_pets jsonb;
  v_owner_bonus_pet_id uuid;
  v_owner_bonus_pet jsonb;
  v_met_pet_ids jsonb;
  v_met_count integer;
begin
  if nullif(p_owner_hash, '') is null or p_date is null then
    raise exception 'INVALID_HOUSE_SNAPSHOT_INPUT';
  end if;

  -- One viewer/date lock makes initial creation and vacancy repair deterministic.
  perform pg_advisory_xact_lock(
    hashtextextended('daily-house-v2:' || p_owner_hash || ':' || p_date::text, 0)
  );

  -- The latest owner pet is the separate bonus friend. Every owned pet is free
  -- through the owner's history, so older uploads cannot occupy paid public
  -- slots or count toward public progress either.
  select pet.id into v_owner_bonus_pet_id
  from public.pets pet
  where pet.owner_hash = p_owner_hash
    and pet.status in ('pending', 'approved')
    and exists (
      select 1
      from public.pet_photos photo
      join storage.objects object
        on object.bucket_id = 'pet-photos'
       and object.name = photo.storage_path
      where photo.pet_id = pet.id
        and photo.is_active = true
    )
  order by pet.created_at desc
  limit 1;

  if not exists (
    select 1 from public.daily_house_assignments assignment
    where assignment.owner_hash = p_owner_hash
      and assignment.assignment_date = p_date
  ) then
    v_created := true;
    insert into public.daily_house_assignments(owner_hash, assignment_date, slot)
    select p_owner_hash, p_date, generated_slot
    from generate_series(1, 4) as slots(generated_slot);
  end if;

  -- A paused/deleted pet or a missing Storage object vacates only its slot. Keep
  -- met_at/met_pet_id so moderation cannot reduce progress already earned today.
  update public.daily_house_assignments assignment
  set pet_id = null,
      replacement_pending = true,
      assigned_at = v_now
  where assignment.owner_hash = p_owner_hash
    and assignment.assignment_date = p_date
    and assignment.pet_id is not null
    and not exists (
      select 1
      from public.pets pet
      where pet.id = assignment.pet_id
        and pet.status = 'approved'
        and pet.owner_hash <> p_owner_hash
        -- An approval is available through its share link immediately, but it
        -- joins public houses only from the next KST date.
        and coalesce(pet.reviewed_at, pet.created_at) < v_day_start
        and exists (
          select 1
          from public.pet_photos photo
          join storage.objects object
            on object.bucket_id = 'pet-photos'
           and object.name = photo.storage_path
          where photo.pet_id = pet.id
            and photo.is_active = true
        )
    );

  -- Fill every slot only on first creation. On later requests, fill only slots
  -- vacated by an unavailable pet; an initially empty slot remains stable today.
  for v_slot in
    select assignment.slot
    from public.daily_house_assignments assignment
    where assignment.owner_hash = p_owner_hash
      and assignment.assignment_date = p_date
      and assignment.pet_id is null
      and (v_created or assignment.replacement_pending or assignment.was_assigned)
    order by assignment.slot
  loop
    select pet.id into v_candidate_id
    from public.pets pet
    where pet.status = 'approved'
      and pet.owner_hash <> p_owner_hash
      and coalesce(pet.reviewed_at, pet.created_at) < v_day_start
      and exists (
        select 1
        from public.pet_photos photo
        join storage.objects object
          on object.bucket_id = 'pet-photos'
         and object.name = photo.storage_path
        where photo.pet_id = pet.id
          and photo.is_active = true
      )
      and not exists (
        select 1
        from public.daily_house_assignments occupied
        where occupied.owner_hash = p_owner_hash
          and occupied.assignment_date = p_date
          and occupied.pet_id = pet.id
      )
    order by
      case when exists (
        select 1 from public.daily_reveals reveal
        where reveal.owner_hash = p_owner_hash
          and reveal.pet_id = pet.id
          and reveal.revisit_until > v_now
      ) then 0 else 1 end,
      md5('daily-house-v2:' || p_owner_hash || ':' || p_date::text || ':' || pet.id::text),
      pet.id
    limit 1;

    if v_candidate_id is not null then
      update public.daily_house_assignments assignment
      set pet_id = v_candidate_id,
          assigned_at = v_now,
          was_assigned = true,
          replacement_pending = false
      where assignment.owner_hash = p_owner_hash
        and assignment.assignment_date = p_date
        and assignment.slot = v_slot;
    end if;
    v_candidate_id := null;
  end loop;

  select allowance.free_remaining, allowance.next_free_at
    into v_free_remaining, v_next_free_at
  from public.get_pet_free_allowance(p_owner_hash) allowance;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'petId', reveal.pet_id,
      'unlockMethod', reveal.unlock_method,
      'revealDate', reveal.reveal_date,
      'revisitUntil', reveal.revisit_until,
      'createdAt', reveal.created_at
    ) order by reveal.created_at desc
  ), '[]'::jsonb)
  into v_today_reveals
  from public.daily_reveals reveal
  where reveal.owner_hash = p_owner_hash
    and reveal.reveal_date = p_date;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'petId', reveal.pet_id,
      'unlockMethod', reveal.unlock_method,
      'revealDate', reveal.reveal_date,
      'revisitUntil', reveal.revisit_until,
      'createdAt', reveal.created_at
    ) order by reveal.created_at desc
  ), '[]'::jsonb)
  into v_active_reveals
  from public.daily_reveals reveal
  where reveal.owner_hash = p_owner_hash
    and reveal.revisit_until > v_now;

  select jsonb_build_object('petId', reward.pet_id, 'usedAt', reward.used_at)
    into v_upload_reward
  from public.upload_rewards reward
  where reward.owner_hash = p_owner_hash
    and reward.reward_date = p_date
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', pet.id,
      'name', pet.name,
      'traits', pet.traits,
      'status', pet.status,
      'ownerHash', pet.owner_hash,
      'publishedAccessory', pet.published_accessory,
      'publishedStyle', pet.published_style,
      'designVersion', pet.design_version,
      'slot', assignment.slot,
      -- A replacement occupying an already-met slot is still a new friend.
      'metAt', case
        when assignment.met_pet_id = assignment.pet_id then assignment.met_at
        else null
      end
    ) order by assignment.slot
  ), '[]'::jsonb)
  into v_daily_pets
  from public.daily_house_assignments assignment
  join public.pets pet on pet.id = assignment.pet_id
  where assignment.owner_hash = p_owner_hash
    and assignment.assignment_date = p_date;

  select jsonb_build_object(
    'id', pet.id,
    'name', pet.name,
    'traits', pet.traits,
    'status', pet.status,
    'ownerHash', pet.owner_hash,
    'publishedAccessory', pet.published_accessory,
    'publishedStyle', pet.published_style,
    'designVersion', pet.design_version,
    'viewedToday', exists (
      select 1 from public.daily_pet_views pet_view
      where pet_view.owner_hash = p_owner_hash
        and pet_view.view_date = p_date
        and pet_view.pet_id = pet.id
    )
  ) into v_owner_bonus_pet
  from public.pets pet
  where pet.id = v_owner_bonus_pet_id
    and pet.owner_hash = p_owner_hash
    and pet.status in ('pending', 'approved')
    and exists (
      select 1
      from public.pet_photos photo
      join storage.objects object
        on object.bucket_id = 'pet-photos'
       and object.name = photo.storage_path
      where photo.pet_id = pet.id
        and photo.is_active = true
    )
  limit 1;

  select
    coalesce(jsonb_agg(assignment.met_pet_id order by assignment.slot)
      filter (where assignment.met_at is not null and assignment.met_pet_id is not null), '[]'::jsonb),
    count(*) filter (where assignment.met_at is not null)
  into v_met_pet_ids, v_met_count
  from public.daily_house_assignments assignment
  where assignment.owner_hash = p_owner_hash
    and assignment.assignment_date = p_date;

  return query select jsonb_build_object(
    'date', p_date,
    'freeAllowance', jsonb_build_object(
      'remaining', v_free_remaining,
      'nextChargeAt', v_next_free_at
    ),
    'todayReveals', v_today_reveals,
    'activeReveals', v_active_reveals,
    'uploadReward', v_upload_reward,
    'dailyPets', v_daily_pets,
    'ownerBonusPet', v_owner_bonus_pet,
    'dailyProgress', jsonb_build_object(
      'date', p_date,
      'metPetIds', v_met_pet_ids,
      'metCount', v_met_count,
      'totalCount', 4,
      'completed', v_met_count >= 4
    )
  );
end;
$$;

revoke all on function public.get_pet_house_snapshot_v2(text,date)
  from public, anon, authenticated;
grant execute on function public.get_pet_house_snapshot_v2(text,date)
  to service_role;

-- Record progress only after a public photo URL has been successfully created.
-- Calling the snapshot first also handles a shared-link reveal before home opens:
-- the active revisit is prioritized into that day's initial assignment.
create or replace function public.mark_daily_house_pet_met(
  p_owner_hash text,
  p_date date,
  p_pet_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  ignored_snapshot jsonb;
  v_met_pet_ids jsonb;
  v_met_count integer;
begin
  if nullif(p_owner_hash, '') is null or p_date is null or p_pet_id is null then
    raise exception 'INVALID_DAILY_HOUSE_PROGRESS_INPUT';
  end if;

  if not exists (
    select 1 from public.daily_house_assignments assignment
    where assignment.owner_hash = p_owner_hash
      and assignment.assignment_date = p_date
  ) then
    select house.snapshot into ignored_snapshot
    from public.get_pet_house_snapshot_v2(p_owner_hash, p_date) house;
  end if;

  update public.daily_house_assignments assignment
  set met_pet_id = case
        when assignment.met_at is null then p_pet_id
        else assignment.met_pet_id
      end,
      met_at = coalesce(assignment.met_at, clock_timestamp())
  where assignment.owner_hash = p_owner_hash
    and assignment.assignment_date = p_date
    and assignment.pet_id = p_pet_id;

  select
    coalesce(jsonb_agg(assignment.met_pet_id order by assignment.slot)
      filter (where assignment.met_at is not null and assignment.met_pet_id is not null), '[]'::jsonb),
    count(*) filter (where assignment.met_at is not null)
  into v_met_pet_ids, v_met_count
  from public.daily_house_assignments assignment
  where assignment.owner_hash = p_owner_hash
    and assignment.assignment_date = p_date;

  return jsonb_build_object(
    'date', p_date,
    'metPetIds', v_met_pet_ids,
    'metCount', v_met_count,
    'totalCount', 4,
    'completed', v_met_count >= 4
  );
end;
$$;

revoke all on function public.mark_daily_house_pet_met(text,date,uuid)
  from public, anon, authenticated;
grant execute on function public.mark_daily_house_pet_met(text,date,uuid)
  to service_role;
