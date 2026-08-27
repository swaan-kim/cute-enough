-- Track upload rewards and enforce daily reveal limits.
create table if not exists public.upload_rewards (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null,
  reward_date date not null,
  pet_id uuid not null references public.pets(id),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  unique(owner_hash, reward_date),
  unique(pet_id)
);

create index if not exists upload_rewards_owner_day_idx
  on public.upload_rewards(owner_hash, reward_date, used_at);

alter table public.upload_rewards enable row level security;

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
  rewarded_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_hash || ':' || p_reveal_date::text, 0));

  if p_unlock_method = 'UPLOAD' then
    update public.upload_rewards
      set used_at = now()
      where owner_hash = p_owner_hash
        and reward_date = p_reveal_date
        and pet_id = p_pet_id
        and used_at is null;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'UPLOAD_REWARD_UNAVAILABLE'; end if;
  elsif p_unlock_method = 'REWARDED' then
    if p_ad_session_id is null then raise exception 'AD_SESSION_REQUIRED'; end if;
    select count(*) into rewarded_count
      from public.daily_reveals
      where owner_hash = p_owner_hash and reveal_date = p_reveal_date and unlock_method = 'REWARDED';
    if rewarded_count >= 2 then raise exception 'REWARDED_LIMIT_REACHED'; end if;
  elsif p_unlock_method <> 'FREE' then
    raise exception 'INVALID_UNLOCK_METHOD';
  end if;

  insert into public.daily_reveals(owner_hash, reveal_date, pet_id, unlock_method, ad_session_id)
  values (p_owner_hash, p_reveal_date, p_pet_id, p_unlock_method,
    case when p_unlock_method = 'REWARDED' then p_ad_session_id else null end);
end;
$$;

revoke all on function public.record_pet_reveal(text,date,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.record_pet_reveal(text,date,uuid,text,uuid) to service_role;
