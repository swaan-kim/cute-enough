-- Make the v2 client reveal record and its fixed-house progress update one
-- transaction. The legacy record_pet_reveal_v2 contract remains unchanged.
--
-- Lock order is deliberately:
--   pet-reveal -> daily-house-v2 -> pet-free
-- This avoids the free/daily-house inversion that would be possible if
-- mark_daily_house_pet_met created the house only after taking the free lock.
create or replace function public.record_pet_reveal_v3(
  p_owner_hash text,
  p_reveal_date date,
  p_pet_id uuid,
  p_unlock_method text,
  p_ad_session_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_free_remaining integer;
  v_revisit_until timestamptz;
  v_daily_progress jsonb;
begin
  if nullif(p_owner_hash, '') is null
    or p_reveal_date is null
    or p_pet_id is null then
    raise exception 'INVALID_REVEAL_INPUT';
  end if;

  -- Re-entered by record_pet_reveal_v2 and the house snapshot below. Advisory
  -- transaction locks are safe to acquire repeatedly in one transaction.
  perform pg_advisory_xact_lock(
    hashtextextended('pet-reveal:' || p_owner_hash, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'daily-house-v2:' || p_owner_hash || ':' || p_reveal_date::text,
      0
    )
  );

  select allowance.free_remaining
    into v_free_remaining
  from public.get_pet_free_allowance(p_owner_hash) allowance;

  -- Rewarded ads are a wait-skip only. A stale or modified client cannot spend
  -- an ad credit while a free ticket is available on the authoritative bucket.
  if p_unlock_method = 'REWARDED' and v_free_remaining > 0 then
    raise exception 'FREE_ALLOWANCE_AVAILABLE';
  end if;

  v_revisit_until := public.record_pet_reveal_v2(
    p_owner_hash,
    p_reveal_date,
    p_pet_id,
    p_unlock_method,
    p_ad_session_id
  );

  -- If the viewer entered from a share link before opening home, this creates
  -- today's assignments after the reveal exists, so the active pet can still
  -- be prioritized into the initial five before its slot is marked met.
  v_daily_progress := public.mark_daily_house_pet_met(
    p_owner_hash,
    p_reveal_date,
    p_pet_id
  );

  return jsonb_build_object(
    'revisitUntil', v_revisit_until,
    'dailyProgress', v_daily_progress
  );
end;
$$;

revoke all on function public.record_pet_reveal_v3(text,date,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.record_pet_reveal_v3(text,date,uuid,text,uuid)
  to service_role;
