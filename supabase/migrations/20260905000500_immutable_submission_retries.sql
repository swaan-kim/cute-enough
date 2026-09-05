-- Preserve the first committed submission and every later review edit.
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
  v_existing_id uuid;
  v_reward_granted boolean;
begin
  -- Match the existing global/owner lock order before checking the submission.
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
