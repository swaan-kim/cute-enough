-- Fill otherwise empty house slots with same-day approvals and keep a minimal
-- daily photo-view record for the five-friend completion message.
create table if not exists public.daily_pet_views (
  owner_hash text not null,
  view_date date not null,
  pet_id uuid not null references public.pets(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (owner_hash, view_date, pet_id)
);

alter table public.daily_pet_views enable row level security;
revoke all on table public.daily_pet_views from public, anon, authenticated;
grant select, insert on table public.daily_pet_views to service_role;

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
  v_day_end timestamptz := (p_date + 1)::timestamp at time zone 'Asia/Seoul';
  v_free_remaining integer;
  v_next_free_at timestamptz;
  v_today_reveals jsonb;
  v_active_reveals jsonb;
  v_today_met_pet_ids jsonb;
  v_upload_reward jsonb;
  v_owned_pets jsonb;
  v_approved_pets jsonb;
  v_same_day_approved_pets jsonb;
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
  select coalesce(jsonb_agg(met.pet_id),'[]'::jsonb) into v_today_met_pet_ids from (
    select distinct r.pet_id from public.daily_reveals r where r.owner_hash=p_owner_hash and r.reveal_date=p_date
    union
    select distinct v.pet_id from public.daily_pet_views v where v.owner_hash=p_owner_hash and v.view_date=p_date
  ) met;
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
  select coalesce(jsonb_agg(item order by reviewed_at,created_at),'[]'::jsonb) into v_same_day_approved_pets from (
    select pet.reviewed_at,pet.created_at,jsonb_build_object('id',pet.id,'name',pet.name,'traits',pet.traits,'status',pet.status,'ownerHash',pet.owner_hash,'publishedAccessory',pet.published_accessory,'publishedStyle',pet.published_style,'designVersion',pet.design_version) item
    from public.pets pet where pet.status='approved' and pet.owner_hash<>p_owner_hash
      and coalesce(pet.reviewed_at,pet.created_at)>=v_day_start and coalesce(pet.reviewed_at,pet.created_at)<v_day_end
      and exists(select 1 from public.pet_photos photo join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path where photo.pet_id=pet.id and photo.is_active=true)
    order by pet.reviewed_at,pet.created_at limit 200
  ) approved_today;
  select coalesce(jsonb_agg(item order by reveal_created_at desc),'[]'::jsonb) into v_active_pets from (
    select reveal.created_at reveal_created_at,jsonb_build_object('id',pet.id,'name',pet.name,'traits',pet.traits,'status',pet.status,'ownerHash',pet.owner_hash,'publishedAccessory',pet.published_accessory,'publishedStyle',pet.published_style,'designVersion',pet.design_version) item
    from public.daily_reveals reveal join public.pets pet on pet.id=reveal.pet_id
    where reveal.owner_hash=p_owner_hash and reveal.revisit_until>v_now and (pet.status='approved' or (pet.owner_hash=p_owner_hash and pet.status='pending'))
      and exists(select 1 from public.pet_photos photo join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path where photo.pet_id=pet.id and photo.is_active=true)
  ) active;
  return query select jsonb_build_object(
    'date',p_date,
    'freeAllowance',jsonb_build_object('remaining',v_free_remaining,'nextChargeAt',v_next_free_at),
    'todayReveals',v_today_reveals,
    'activeReveals',v_active_reveals,
    'todayMetPetIds',v_today_met_pet_ids,
    'uploadReward',v_upload_reward,
    'ownedPets',v_owned_pets,
    'approvedPets',v_approved_pets,
    'sameDayApprovedPets',v_same_day_approved_pets,
    'activePets',v_active_pets
  );
end;
$$;

revoke all on function public.get_pet_house_snapshot(text,date) from public, anon, authenticated;
grant execute on function public.get_pet_house_snapshot(text,date) to service_role;
