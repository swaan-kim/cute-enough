-- Align every reveal method with the next free-ticket recharge boundary.
-- When the free bucket is already full there is no scheduled recharge, so the
-- revisit window falls back to three hours from the reveal time.
create or replace function public.record_pet_reveal_v2(
  p_owner_hash text,
  p_reveal_date date,
  p_pet_id uuid,
  p_unlock_method text,
  p_ad_session_id uuid default null
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
  current_balance integer;
  refill_anchor timestamptz;
  refill_steps integer;
  rewarded_count integer;
  v_now timestamptz := clock_timestamp();
  v_revisit_until timestamptz;
begin
  -- One owner-wide lock keeps the active-revisit check and every unlock
  -- consumption atomic, including requests that cross KST midnight.
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));

  if exists (
    select 1
    from public.daily_reveals as reveal
    where reveal.owner_hash = p_owner_hash
      and reveal.pet_id = p_pet_id
      and reveal.revisit_until > v_now
  ) then
    raise exception 'PET_REVISIT_ACTIVE';
  end if;

  -- Materialize and refresh the free bucket for every reveal method. This is
  -- what makes REWARDED and UPLOAD use the same real next recharge boundary as
  -- FREE rather than an unrelated three-hour timer.
  perform pg_advisory_xact_lock(hashtextextended('pet-free:' || p_owner_hash, 0));
  insert into public.pet_free_allowances(owner_hash, balance, last_refill_at, updated_at)
  values (p_owner_hash, 2, v_now, v_now)
  on conflict (owner_hash) do nothing;

  select allowance.balance, allowance.last_refill_at
    into current_balance, refill_anchor
  from public.pet_free_allowances as allowance
  where allowance.owner_hash = p_owner_hash
  for update;

  if current_balance < 2 then
    refill_steps := greatest(0, floor(extract(epoch from (v_now - refill_anchor)) / 10800)::integer);
    if refill_steps > 0 then
      current_balance := least(2, current_balance + refill_steps);
      refill_anchor := case
        when current_balance = 2 then v_now
        else refill_anchor + refill_steps * interval '3 hours'
      end;
    end if;
  end if;

  if p_unlock_method = 'UPLOAD' then
    update public.upload_rewards
      set used_at = v_now
      where owner_hash = p_owner_hash
        and reward_date = p_reveal_date
        and pet_id = p_pet_id
        and used_at is null;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'UPLOAD_REWARD_UNAVAILABLE'; end if;
  elsif p_unlock_method = 'FREE' then
    if current_balance < 1 then raise exception 'FREE_ALLOWANCE_EMPTY'; end if;
    if current_balance = 2 then refill_anchor := v_now; end if;
    current_balance := current_balance - 1;
  elsif p_unlock_method = 'REWARDED' then
    if p_ad_session_id is null then raise exception 'AD_SESSION_REQUIRED'; end if;
    select count(*) into rewarded_count
      from public.daily_reveals
      where owner_hash = p_owner_hash
        and reveal_date = p_reveal_date
        and unlock_method = 'REWARDED';
    if rewarded_count >= 2 then raise exception 'REWARDED_LIMIT_REACHED'; end if;
  else
    raise exception 'INVALID_UNLOCK_METHOD';
  end if;

  v_revisit_until := case
    when current_balance < 2 then refill_anchor + interval '3 hours'
    else v_now + interval '3 hours'
  end;

  update public.pet_free_allowances
  set balance = current_balance,
      last_refill_at = refill_anchor,
      updated_at = v_now
  where owner_hash = p_owner_hash;

  insert into public.daily_reveals(
    owner_hash, reveal_date, pet_id, unlock_method, ad_session_id, revisit_until
  ) values (
    p_owner_hash,
    p_reveal_date,
    p_pet_id,
    p_unlock_method,
    case when p_unlock_method = 'REWARDED' then p_ad_session_id else null end,
    v_revisit_until
  );

  return v_revisit_until;
end;
$$;

revoke all on function public.record_pet_reveal_v2(text,date,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.record_pet_reveal_v2(text,date,uuid,text,uuid)
  to service_role;
