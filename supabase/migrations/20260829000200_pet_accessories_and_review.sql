-- Store reviewed accessory choices separately from PetTraitsV1. Existing pets
-- stay compatible (no accessory, design version 1), while every new v2
-- submission records whether the owner locked the choice or delegated it.
alter table public.pets
  add column if not exists accessory_selection_mode text not null default 'reviewer',
  add column if not exists accessory_required boolean not null default false,
  add column if not exists requested_accessory jsonb,
  add column if not exists published_accessory jsonb,
  add column if not exists design_version integer not null default 1,
  add column if not exists review_note text;

alter table public.pets
  drop constraint if exists pets_accessory_selection_mode_check,
  add constraint pets_accessory_selection_mode_check
    check (accessory_selection_mode in ('owner', 'reviewer')),
  drop constraint if exists pets_design_version_check,
  add constraint pets_design_version_check check (design_version >= 1),
  drop constraint if exists pets_review_note_length_check,
  add constraint pets_review_note_length_check
    check (review_note is null or char_length(review_note) <= 500);

create or replace function public.is_valid_pet_accessory(p_accessory jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_accessory is not null
    and jsonb_typeof(p_accessory) = 'object'
    and (p_accessory - array['kind', 'color', 'assetKey']) = '{}'::jsonb
    and p_accessory->>'kind' in ('ribbon', 'scarf', 'vest', 'ball')
    and p_accessory->>'color' in ('pink', 'sky', 'yellow', 'mint')
    and p_accessory->>'assetKey' = 'builtin:' || (p_accessory->>'kind');
$$;

alter table public.pets
  drop constraint if exists pets_requested_accessory_check,
  add constraint pets_requested_accessory_check
    check (requested_accessory is null or public.is_valid_pet_accessory(requested_accessory)),
  drop constraint if exists pets_published_accessory_check,
  add constraint pets_published_accessory_check
    check (published_accessory is null or public.is_valid_pet_accessory(published_accessory));

revoke all on function public.is_valid_pet_accessory(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_pet_accessory(jsonb) to service_role;

create or replace function public.register_pet_submission_v2(
  p_owner_hash text,
  p_submission_id uuid,
  p_pet_id uuid,
  p_storage_path text,
  p_name text,
  p_traits jsonb,
  p_reveal_date date,
  p_global_daily_limit integer,
  p_global_pending_limit integer,
  p_accessory_selection_mode text,
  p_requested_accessory jsonb default null
) returns table(pet_id uuid, reward_granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  owner_daily_count integer;
  owner_pending_count integer;
  global_daily_count integer;
  global_pending_count integer;
  reward_rows integer;
  day_start timestamptz;
  day_end timestamptz;
begin
  if p_global_daily_limit < 1 or p_global_pending_limit < 1 then
    raise exception 'INVALID_UPLOAD_LIMIT';
  end if;
  if p_accessory_selection_mode not in ('owner', 'reviewer') then
    raise exception 'INVALID_ACCESSORY_SELECTION_MODE';
  end if;
  if p_accessory_selection_mode = 'owner' and not public.is_valid_pet_accessory(p_requested_accessory) then
    raise exception 'OWNER_ACCESSORY_REQUIRED';
  end if;
  if p_accessory_selection_mode = 'reviewer' and p_requested_accessory is not null then
    raise exception 'REVIEWER_ACCESSORY_MUST_BE_EMPTY';
  end if;

  day_start := p_reveal_date::timestamp at time zone 'Asia/Seoul';
  day_end := (p_reveal_date + 1)::timestamp at time zone 'Asia/Seoul';

  perform pg_advisory_xact_lock(hashtextextended('pet-submit-global', 0));
  perform pg_advisory_xact_lock(hashtextextended('pet-submit-owner:' || p_owner_hash, 0));

  select p.id into existing_id
  from public.pets as p
  where p.owner_hash = p_owner_hash and p.submission_id = p_submission_id;

  if existing_id is not null then
    return query
      select existing_id, exists(
        select 1 from public.upload_rewards as ur where ur.pet_id = existing_id
      );
    return;
  end if;

  select count(*) into global_daily_count
  from public.pets as p
  where p.created_at >= day_start and p.created_at < day_end;
  if global_daily_count >= p_global_daily_limit then raise exception 'UPLOAD_CAPACITY_REACHED'; end if;

  select count(*) into global_pending_count from public.pets as p where p.status = 'pending';
  if global_pending_count >= p_global_pending_limit then raise exception 'UPLOAD_CAPACITY_REACHED'; end if;

  select count(*) into owner_daily_count
  from public.pets as p
  where p.owner_hash = p_owner_hash and p.created_at >= day_start and p.created_at < day_end;
  if owner_daily_count >= 1 then raise exception 'DAILY_UPLOAD_LIMIT_REACHED'; end if;

  select count(*) into owner_pending_count
  from public.pets as p
  where p.owner_hash = p_owner_hash and p.status = 'pending';
  if owner_pending_count >= 3 then raise exception 'PENDING_UPLOAD_LIMIT_REACHED'; end if;

  insert into public.pets(
    id, owner_hash, submission_id, name, storage_path, traits, status, moderation,
    accessory_selection_mode, accessory_required, requested_accessory,
    published_accessory, design_version
  ) values (
    p_pet_id, p_owner_hash, p_submission_id, p_name, p_storage_path, p_traits,
    'pending',
    jsonb_build_object(
      'automatic', 'not_run',
      'source', 'local_color_suggestion',
      'requiresHumanReview', true,
      'serverReencoded', true
    ),
    p_accessory_selection_mode, true, p_requested_accessory,
    case when p_accessory_selection_mode = 'owner' then p_requested_accessory else null end,
    1
  );

  insert into public.upload_rewards(owner_hash, reward_date, pet_id)
  values (p_owner_hash, p_reveal_date, p_pet_id)
  on conflict do nothing;
  get diagnostics reward_rows = row_count;

  if reward_rows = 1 then
    update public.pets set owner_pinned_pending = true where id = p_pet_id;
  end if;

  return query select p_pet_id, reward_rows = 1;
end;
$$;

revoke all on function public.register_pet_submission_v2(text,uuid,uuid,text,text,jsonb,date,integer,integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.register_pet_submission_v2(text,uuid,uuid,text,text,jsonb,date,integer,integer,text,jsonb)
  to service_role;

create or replace function public.review_pet_submission_v2(
  p_pet_id uuid,
  p_decision text,
  p_actor text,
  p_reason text default null,
  p_published_accessory jsonb default null,
  p_review_note text default null
) returns public.pet_status
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  next_status public.pet_status;
  current_pet public.pets%rowtype;
  final_accessory jsonb;
  next_design_version integer;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_REVIEW_DECISION'; end if;
  if nullif(trim(p_actor), '') is null then raise exception 'REVIEW_ACTOR_REQUIRED'; end if;
  if p_decision = 'rejected' and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;
  if char_length(coalesce(p_review_note, '')) > 500 then raise exception 'REVIEW_NOTE_TOO_LONG'; end if;

  select * into current_pet from public.pets where id = p_pet_id and status = 'pending' for update;
  if not found then raise exception 'PET_NOT_PENDING'; end if;

  if p_decision = 'approved' and not exists (
    select 1
    from public.pet_photos as photo
    join storage.objects as object
      on object.bucket_id = 'pet-photos' and object.name = photo.storage_path
    where photo.pet_id = p_pet_id and photo.is_active = true
  ) then raise exception 'PET_PHOTO_MISSING'; end if;

  if p_decision = 'approved' then
    if current_pet.accessory_required and current_pet.accessory_selection_mode = 'owner' then
      if p_published_accessory is not null and p_published_accessory <> current_pet.requested_accessory then
        raise exception 'OWNER_ACCESSORY_IMMUTABLE';
      end if;
      final_accessory := current_pet.requested_accessory;
    elsif current_pet.accessory_required and current_pet.accessory_selection_mode = 'reviewer' then
      if not public.is_valid_pet_accessory(p_published_accessory) then
        raise exception 'ACCESSORY_REVIEW_REQUIRED';
      end if;
      final_accessory := p_published_accessory;
    else
      if p_published_accessory is not null and not public.is_valid_pet_accessory(p_published_accessory) then
        raise exception 'INVALID_PET_ACCESSORY';
      end if;
      final_accessory := p_published_accessory;
    end if;
  else
    final_accessory := current_pet.published_accessory;
  end if;

  next_status := p_decision::public.pet_status;
  next_design_version := current_pet.design_version + case when next_status = 'approved' then 1 else 0 end;
  update public.pets
  set status = next_status,
      reviewed_at = now(),
      rejection_reason = case when next_status = 'rejected' then trim(p_reason) else null end,
      owner_pinned_pending = false,
      published_accessory = final_accessory,
      review_note = nullif(trim(coalesce(p_review_note, '')), ''),
      design_version = next_design_version
  where id = p_pet_id;

  insert into public.admin_audit_logs(pet_id, actor, action, detail)
  values (
    p_pet_id,
    trim(p_actor),
    'review_' || p_decision,
    jsonb_build_object(
      'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'publishedAccessory', final_accessory,
      'reviewNote', nullif(trim(coalesce(p_review_note, '')), ''),
      'designVersion', next_design_version
    )
  );

  return next_status;
end;
$$;

revoke all on function public.review_pet_submission_v2(uuid,text,text,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.review_pet_submission_v2(uuid,text,text,text,jsonb,text)
  to service_role;

-- Keep the original RPC available for legacy submissions. New delegated
-- submissions intentionally require the v2 console to choose an accessory.
create or replace function public.review_pet_submission(
  p_pet_id uuid,
  p_decision text,
  p_actor text,
  p_reason text default null
) returns public.pet_status
language sql
security definer
set search_path = public
as $$
  select public.review_pet_submission_v2(
    p_pet_id, p_decision, p_actor, p_reason, null::jsonb, null::text
  );
$$;

revoke all on function public.review_pet_submission(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.review_pet_submission(uuid,text,text,text)
  to service_role;

-- Include the currently published design in every consistent house snapshot.
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
  if nullif(p_owner_hash, '') is null or p_date is null then raise exception 'INVALID_HOUSE_SNAPSHOT_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  v_now := clock_timestamp();

  select allowance.free_remaining, allowance.next_free_at into v_free_remaining, v_next_free_at
  from public.get_pet_free_allowance(p_owner_hash) as allowance;

  select coalesce(jsonb_agg(jsonb_build_object(
    'petId', r.pet_id, 'unlockMethod', r.unlock_method, 'revealDate', r.reveal_date,
    'revisitUntil', r.revisit_until, 'createdAt', r.created_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_today_reveals from public.daily_reveals r
  where r.owner_hash = p_owner_hash and r.reveal_date = p_date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'petId', r.pet_id, 'unlockMethod', r.unlock_method, 'revealDate', r.reveal_date,
    'revisitUntil', r.revisit_until, 'createdAt', r.created_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_active_reveals from public.daily_reveals r
  where r.owner_hash = p_owner_hash and r.revisit_until > v_now;

  select jsonb_build_object('petId', reward.pet_id, 'usedAt', reward.used_at)
  into v_upload_reward from public.upload_rewards reward
  where reward.owner_hash = p_owner_hash and reward.reward_date = p_date limit 1;

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb) into v_owned_pets
  from (
    select pet.created_at, jsonb_build_object(
      'id', pet.id, 'name', pet.name, 'traits', pet.traits, 'status', pet.status,
      'ownerHash', pet.owner_hash, 'publishedAccessory', pet.published_accessory,
      'designVersion', pet.design_version
    ) item
    from public.pets pet
    where pet.owner_hash = p_owner_hash and pet.status in ('pending', 'approved')
      and exists (
        select 1 from public.pet_photos photo join storage.objects object
          on object.bucket_id = 'pet-photos' and object.name = photo.storage_path
        where photo.pet_id = pet.id and photo.is_active = true
      )
    order by pet.created_at desc limit 1
  ) owned;

  select coalesce(jsonb_agg(item order by reviewed_at desc, created_at desc), '[]'::jsonb) into v_approved_pets
  from (
    select pet.reviewed_at, pet.created_at, jsonb_build_object(
      'id', pet.id, 'name', pet.name, 'traits', pet.traits, 'status', pet.status,
      'ownerHash', pet.owner_hash, 'publishedAccessory', pet.published_accessory,
      'designVersion', pet.design_version
    ) item
    from public.pets pet
    where pet.status = 'approved' and pet.owner_hash <> p_owner_hash
      and coalesce(pet.reviewed_at, pet.created_at) < v_day_start
      and exists (
        select 1 from public.pet_photos photo join storage.objects object
          on object.bucket_id = 'pet-photos' and object.name = photo.storage_path
        where photo.pet_id = pet.id and photo.is_active = true
      )
    order by pet.reviewed_at desc nulls last, pet.created_at desc limit 200
  ) approved;

  select coalesce(jsonb_agg(item order by reveal_created_at desc), '[]'::jsonb) into v_active_pets
  from (
    select reveal.created_at reveal_created_at, jsonb_build_object(
      'id', pet.id, 'name', pet.name, 'traits', pet.traits, 'status', pet.status,
      'ownerHash', pet.owner_hash, 'publishedAccessory', pet.published_accessory,
      'designVersion', pet.design_version
    ) item
    from public.daily_reveals reveal join public.pets pet on pet.id = reveal.pet_id
    where reveal.owner_hash = p_owner_hash and reveal.revisit_until > v_now
      and (pet.status = 'approved' or (pet.owner_hash = p_owner_hash and pet.status = 'pending'))
      and exists (
        select 1 from public.pet_photos photo join storage.objects object
          on object.bucket_id = 'pet-photos' and object.name = photo.storage_path
        where photo.pet_id = pet.id and photo.is_active = true
      )
  ) active;

  return query select jsonb_build_object(
    'date', p_date,
    'freeAllowance', jsonb_build_object('remaining', v_free_remaining, 'nextChargeAt', v_next_free_at),
    'todayReveals', v_today_reveals, 'activeReveals', v_active_reveals,
    'uploadReward', v_upload_reward, 'ownedPets', v_owned_pets,
    'approvedPets', v_approved_pets, 'activePets', v_active_pets
  );
end;
$$;

revoke all on function public.get_pet_house_snapshot(text,date) from public, anon, authenticated;
grant execute on function public.get_pet_house_snapshot(text,date) to service_role;

-- The review console receives only the pending photo paths and a compact set
-- of similar already-approved characters. It never exposes owner identifiers.
drop view if exists public.pending_pet_review_queue;
create view public.pending_pet_review_queue
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
  coalesce(photos.photo_present, false) as photo_present,
  pet.accessory_selection_mode,
  pet.accessory_required,
  pet.requested_accessory,
  pet.published_accessory,
  pet.design_version,
  coalesce(similar_matches.items, '[]'::jsonb) as similar_pets
from public.pets as pet
left join lateral (
  select
    jsonb_agg(photo.storage_path order by photo.sort_order) filter (where photo.is_active) as paths,
    bool_or(object.id is not null) filter (where photo.is_active) as photo_present
  from public.pet_photos photo
  left join storage.objects object
    on object.bucket_id = 'pet-photos' and object.name = photo.storage_path
  where photo.pet_id = pet.id
) photos on true
left join lateral (
  select jsonb_agg(candidate.item order by candidate.score desc, candidate.name) as items
  from (
    select approved.name,
      ((approved.traits->>'baseColor' = pet.traits->>'baseColor')::int * 4
       + (approved.traits->>'earShape' = pet.traits->>'earShape')::int * 3
       + (approved.traits->>'headShape' = pet.traits->>'headShape')::int * 2
       + (approved.traits->>'markingPattern' = pet.traits->>'markingPattern')::int * 2
       + (approved.traits->>'muzzle' = pet.traits->>'muzzle')::int) as score,
      jsonb_build_object(
        'id', approved.id,
        'name', approved.name,
        'traits', approved.traits,
        'publishedAccessory', approved.published_accessory,
        'designVersion', approved.design_version
      ) as item
    from public.pets approved
    where approved.status = 'approved' and approved.id <> pet.id
    order by score desc, approved.created_at desc
    limit 3
  ) candidate
) similar_matches on true
where pet.status = 'pending';

revoke all on table public.pending_pet_review_queue from public, anon, authenticated;
grant select on table public.pending_pet_review_queue to service_role;

comment on column public.pets.requested_accessory is 'Owner-locked request. Immutable during review when selection mode is owner.';
comment on column public.pets.published_accessory is 'Draft accessory while pending and final reviewed accessory after approval.';
comment on column public.pets.design_version is 'Monotonic client cache version for the published character design.';
