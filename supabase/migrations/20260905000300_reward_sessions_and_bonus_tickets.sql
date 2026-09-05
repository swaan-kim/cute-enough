-- Durable SDK reward reports and idempotent photo consumption. These reports
-- are NOT cryptographic proof of an ad view or a contact invitation: the Toss
-- SDK currently supplies neither a server-verifiable receipt nor a recipient ID.
-- Starts are disabled until the console configuration and QR flow are verified.
create table public.pet_reward_settings (
  singleton boolean primary key default true check (singleton),
  ads_enabled boolean not null default false,
  share_enabled boolean not null default false,
  share_module_id uuid not null default 'e5de3e72-cbfb-4b50-a050-9fd71fb4368b'
    check (share_module_id = 'e5de3e72-cbfb-4b50-a050-9fd71fb4368b'),
  updated_at timestamptz not null default now()
);
insert into public.pet_reward_settings(singleton) values (true);

create table public.pet_bonus_accounts (
  owner_hash text primary key check (length(owner_hash) > 0),
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create table public.pet_ad_reward_sessions (
  id uuid primary key,
  owner_hash text not null check (length(owner_hash) > 0),
  -- No FK: deleting a photo must preserve its unspent earned reward.
  pet_id uuid not null,
  original_pet_id uuid not null,
  started_date date not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'started'
    check (status in ('started', 'cancelled', 'completed', 'consumed')),
  completed_at timestamptz,
  consumed_at timestamptz,
  rebound_at timestamptz,
  check ((status in ('completed','consumed')) = (completed_at is not null)),
  check ((status = 'consumed') = (consumed_at is not null))
);
create index pet_ad_reward_owner_idx
  on public.pet_ad_reward_sessions(owner_hash, started_date, status);

create table public.pet_share_reward_sessions (
  id uuid primary key,
  owner_hash text not null check (length(owner_hash) > 0),
  module_id uuid not null
    check (module_id = 'e5de3e72-cbfb-4b50-a050-9fd71fb4368b'),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  granted_amount integer not null default 0 check (granted_amount >= 0),
  close_total integer check (close_total >= 0),
  reconciliation_required boolean not null default false
);
create index pet_share_reward_owner_idx
  on public.pet_share_reward_sessions(owner_hash, started_at desc);
create table public.pet_share_reward_events (
  owner_hash text not null,
  request_id uuid not null,
  session_id uuid not null references public.pet_share_reward_sessions(id),
  event_sequence integer not null check (event_sequence > 0),
  reward_amount integer not null check (reward_amount between 1 and 1000),
  granted boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (owner_hash, request_id),
  unique (session_id, event_sequence)
);
create table public.pet_reveal_requests (
  owner_hash text not null,
  request_id uuid not null,
  pet_id uuid not null,
  requested_method text not null,
  requested_ad_session_id uuid,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_hash, request_id)
);

alter table public.daily_reveals drop constraint daily_reveals_unlock_method_check;
alter table public.daily_reveals add constraint daily_reveals_unlock_method_check
  check (unlock_method in ('FREE', 'REWARDED', 'UPLOAD', 'SHARE'));
alter table public.daily_reveals drop constraint rewarded_requires_session;
alter table public.daily_reveals add constraint rewarded_requires_session check (
  (unlock_method in ('FREE', 'UPLOAD', 'SHARE') and ad_session_id is null) or
  (unlock_method = 'REWARDED' and ad_session_id is not null)
);

-- Every new write obtains pet-reveal first. A reveal then obtains
-- daily-house-v2, pet-free, and finally bonus rows, matching the legacy order.
create or replace function public.is_pet_reward_photo_available(p_pet_id uuid)
returns boolean language sql stable security definer set search_path = public, storage
as $$
  select exists (
    select 1 from public.pets pet
    join public.pet_photos photo on photo.pet_id = pet.id and photo.is_active
    join storage.objects object on object.bucket_id = 'pet-photos'
      and object.name = photo.storage_path
    where pet.id = p_pet_id and pet.status = 'approved'
  );
$$;

create or replace function public.get_pet_reward_state(p_owner_hash text)
returns jsonb language plpgsql security definer set search_path = public, storage
as $$
declare
  v_today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  v_count integer;
  v_ads jsonb;
  v_shares jsonb;
  v_settings public.pet_reward_settings%rowtype;
begin
  if nullif(p_owner_hash, '') is null then raise exception 'INVALID_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  select * into v_settings from public.pet_reward_settings where singleton;
  select count(*) into v_count from (
    select session.id from public.pet_ad_reward_sessions session
    where session.owner_hash = p_owner_hash and session.started_date = v_today
      and session.completed_at is not null
    union all
    select reveal.id from public.daily_reveals reveal
    where reveal.owner_hash = p_owner_hash and reveal.reveal_date = v_today
      and reveal.unlock_method = 'REWARDED'
      and not exists (select 1 from public.pet_ad_reward_sessions session
        where session.id = reveal.ad_session_id)
  ) rewards;
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', session.id, 'petId', session.pet_id, 'status', session.status,
    'startedDate', session.started_date, 'expiresAt', session.expires_at,
    'completedAt', session.completed_at, 'consumedAt', session.consumed_at,
    'canRebind', session.rebound_at is null and
      not public.is_pet_reward_photo_available(session.pet_id)
  ) order by session.started_at), '[]'::jsonb) into v_ads
  from public.pet_ad_reward_sessions session
  where session.owner_hash = p_owner_hash
    and (session.status = 'completed' or
      (session.status = 'started' and session.expires_at > clock_timestamp()));
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', session.id,
    'status', case when session.closed_at is null then 'started' else 'closed' end,
    'moduleId', session.module_id, 'grantedAmount', session.granted_amount,
    'closeTotal', session.close_total,
    'reconciliationRequired', session.reconciliation_required
  ) order by session.started_at desc), '[]'::jsonb) into v_shares
  from (select * from public.pet_share_reward_sessions s
    where s.owner_hash = p_owner_hash order by s.started_at desc limit 20) session;
  return jsonb_build_object(
    'bonusTickets', coalesce((select balance from public.pet_bonus_accounts
      where owner_hash = p_owner_hash), 0),
    'adsEnabled', coalesce(v_settings.ads_enabled, false),
    'shareEnabled', coalesce(v_settings.share_enabled, false),
    'shareModuleId', v_settings.share_module_id,
    'adsCompletedToday', v_count, 'adsRemainingToday', greatest(0, 2 - v_count),
    'adRewards', v_ads, 'shareSessions', v_shares, 'serverNow', clock_timestamp()
  );
end;
$$;

create or replace function public.start_pet_ad_reward(
  p_owner_hash text, p_session_id uuid, p_pet_id uuid
) returns jsonb language plpgsql security definer set search_path = public, storage
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Seoul')::date;
  v_session public.pet_ad_reward_sessions%rowtype;
  v_free integer;
  v_state jsonb;
begin
  if nullif(p_owner_hash, '') is null or p_session_id is null or p_pet_id is null
    then raise exception 'INVALID_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  select * into v_session from public.pet_ad_reward_sessions where id = p_session_id;
  if found then
    if v_session.owner_hash <> p_owner_hash or v_session.original_pet_id <> p_pet_id
      then raise exception 'REWARD_SESSION_CONFLICT'; end if;
    return public.get_pet_reward_state(p_owner_hash) || jsonb_build_object('sessionId', p_session_id);
  end if;
  if not (select ads_enabled from public.pet_reward_settings where singleton)
    then raise exception 'ADS_DISABLED'; end if;
  if not public.is_pet_reward_photo_available(p_pet_id)
    then raise exception 'PET_NOT_AVAILABLE'; end if;
  if exists (select 1 from public.pets where id = p_pet_id and owner_hash = p_owner_hash)
    then raise exception 'OWNER_PHOTO_FREE'; end if;
  if exists (select 1 from public.daily_reveals where owner_hash = p_owner_hash
    and pet_id = p_pet_id and revisit_until > v_now)
    then raise exception 'PET_REVISIT_ACTIVE'; end if;
  select free_remaining into v_free from public.get_pet_free_allowance(p_owner_hash);
  if v_free > 0 then raise exception 'FREE_ALLOWANCE_AVAILABLE'; end if;
  if coalesce((select balance from public.pet_bonus_accounts where owner_hash = p_owner_hash), 0) > 0
    then raise exception 'BONUS_ALLOWANCE_AVAILABLE'; end if;
  if exists (select 1 from public.pet_ad_reward_sessions where owner_hash = p_owner_hash
    and pet_id = p_pet_id and status = 'completed')
    then raise exception 'AD_REWARD_AVAILABLE'; end if;
  if exists (select 1 from public.pet_ad_reward_sessions where owner_hash = p_owner_hash
    and status = 'started' and expires_at > v_now)
    then raise exception 'AD_SESSION_ACTIVE'; end if;
  v_state := public.get_pet_reward_state(p_owner_hash);
  if (v_state->>'adsRemainingToday')::integer < 1
    then raise exception 'REWARDED_LIMIT_REACHED'; end if;
  insert into public.pet_ad_reward_sessions(id, owner_hash, pet_id, original_pet_id,
    started_date, started_at, expires_at)
  values (p_session_id, p_owner_hash, p_pet_id, p_pet_id, v_today, v_now, v_now + interval '10 minutes');
  return public.get_pet_reward_state(p_owner_hash) || jsonb_build_object('sessionId', p_session_id);
end;
$$;

create or replace function public.complete_pet_ad_reward(p_owner_hash text, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public, storage
as $$
declare
  v_session public.pet_ad_reward_sessions%rowtype;
  v_count integer;
begin
  if nullif(p_owner_hash, '') is null or p_session_id is null
    then raise exception 'INVALID_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  select * into v_session from public.pet_ad_reward_sessions
    where id = p_session_id and owner_hash = p_owner_hash for update;
  if not found then raise exception 'AD_SESSION_NOT_FOUND'; end if;
  if v_session.completed_at is null then
    -- Count on the start date, including legacy ads not represented by a session.
    select count(*) into v_count from (
      select session.id from public.pet_ad_reward_sessions session
      where session.owner_hash = p_owner_hash and session.started_date = v_session.started_date
        and session.completed_at is not null
      union all
      select reveal.id from public.daily_reveals reveal
      where reveal.owner_hash = p_owner_hash and reveal.reveal_date = v_session.started_date
        and reveal.unlock_method = 'REWARDED'
        and not exists (select 1 from public.pet_ad_reward_sessions session
          where session.id = reveal.ad_session_id)
    ) rewards;
    if v_count >= 2 then raise exception 'REWARDED_LIMIT_REACHED'; end if;
    -- Completion intentionally survives cancellation, expiry, kill switches and
    -- natural recharge. The SDK caller cancels only a confirmed no-reward exit.
    update public.pet_ad_reward_sessions
      set status = 'completed', completed_at = clock_timestamp() where id = p_session_id;
  end if;
  return public.get_pet_reward_state(p_owner_hash) || jsonb_build_object('sessionId', p_session_id);
end;
$$;

create or replace function public.cancel_pet_ad_reward(p_owner_hash text, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public, storage
as $$
begin
  if nullif(p_owner_hash, '') is null or p_session_id is null
    then raise exception 'INVALID_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  if not exists (select 1 from public.pet_ad_reward_sessions
    where id = p_session_id and owner_hash = p_owner_hash)
    then raise exception 'AD_SESSION_NOT_FOUND'; end if;
  update public.pet_ad_reward_sessions set status = 'cancelled'
    where id = p_session_id and owner_hash = p_owner_hash and status = 'started';
  return public.get_pet_reward_state(p_owner_hash) || jsonb_build_object('sessionId', p_session_id);
end;
$$;

create or replace function public.rebind_pet_ad_reward(
  p_owner_hash text, p_session_id uuid, p_pet_id uuid
) returns jsonb language plpgsql security definer set search_path = public, storage
as $$
declare v_session public.pet_ad_reward_sessions%rowtype;
begin
  if nullif(p_owner_hash, '') is null or p_session_id is null or p_pet_id is null
    then raise exception 'INVALID_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  select * into v_session from public.pet_ad_reward_sessions
    where id = p_session_id and owner_hash = p_owner_hash for update;
  if not found then raise exception 'AD_SESSION_NOT_FOUND'; end if;
  if v_session.status <> 'completed' then raise exception 'AD_REWARD_UNAVAILABLE'; end if;
  if v_session.pet_id = p_pet_id then
    return public.get_pet_reward_state(p_owner_hash) || jsonb_build_object('sessionId', p_session_id);
  end if;
  if v_session.rebound_at is not null or public.is_pet_reward_photo_available(v_session.pet_id)
    then raise exception 'AD_REWARD_RESELECT_UNAVAILABLE'; end if;
  if not public.is_pet_reward_photo_available(p_pet_id)
    then raise exception 'PET_NOT_AVAILABLE'; end if;
  if exists (select 1 from public.pets where id = p_pet_id and owner_hash = p_owner_hash)
    then raise exception 'OWNER_PHOTO_FREE'; end if;
  update public.pet_ad_reward_sessions set pet_id = p_pet_id, rebound_at = clock_timestamp()
    where id = p_session_id;
  return public.get_pet_reward_state(p_owner_hash) || jsonb_build_object('sessionId', p_session_id);
end;
$$;

-- Include the exact session in mutation responses even when an old offline
-- report falls outside the recent-session list in the general status response.
create or replace function public.get_pet_share_session_state(p_owner_hash text, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public, storage
as $$
declare v_state jsonb;
begin
  v_state := public.get_pet_reward_state(p_owner_hash);
  return v_state || jsonb_build_object('sessionId', p_session_id, 'shareSession', (
    select jsonb_build_object('sessionId', session.id, 'moduleId', session.module_id,
      'status', case when session.closed_at is null then 'started' else 'closed' end,
      'grantedAmount', session.granted_amount, 'closeTotal', session.close_total,
      'reconciliationRequired', session.reconciliation_required)
    from public.pet_share_reward_sessions session
    where session.id = p_session_id and session.owner_hash = p_owner_hash
  ));
end;
$$;

create or replace function public.start_pet_share_reward(p_owner_hash text, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public, storage
as $$
declare v_session public.pet_share_reward_sessions%rowtype;
begin
  if nullif(p_owner_hash, '') is null or p_session_id is null
    then raise exception 'INVALID_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  select * into v_session from public.pet_share_reward_sessions where id = p_session_id;
  if found then
    if v_session.owner_hash <> p_owner_hash then raise exception 'REWARD_SESSION_CONFLICT'; end if;
    return public.get_pet_share_session_state(p_owner_hash, p_session_id);
  end if;
  if not (select share_enabled from public.pet_reward_settings where singleton)
    then raise exception 'SHARE_REWARDS_DISABLED'; end if;
  if exists (select 1 from public.pet_share_reward_sessions where owner_hash = p_owner_hash
    and closed_at is null and expires_at > clock_timestamp())
    then raise exception 'SHARE_SESSION_ACTIVE'; end if;
  insert into public.pet_share_reward_sessions(id, owner_hash, module_id, expires_at)
    values (p_session_id, p_owner_hash, 'e5de3e72-cbfb-4b50-a050-9fd71fb4368b',
      clock_timestamp() + interval '20 minutes');
  return public.get_pet_share_session_state(p_owner_hash, p_session_id);
end;
$$;

create or replace function public.record_pet_share_reward(
  p_owner_hash text, p_session_id uuid, p_request_id uuid,
  p_event_sequence integer, p_reward_amount integer
) returns jsonb language plpgsql security definer set search_path = public, storage
as $$
declare
  v_session public.pet_share_reward_sessions%rowtype;
  v_event public.pet_share_reward_events%rowtype;
begin
  if nullif(p_owner_hash, '') is null or p_session_id is null or p_request_id is null
    or p_event_sequence is null or p_event_sequence < 1
    or p_reward_amount is null or p_reward_amount not between 1 and 1000
    then raise exception 'INVALID_SHARE_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  select * into v_session from public.pet_share_reward_sessions
    where id = p_session_id and owner_hash = p_owner_hash for update;
  if not found then raise exception 'SHARE_SESSION_NOT_FOUND'; end if;
  select * into v_event from public.pet_share_reward_events
    where owner_hash = p_owner_hash and request_id = p_request_id;
  if found then
    if v_event.session_id <> p_session_id or v_event.event_sequence <> p_event_sequence
      or v_event.reward_amount <> p_reward_amount
      then raise exception 'REWARD_REQUEST_CONFLICT'; end if;
    return public.get_pet_share_session_state(p_owner_hash, p_session_id)
      || jsonb_build_object('rewardPendingReview', not v_event.granted);
  end if;
  select * into v_event from public.pet_share_reward_events
    where session_id = p_session_id and event_sequence = p_event_sequence;
  if found then
    if v_event.reward_amount <> p_reward_amount then raise exception 'REWARD_REQUEST_CONFLICT'; end if;
    return public.get_pet_share_session_state(p_owner_hash, p_session_id)
      || jsonb_build_object('rewardPendingReview', not v_event.granted);
  end if;
  if v_session.closed_at is not null and (v_session.close_total is null
    or v_session.granted_amount + p_reward_amount > v_session.close_total) then
    -- Keep a disputed report and its request identity for review, without
    -- minting tickets or allowing a changed retry to escape reconciliation.
    insert into public.pet_share_reward_events(owner_hash, request_id, session_id,
      event_sequence, reward_amount, granted)
    values (p_owner_hash, p_request_id, p_session_id, p_event_sequence, p_reward_amount, false);
    update public.pet_share_reward_sessions set reconciliation_required = true where id = p_session_id;
    return public.get_pet_share_session_state(p_owner_hash, p_session_id) || jsonb_build_object(
      'rewardPendingReview', true);
  end if;
  -- A persisted SDK event may arrive after expiry or after the close report.
  -- Accept it once; the close report itself never mints tickets.
  insert into public.pet_share_reward_events(owner_hash, request_id, session_id,
    event_sequence, reward_amount)
  values (p_owner_hash, p_request_id, p_session_id, p_event_sequence, p_reward_amount);
  insert into public.pet_bonus_accounts(owner_hash, balance)
    values (p_owner_hash, p_reward_amount)
    on conflict (owner_hash) do update set
      balance = pet_bonus_accounts.balance + excluded.balance, updated_at = clock_timestamp();
  update public.pet_share_reward_sessions
    set granted_amount = granted_amount + p_reward_amount,
      reconciliation_required = closed_at is not null and
        (close_total is null or close_total <> granted_amount + p_reward_amount
          or exists (select 1 from public.pet_share_reward_events event
            where event.session_id = p_session_id and not event.granted))
    where id = p_session_id;
  return public.get_pet_share_session_state(p_owner_hash, p_session_id);
end;
$$;

create or replace function public.close_pet_share_reward(
  p_owner_hash text, p_session_id uuid, p_total_reward_amount integer default null
) returns jsonb language plpgsql security definer set search_path = public, storage
as $$
declare v_session public.pet_share_reward_sessions%rowtype;
begin
  if nullif(p_owner_hash, '') is null or p_session_id is null or p_total_reward_amount < 0
    then raise exception 'INVALID_SHARE_REWARD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  select * into v_session from public.pet_share_reward_sessions
    where id = p_session_id and owner_hash = p_owner_hash for update;
  if not found then raise exception 'SHARE_SESSION_NOT_FOUND'; end if;
  if v_session.closed_at is not null and v_session.close_total is distinct from p_total_reward_amount
    then raise exception 'SHARE_CLOSE_CONFLICT'; end if;
  update public.pet_share_reward_sessions set
    closed_at = coalesce(closed_at, clock_timestamp()), close_total = p_total_reward_amount,
    reconciliation_required = p_total_reward_amount is null or granted_amount <> p_total_reward_amount
      or exists (select 1 from public.pet_share_reward_events event
        where event.session_id = p_session_id and not event.granted)
    where id = p_session_id;
  return public.get_pet_share_session_state(p_owner_hash, p_session_id);
end;
$$;

create or replace function public.record_pet_reveal_v4(
  p_owner_hash text, p_reveal_date date, p_pet_id uuid,
  p_unlock_method text, p_request_id uuid, p_ad_session_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, storage
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_existing public.pet_reveal_requests%rowtype;
  v_ad public.pet_ad_reward_sessions%rowtype;
  v_free integer;
  v_next timestamptz;
  v_until timestamptz;
  v_method text := p_unlock_method;
  v_ad_id uuid := p_ad_session_id;
  v_progress jsonb;
  v_response jsonb;
  v_photo_date date := p_reveal_date;
  v_already_revealed boolean := false;
begin
  if nullif(p_owner_hash, '') is null or p_reveal_date is null or p_pet_id is null
    or p_request_id is null or p_unlock_method is null
    or p_unlock_method not in ('FREE', 'SHARE', 'REWARDED')
    or (p_unlock_method <> 'REWARDED' and p_ad_session_id is not null)
    then raise exception 'INVALID_REVEAL_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0));
  select * into v_existing from public.pet_reveal_requests
    where owner_hash = p_owner_hash and request_id = p_request_id;
  if found then
    if v_existing.pet_id <> p_pet_id or v_existing.requested_method <> p_unlock_method
      or v_existing.requested_ad_session_id is distinct from p_ad_session_id
      then raise exception 'REVEAL_REQUEST_CONFLICT'; end if;
    -- Never extend a completed request's boundary or charge it again. The API
    -- must check this original revisitUntil before issuing another photo URL.
    return v_existing.response || jsonb_build_object('reusedRequest', true);
  end if;
  if p_reveal_date <> (v_now at time zone 'Asia/Seoul')::date
    then raise exception 'INVALID_REVEAL_DATE'; end if;
  if not public.is_pet_reward_photo_available(p_pet_id)
    then raise exception 'PET_NOT_AVAILABLE'; end if;
  if exists (select 1 from public.pets where id = p_pet_id and owner_hash = p_owner_hash)
    then raise exception 'OWNER_PHOTO_FREE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'daily-house-v2:' || p_owner_hash || ':' || p_reveal_date::text, 0));
  select free_remaining, next_free_at into v_free, v_next
    from public.get_pet_free_allowance(p_owner_hash);
  select reveal.revisit_until, reveal.unlock_method, reveal.ad_session_id, reveal.reveal_date
    into v_until, v_method, v_ad_id, v_photo_date from public.daily_reveals reveal
    where reveal.owner_hash = p_owner_hash and reveal.pet_id = p_pet_id
      and reveal.revisit_until > v_now order by reveal.revisit_until desc limit 1;
  v_already_revealed := found;
  if not v_already_revealed then
    v_photo_date := p_reveal_date;
    v_method := p_unlock_method;
    v_ad_id := p_ad_session_id;
    if p_unlock_method <> 'REWARDED' then
      select * into v_ad from public.pet_ad_reward_sessions
        where owner_hash = p_owner_hash and pet_id = p_pet_id and status = 'completed'
        order by completed_at, id limit 1 for update;
      if found then v_method := 'REWARDED'; v_ad_id := v_ad.id;
      elsif v_free > 0 then v_method := 'FREE';
      else v_method := 'SHARE'; end if;
    end if;
    if v_method = 'REWARDED' then
      select * into v_ad from public.pet_ad_reward_sessions where id = v_ad_id
        and owner_hash = p_owner_hash and pet_id = p_pet_id and status = 'completed' for update;
      if not found then raise exception 'AD_REWARD_UNAVAILABLE'; end if;
      -- Daily completion cap was enforced when earned, not when consumed.
      update public.pet_ad_reward_sessions set status = 'consumed', consumed_at = v_now
        where id = v_ad.id;
    elsif v_method = 'FREE' then
      -- Preserve the existing token-bucket anchor; a full bucket starts now.
      update public.pet_free_allowances set balance = v_free - 1,
        last_refill_at = case when v_free = 2 then v_now else last_refill_at end,
        updated_at = v_now where owner_hash = p_owner_hash;
      if v_free = 2 then v_next := v_now + interval '3 hours'; end if;
      v_free := v_free - 1;
    else
      update public.pet_bonus_accounts set balance = balance - 1, updated_at = v_now
        where owner_hash = p_owner_hash and balance > 0;
      if not found then raise exception 'FREE_ALLOWANCE_EMPTY'; end if;
    end if;
    v_until := coalesce(v_next, v_now + interval '3 hours');
    insert into public.daily_reveals(owner_hash, reveal_date, pet_id,
      unlock_method, ad_session_id, revisit_until)
    values (p_owner_hash, p_reveal_date, p_pet_id, v_method,
      case when v_method = 'REWARDED' then v_ad_id else null end, v_until);
  end if;
  v_progress := public.mark_daily_house_pet_met(p_owner_hash, p_reveal_date, p_pet_id);
  v_response := jsonb_build_object(
    'revisitUntil', v_until, 'revealDate', v_photo_date, 'dailyProgress', v_progress,
    'unlockMethod', v_method, 'adSessionId', v_ad_id,
    'alreadyRevealed', v_already_revealed, 'reusedRequest', false,
    'bonusTickets', coalesce((select balance from public.pet_bonus_accounts
      where owner_hash = p_owner_hash), 0)
  );
  insert into public.pet_reveal_requests(owner_hash, request_id, pet_id,
    requested_method, requested_ad_session_id, response)
  values (p_owner_hash, p_request_id, p_pet_id, p_unlock_method, p_ad_session_id, v_response);
  return v_response;
end;
$$;

-- Older AITs still call reveal_v2/v3 directly. Their pre-session reward count
-- cannot see earned, unspent credits, so enforce the same cap at insertion.
-- Consuming a durable earned session bypasses the new-start switch and cap:
-- that reward was already counted when its completion was recorded.
create or replace function public.guard_legacy_pet_ad_reveal()
returns trigger language plpgsql security definer set search_path = public, storage
as $$
declare
  v_session public.pet_ad_reward_sessions%rowtype;
  v_count integer;
begin
  if new.unlock_method <> 'REWARDED' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('pet-reveal:' || new.owner_hash, 0));
  select * into v_session from public.pet_ad_reward_sessions where id = new.ad_session_id;
  if found then
    if v_session.owner_hash <> new.owner_hash or v_session.pet_id <> new.pet_id
      or v_session.status <> 'consumed' then raise exception 'AD_REWARD_UNAVAILABLE'; end if;
    return new;
  end if;
  if not (select ads_enabled from public.pet_reward_settings where singleton)
    then raise exception 'ADS_DISABLED'; end if;
  select count(*) into v_count from (
    select session.id from public.pet_ad_reward_sessions session
    where session.owner_hash = new.owner_hash and session.started_date = new.reveal_date
      and session.completed_at is not null
    union all
    select reveal.id from public.daily_reveals reveal
    where reveal.owner_hash = new.owner_hash and reveal.reveal_date = new.reveal_date
      and reveal.unlock_method = 'REWARDED'
      and not exists (select 1 from public.pet_ad_reward_sessions session
        where session.id = reveal.ad_session_id)
  ) rewards;
  if v_count >= 2 then raise exception 'REWARDED_LIMIT_REACHED'; end if;
  return new;
end;
$$;
create trigger guard_legacy_pet_ad_reveal before insert on public.daily_reveals
for each row execute function public.guard_legacy_pet_ad_reveal();
revoke all on function public.guard_legacy_pet_ad_reveal() from public, anon, authenticated;
grant execute on function public.guard_legacy_pet_ad_reveal() to service_role;

-- No anonymous or authenticated direct access, including helpers and settings.
alter table public.pet_reward_settings enable row level security;
alter table public.pet_bonus_accounts enable row level security;
alter table public.pet_ad_reward_sessions enable row level security;
alter table public.pet_share_reward_sessions enable row level security;
alter table public.pet_share_reward_events enable row level security;
alter table public.pet_reveal_requests enable row level security;
revoke all on table public.pet_reward_settings, public.pet_bonus_accounts,
  public.pet_ad_reward_sessions, public.pet_share_reward_sessions,
  public.pet_share_reward_events, public.pet_reveal_requests from public, anon, authenticated;
grant select, insert, update on table public.pet_reward_settings, public.pet_bonus_accounts,
  public.pet_ad_reward_sessions, public.pet_share_reward_sessions,
  public.pet_share_reward_events, public.pet_reveal_requests to service_role;
revoke all on function public.is_pet_reward_photo_available(uuid),
  public.get_pet_share_session_state(text,uuid),
  public.get_pet_reward_state(text), public.start_pet_ad_reward(text,uuid,uuid),
  public.complete_pet_ad_reward(text,uuid), public.cancel_pet_ad_reward(text,uuid),
  public.rebind_pet_ad_reward(text,uuid,uuid), public.start_pet_share_reward(text,uuid),
  public.record_pet_share_reward(text,uuid,uuid,integer,integer),
  public.close_pet_share_reward(text,uuid,integer),
  public.record_pet_reveal_v4(text,date,uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.is_pet_reward_photo_available(uuid),
  public.get_pet_share_session_state(text,uuid),
  public.get_pet_reward_state(text), public.start_pet_ad_reward(text,uuid,uuid),
  public.complete_pet_ad_reward(text,uuid), public.cancel_pet_ad_reward(text,uuid),
  public.rebind_pet_ad_reward(text,uuid,uuid), public.start_pet_share_reward(text,uuid),
  public.record_pet_share_reward(text,uuid,uuid,integer,integer),
  public.close_pet_share_reward(text,uuid,integer),
  public.record_pet_reveal_v4(text,date,uuid,text,uuid,uuid) to service_role;

comment on table public.pet_share_reward_events is
  'Idempotent client SDK reports, not server-verified recipient or payment receipts.';
