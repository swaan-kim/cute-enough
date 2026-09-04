-- Preserve the owner's submitted character separately from the reviewed design.
-- PetTraitsV1 stays unchanged; outline, coat mode and optional expression live in PetStyleV1.
alter table public.pets
  add column if not exists submitted_traits jsonb,
  add column if not exists submitted_style jsonb,
  add column if not exists published_style jsonb;

create or replace function public.infer_pet_style_v1(p_traits jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'coatMode', case
      when p_traits->>'baseColor' = p_traits->>'secondaryColor'
        and p_traits->>'markingPattern' = 'none' then 'solid'
      else 'point'
    end,
    'furStyle', 'neat'
  );
$$;

create or replace function public.is_valid_pet_traits_v1(p_traits jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_traits is not null
    and jsonb_typeof(p_traits) = 'object'
    and (p_traits - array['schemaVersion','earShape','headShape','baseColor','secondaryColor','markingPattern','muzzle','confidence']) = '{}'::jsonb
    and p_traits->>'schemaVersion' = '1'
    and p_traits->>'earShape' in ('floppy','upright','semi','rounded')
    and p_traits->>'headShape' in ('round','oval','long')
    and p_traits->>'baseColor' in ('cream','caramel','chocolate','black','gray','white')
    and p_traits->>'secondaryColor' in ('cream','caramel','chocolate','black','gray','white')
    and p_traits->>'markingPattern' in ('none','brow','mask','blaze','spots')
    and p_traits->>'muzzle' in ('short','medium','long')
    and jsonb_typeof(p_traits->'confidence') = 'number'
    and (p_traits->>'confidence')::numeric between 0 and 1;
$$;

create or replace function public.is_valid_pet_style_v1(p_style jsonb, p_traits jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_style is not null
    and jsonb_typeof(p_style) = 'object'
    and (p_style - array['schemaVersion','coatMode','furStyle','expression']) = '{}'::jsonb
    and p_style->>'schemaVersion' = '1'
    and p_style->>'coatMode' in ('solid','point')
    and p_style->>'furStyle' in ('neat','fluffy','cloud')
    and (
      not (p_style ? 'expression')
      or (
        jsonb_typeof(p_style->'expression') = 'object'
        and ((p_style->'expression') - array['browStyle','tongueShape']) = '{}'::jsonb
        and p_style->'expression'->>'browStyle' in ('none','soft','caterpillar','angled')
        and p_style->'expression'->>'tongueShape' in ('drop','round','wide','side')
      )
    )
    and (
      (p_style->>'coatMode' = 'solid'
        and p_traits->>'baseColor' = p_traits->>'secondaryColor'
        and p_traits->>'markingPattern' = 'none')
      or
      (p_style->>'coatMode' = 'point'
        and p_traits->>'baseColor' <> p_traits->>'secondaryColor')
    );
$$;

update public.pets
set submitted_traits = coalesce(submitted_traits, traits),
    submitted_style = coalesce(submitted_style, public.infer_pet_style_v1(coalesce(submitted_traits, traits))),
    published_style = coalesce(published_style, public.infer_pet_style_v1(traits));

alter table public.pets
  drop constraint if exists pets_submitted_traits_v1_check,
  add constraint pets_submitted_traits_v1_check check (submitted_traits is null or public.is_valid_pet_traits_v1(submitted_traits)),
  drop constraint if exists pets_traits_v1_check,
  add constraint pets_traits_v1_check check (public.is_valid_pet_traits_v1(traits)),
  drop constraint if exists pets_submitted_style_v1_check,
  add constraint pets_submitted_style_v1_check check (submitted_style is null or public.is_valid_pet_style_v1(submitted_style, submitted_traits)),
  drop constraint if exists pets_published_style_v1_check,
  add constraint pets_published_style_v1_check check (published_style is null or public.is_valid_pet_style_v1(published_style, traits));

revoke all on function public.infer_pet_style_v1(jsonb) from public, anon, authenticated;
revoke all on function public.is_valid_pet_traits_v1(jsonb) from public, anon, authenticated;
revoke all on function public.is_valid_pet_style_v1(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.infer_pet_style_v1(jsonb) to service_role;
grant execute on function public.is_valid_pet_traits_v1(jsonb) to service_role;
grant execute on function public.is_valid_pet_style_v1(jsonb,jsonb) to service_role;

create or replace function public.register_pet_submission_v3(
  p_owner_hash text,
  p_submission_id uuid,
  p_pet_id uuid,
  p_storage_path text,
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
set search_path = public
as $$
declare
  v_pet_id uuid;
  v_reward_granted boolean;
begin
  if not public.is_valid_pet_traits_v1(p_traits)
    or not public.is_valid_pet_style_v1(p_style, p_traits) then
    raise exception 'INVALID_PET_DESIGN';
  end if;

  select registered.pet_id, registered.reward_granted
    into v_pet_id, v_reward_granted
  from public.register_pet_submission_v2(
    p_owner_hash, p_submission_id, p_pet_id, p_storage_path, p_name, p_traits,
    p_reveal_date, p_global_daily_limit, p_global_pending_limit,
    p_accessory_selection_mode, p_requested_accessory
  ) registered;

  update public.pets
  set submitted_traits = p_traits,
      submitted_style = p_style,
      published_style = p_style
  where id = v_pet_id;

  return query select v_pet_id, v_reward_granted;
end;
$$;

revoke all on function public.register_pet_submission_v3(text,uuid,uuid,text,text,jsonb,jsonb,date,integer,integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.register_pet_submission_v3(text,uuid,uuid,text,text,jsonb,jsonb,date,integer,integer,text,jsonb)
  to service_role;

create or replace function public.pet_design_similarity_score(
  p_traits jsonb,
  p_style jsonb,
  p_other_traits jsonb,
  p_other_style jsonb
) returns integer
language sql
immutable
set search_path = public
as $$
  select
    ((p_traits->>'baseColor' = p_other_traits->>'baseColor')::int * 24)
    + ((p_traits->>'earShape' = p_other_traits->>'earShape')::int * 18)
    + ((p_traits->>'headShape' = p_other_traits->>'headShape')::int * 14)
    + ((p_traits->>'markingPattern' = p_other_traits->>'markingPattern')::int * 12)
    + ((p_traits->>'muzzle' = p_other_traits->>'muzzle')::int * 8)
    + ((p_style->>'coatMode' = p_other_style->>'coatMode')::int * 12)
    + ((p_style->>'furStyle' = p_other_style->>'furStyle')::int * 12);
$$;

create or replace function public.review_pet_submission_v3(
  p_pet_id uuid,
  p_decision text,
  p_actor text,
  p_reason text default null,
  p_final_traits jsonb default null,
  p_final_style jsonb default null,
  p_published_accessory jsonb default null,
  p_review_note text default null
) returns public.pet_status
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  current_pet public.pets%rowtype;
  next_status public.pet_status;
  final_traits jsonb;
  final_style jsonb;
  similarity integer := 0;
  unchanged boolean;
  next_design_version integer;
begin
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_REVIEW_DECISION'; end if;
  if nullif(trim(p_actor), '') is null then raise exception 'REVIEW_ACTOR_REQUIRED'; end if;
  if p_decision = 'rejected' and nullif(trim(coalesce(p_reason,'')), '') is null then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;
  if char_length(coalesce(p_review_note,'')) > 500 then raise exception 'REVIEW_NOTE_TOO_LONG'; end if;

  select * into current_pet from public.pets where id = p_pet_id and status = 'pending' for update;
  if not found then raise exception 'PET_NOT_PENDING'; end if;

  final_traits := coalesce(p_final_traits, current_pet.submitted_traits, current_pet.traits);
  final_style := coalesce(p_final_style, current_pet.submitted_style, public.infer_pet_style_v1(final_traits));
  if not public.is_valid_pet_traits_v1(final_traits)
    or not public.is_valid_pet_style_v1(final_style, final_traits) then
    raise exception 'INVALID_PET_DESIGN';
  end if;
  if p_published_accessory is not null and not public.is_valid_pet_accessory(p_published_accessory) then
    raise exception 'INVALID_PET_ACCESSORY';
  end if;

  if p_decision = 'approved' and not exists (
    select 1 from public.pet_photos photo
    join storage.objects object on object.bucket_id = 'pet-photos' and object.name = photo.storage_path
    where photo.pet_id = p_pet_id and photo.is_active = true
  ) then raise exception 'PET_PHOTO_MISSING'; end if;

  if p_decision = 'approved' then
    select coalesce(max(public.pet_design_similarity_score(
      final_traits, final_style, approved.traits, approved.published_style
    )), 0) into similarity
    from public.pets approved
    where approved.status = 'approved' and approved.id <> p_pet_id;

    unchanged := final_traits = current_pet.submitted_traits
      and final_style = current_pet.submitted_style
      and coalesce(p_published_accessory, 'null'::jsonb) = coalesce(current_pet.requested_accessory, 'null'::jsonb);
    if similarity >= 80 and unchanged and nullif(trim(coalesce(p_review_note,'')), '') is null then
      raise exception 'SIMILARITY_REVIEW_NOTE_REQUIRED';
    end if;
  end if;

  next_status := p_decision::public.pet_status;
  next_design_version := current_pet.design_version + case when next_status = 'approved' then 1 else 0 end;
  update public.pets
  set status = next_status,
      reviewed_at = now(),
      rejection_reason = case when next_status = 'rejected' then trim(p_reason) else null end,
      owner_pinned_pending = false,
      traits = case when next_status = 'approved' then final_traits else traits end,
      published_style = case when next_status = 'approved' then final_style else published_style end,
      published_accessory = case when next_status = 'approved' then p_published_accessory else published_accessory end,
      review_note = nullif(trim(coalesce(p_review_note,'')), ''),
      design_version = next_design_version
  where id = p_pet_id;

  insert into public.admin_audit_logs(pet_id, actor, action, detail)
  values (p_pet_id, trim(p_actor), 'review_' || p_decision, jsonb_build_object(
    'reason', nullif(trim(coalesce(p_reason,'')), ''),
    'before', jsonb_build_object('traits', current_pet.traits, 'style', current_pet.published_style, 'accessory', current_pet.published_accessory),
    'after', jsonb_build_object('traits', final_traits, 'style', final_style, 'accessory', p_published_accessory),
    'similarityScore', similarity,
    'reviewNote', nullif(trim(coalesce(p_review_note,'')), ''),
    'designVersion', next_design_version
  ));
  return next_status;
end;
$$;

revoke all on function public.review_pet_submission_v3(uuid,text,text,text,jsonb,jsonb,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.review_pet_submission_v3(uuid,text,text,text,jsonb,jsonb,jsonb,text)
  to service_role;

-- Include the reviewed style in every consistent house snapshot.
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
  from public.get_pet_free_allowance(p_owner_hash) allowance;
  select coalesce(jsonb_agg(jsonb_build_object('petId',r.pet_id,'unlockMethod',r.unlock_method,'revealDate',r.reveal_date,'revisitUntil',r.revisit_until,'createdAt',r.created_at) order by r.created_at desc),'[]'::jsonb)
    into v_today_reveals from public.daily_reveals r where r.owner_hash=p_owner_hash and r.reveal_date=p_date;
  select coalesce(jsonb_agg(jsonb_build_object('petId',r.pet_id,'unlockMethod',r.unlock_method,'revealDate',r.reveal_date,'revisitUntil',r.revisit_until,'createdAt',r.created_at) order by r.created_at desc),'[]'::jsonb)
    into v_active_reveals from public.daily_reveals r where r.owner_hash=p_owner_hash and r.revisit_until>v_now;
  select jsonb_build_object('petId',reward.pet_id,'usedAt',reward.used_at) into v_upload_reward
    from public.upload_rewards reward where reward.owner_hash=p_owner_hash and reward.reward_date=p_date limit 1;

  select coalesce(jsonb_agg(item order by created_at desc),'[]'::jsonb) into v_owned_pets from (
    select pet.created_at, jsonb_build_object('id',pet.id,'name',pet.name,'traits',pet.traits,'status',pet.status,'ownerHash',pet.owner_hash,'publishedAccessory',pet.published_accessory,'publishedStyle',pet.published_style,'designVersion',pet.design_version) item
    from public.pets pet where pet.owner_hash=p_owner_hash and pet.status in ('pending','approved')
      and exists(select 1 from public.pet_photos photo join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path where photo.pet_id=pet.id and photo.is_active=true)
    order by pet.created_at desc limit 1
  ) owned;
  select coalesce(jsonb_agg(item order by reviewed_at desc,created_at desc),'[]'::jsonb) into v_approved_pets from (
    select pet.reviewed_at,pet.created_at,jsonb_build_object('id',pet.id,'name',pet.name,'traits',pet.traits,'status',pet.status,'ownerHash',pet.owner_hash,'publishedAccessory',pet.published_accessory,'publishedStyle',pet.published_style,'designVersion',pet.design_version) item
    from public.pets pet where pet.status='approved' and pet.owner_hash<>p_owner_hash and coalesce(pet.reviewed_at,pet.created_at)<v_day_start
      and exists(select 1 from public.pet_photos photo join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path where photo.pet_id=pet.id and photo.is_active=true)
    order by pet.reviewed_at desc nulls last,pet.created_at desc limit 200
  ) approved;
  select coalesce(jsonb_agg(item order by reveal_created_at desc),'[]'::jsonb) into v_active_pets from (
    select reveal.created_at reveal_created_at,jsonb_build_object('id',pet.id,'name',pet.name,'traits',pet.traits,'status',pet.status,'ownerHash',pet.owner_hash,'publishedAccessory',pet.published_accessory,'publishedStyle',pet.published_style,'designVersion',pet.design_version) item
    from public.daily_reveals reveal join public.pets pet on pet.id=reveal.pet_id
    where reveal.owner_hash=p_owner_hash and reveal.revisit_until>v_now and (pet.status='approved' or (pet.owner_hash=p_owner_hash and pet.status='pending'))
      and exists(select 1 from public.pet_photos photo join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path where photo.pet_id=pet.id and photo.is_active=true)
  ) active;
  return query select jsonb_build_object('date',p_date,'freeAllowance',jsonb_build_object('remaining',v_free_remaining,'nextChargeAt',v_next_free_at),'todayReveals',v_today_reveals,'activeReveals',v_active_reveals,'uploadReward',v_upload_reward,'ownedPets',v_owned_pets,'approvedPets',v_approved_pets,'activePets',v_active_pets);
end;
$$;

revoke all on function public.get_pet_house_snapshot(text,date) from public, anon, authenticated;
grant execute on function public.get_pet_house_snapshot(text,date) to service_role;

drop view if exists public.pending_pet_review_queue;
create view public.pending_pet_review_queue
with (security_barrier = true)
as
select pet.id pet_id,pet.submission_id,pet.name,pet.traits,pet.created_at,pet.storage_path primary_storage_path,
  coalesce(photos.paths,'[]'::jsonb) storage_paths,coalesce(photos.photo_present,false) photo_present,
  pet.accessory_selection_mode,pet.accessory_required,pet.requested_accessory,pet.published_accessory,
  pet.design_version,coalesce(similar_matches.items,'[]'::jsonb) similar_pets,
  pet.submitted_traits,pet.submitted_style,pet.published_style
from public.pets pet
left join lateral (
  select jsonb_agg(photo.storage_path order by photo.sort_order) filter(where photo.is_active) paths,
    bool_or(object.id is not null) filter(where photo.is_active) photo_present
  from public.pet_photos photo left join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
  where photo.pet_id=pet.id
) photos on true
left join lateral (
  select jsonb_agg(candidate.item order by candidate.score desc,candidate.name) items from (
    select approved.name,public.pet_design_similarity_score(pet.submitted_traits,pet.submitted_style,approved.traits,approved.published_style) score,
      jsonb_build_object('id',approved.id,'name',approved.name,'traits',approved.traits,'publishedStyle',approved.published_style,'publishedAccessory',approved.published_accessory,'designVersion',approved.design_version,'similarityScore',public.pet_design_similarity_score(pet.submitted_traits,pet.submitted_style,approved.traits,approved.published_style)) item
    from public.pets approved where approved.status='approved' and approved.id<>pet.id
    order by score desc,approved.created_at desc limit 3
  ) candidate
) similar_matches on true
where pet.status='pending';

revoke all on table public.pending_pet_review_queue from public, anon, authenticated;
grant select on table public.pending_pet_review_queue to service_role;

create or replace view public.pet_review_catalog
with (security_barrier = true)
as
select pet.id pet_id,pet.name,pet.status,pet.submitted_traits,pet.submitted_style,pet.traits,
  pet.published_style,pet.published_accessory,pet.design_version,pet.reviewed_at,pet.review_note
from public.pets pet where pet.status in ('approved','paused');

revoke all on table public.pet_review_catalog from public, anon, authenticated;
grant select on table public.pet_review_catalog to service_role;

create or replace function public.manage_pet_publication_v3(
  p_pet_id uuid,
  p_action text,
  p_actor text,
  p_final_traits jsonb default null,
  p_final_style jsonb default null,
  p_published_accessory jsonb default null,
  p_review_note text default null
) returns public.pet_status
language plpgsql
security definer
set search_path = public
as $$
declare
  current_pet public.pets%rowtype;
  next_status public.pet_status;
  final_traits jsonb;
  final_style jsonb;
begin
  if p_action not in ('revise','pause','republish') then raise exception 'INVALID_PUBLICATION_ACTION'; end if;
  if nullif(trim(p_actor),'') is null or nullif(trim(coalesce(p_review_note,'')),'') is null then raise exception 'REVIEW_NOTE_REQUIRED'; end if;
  select * into current_pet from public.pets where id=p_pet_id and status in ('approved','paused') for update;
  if not found then raise exception 'PET_NOT_MANAGEABLE'; end if;
  final_traits:=coalesce(p_final_traits,current_pet.traits);
  final_style:=coalesce(p_final_style,current_pet.published_style);
  if not public.is_valid_pet_traits_v1(final_traits) or not public.is_valid_pet_style_v1(final_style,final_traits) then raise exception 'INVALID_PET_DESIGN'; end if;
  if p_published_accessory is not null and not public.is_valid_pet_accessory(p_published_accessory) then raise exception 'INVALID_PET_ACCESSORY'; end if;
  next_status:=case when p_action='pause' then 'paused'::public.pet_status else 'approved'::public.pet_status end;
  update public.pets set status=next_status,traits=final_traits,published_style=final_style,published_accessory=case when p_action='pause' then current_pet.published_accessory else p_published_accessory end,review_note=trim(p_review_note),design_version=design_version+1 where id=p_pet_id;
  insert into public.admin_audit_logs(pet_id,actor,action,detail) values(p_pet_id,trim(p_actor),'publication_'||p_action,jsonb_build_object('before',jsonb_build_object('traits',current_pet.traits,'style',current_pet.published_style,'accessory',current_pet.published_accessory),'after',jsonb_build_object('traits',final_traits,'style',final_style,'accessory',case when p_action='pause' then current_pet.published_accessory else p_published_accessory end),'reviewNote',trim(p_review_note),'designVersion',current_pet.design_version+1));
  return next_status;
end;
$$;

revoke all on function public.manage_pet_publication_v3(uuid,text,text,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.manage_pet_publication_v3(uuid,text,text,jsonb,jsonb,jsonb,text) to service_role;

comment on column public.pets.submitted_traits is 'Immutable owner-submitted PetTraitsV1 snapshot.';
comment on column public.pets.submitted_style is 'Immutable owner-submitted PetStyleV1 snapshot.';
comment on column public.pets.published_style is 'Current reviewed PetStyleV1 shown in the app.';
