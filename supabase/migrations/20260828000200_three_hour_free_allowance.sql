-- 무료 이용권을 KST 자정 초기화 방식에서 3시간 토큰 버킷(최대 2개)으로 전환한다.
-- daily_reveals는 오늘 본 강아지와 광고/업로드 사용 이력을 위해 그대로 보존한다.
create table if not exists public.pet_free_allowances (
  owner_hash text primary key,
  balance smallint not null default 2 check (balance between 0 and 2),
  last_refill_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pet_free_allowances enable row level security;
grant select, insert, update on public.pet_free_allowances to service_role;

create or replace function public.get_pet_free_allowance(
  p_owner_hash text
) returns table(free_remaining integer, next_free_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance integer;
  refill_anchor timestamptz;
  refill_steps integer;
  current_time timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('pet-free:' || p_owner_hash, 0));

  insert into public.pet_free_allowances(owner_hash, balance, last_refill_at, updated_at)
  values (p_owner_hash, 2, current_time, current_time)
  on conflict (owner_hash) do nothing;

  select allowance.balance, allowance.last_refill_at
    into current_balance, refill_anchor
  from public.pet_free_allowances as allowance
  where allowance.owner_hash = p_owner_hash
  for update;

  if current_balance < 2 then
    refill_steps := greatest(0, floor(extract(epoch from (current_time - refill_anchor)) / 10800)::integer);
    if refill_steps > 0 then
      current_balance := least(2, current_balance + refill_steps);
      refill_anchor := case
        when current_balance = 2 then current_time
        else refill_anchor + refill_steps * interval '3 hours'
      end;
      update public.pet_free_allowances
      set balance = current_balance,
          last_refill_at = refill_anchor,
          updated_at = current_time
      where owner_hash = p_owner_hash;
    end if;
  end if;

  return query select
    current_balance,
    case when current_balance < 2 then refill_anchor + interval '3 hours' else null end;
end;
$$;

revoke all on function public.get_pet_free_allowance(text) from public, anon, authenticated;
grant execute on function public.get_pet_free_allowance(text) to service_role;

create or replace function public.record_pet_reveal(
  p_owner_hash text,
  p_reveal_date date,
  p_pet_id uuid,
  p_unlock_method text,
  p_ad_session_id uuid default null
) returns void
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
  current_time timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_hash || ':' || p_reveal_date::text, 0));

  if p_unlock_method = 'UPLOAD' then
    update public.upload_rewards
      set used_at = current_time
      where owner_hash = p_owner_hash
        and reward_date = p_reveal_date
        and pet_id = p_pet_id
        and used_at is null;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'UPLOAD_REWARD_UNAVAILABLE'; end if;
  elsif p_unlock_method = 'FREE' then
    perform pg_advisory_xact_lock(hashtextextended('pet-free:' || p_owner_hash, 0));
    insert into public.pet_free_allowances(owner_hash, balance, last_refill_at, updated_at)
    values (p_owner_hash, 2, current_time, current_time)
    on conflict (owner_hash) do nothing;

    select allowance.balance, allowance.last_refill_at
      into current_balance, refill_anchor
    from public.pet_free_allowances as allowance
    where allowance.owner_hash = p_owner_hash
    for update;

    if current_balance < 2 then
      refill_steps := greatest(0, floor(extract(epoch from (current_time - refill_anchor)) / 10800)::integer);
      if refill_steps > 0 then
        current_balance := least(2, current_balance + refill_steps);
        refill_anchor := case
          when current_balance = 2 then current_time
          else refill_anchor + refill_steps * interval '3 hours'
        end;
      end if;
    end if;

    if current_balance < 1 then raise exception 'FREE_ALLOWANCE_EMPTY'; end if;
    if current_balance = 2 then refill_anchor := current_time; end if;
    current_balance := current_balance - 1;

    update public.pet_free_allowances
    set balance = current_balance,
        last_refill_at = refill_anchor,
        updated_at = current_time
    where owner_hash = p_owner_hash;
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

  insert into public.daily_reveals(owner_hash, reveal_date, pet_id, unlock_method, ad_session_id)
  values (p_owner_hash, p_reveal_date, p_pet_id, p_unlock_method,
    case when p_unlock_method = 'REWARDED' then p_ad_session_id else null end);
end;
$$;

revoke all on function public.record_pet_reveal(text,date,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.record_pet_reveal(text,date,uuid,text,uuid)
  to service_role;
