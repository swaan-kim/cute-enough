-- Optional recharge reminders. This migration does not send messages or enable
-- the worker. Keys are AES-GCM envelopes encrypted with an Edge-only secret.
create table if not exists public.recharge_notification_settings (
  owner_hash text primary key,
  enabled boolean not null default false,
  encrypted_anon_key text,
  template_code text,
  consented_at timestamptz,
  last_visit_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not enabled or (encrypted_anon_key is not null and template_code is not null and consented_at is not null))
);

create table if not exists public.recharge_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null references public.recharge_notification_settings(owner_hash) on delete cascade,
  charge_at timestamptz not null,
  not_before timestamptz not null,
  state text not null default 'scheduled' check (state in ('scheduled', 'claimed', 'sending', 'sent', 'failed', 'unknown', 'skipped', 'cancelled')),
  claim_token uuid,
  claimed_at timestamptz,
  send_started_at timestamptz,
  attempt_date date,
  finished_at timestamptz,
  outcome_reason text,
  created_at timestamptz not null default now(),
  unique (owner_hash, charge_at)
);
create index if not exists recharge_notification_due on public.recharge_notification_jobs(not_before)
  where state in ('scheduled', 'claimed');
-- Count attempts, including ambiguous network outcomes, conservatively. A retry
-- must never cause a second notification when the provider already accepted one.
create unique index if not exists recharge_notification_one_daily_attempt
  on public.recharge_notification_jobs(owner_hash, attempt_date) where attempt_date is not null;

alter table public.recharge_notification_settings enable row level security;
alter table public.recharge_notification_jobs enable row level security;
revoke all on public.recharge_notification_settings, public.recharge_notification_jobs from anon, authenticated;
grant select, insert, update, delete on public.recharge_notification_settings, public.recharge_notification_jobs to service_role;

create or replace function public.recharge_notification_not_before(p_charge_at timestamptz)
returns timestamptz language sql immutable set search_path = public as $$
  select case
    when (p_charge_at at time zone 'Asia/Seoul')::time >= time '21:00'
      then (((p_charge_at at time zone 'Asia/Seoul')::date + 1) + time '08:00') at time zone 'Asia/Seoul'
    when (p_charge_at at time zone 'Asia/Seoul')::time < time '08:00'
      then (((p_charge_at at time zone 'Asia/Seoul')::date) + time '08:00') at time zone 'Asia/Seoul'
    else p_charge_at end;
$$;

create or replace function public.get_recharge_notification_settings(p_owner_hash text)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('enabled', enabled, 'templateCode', template_code)
    from public.recharge_notification_settings where owner_hash = p_owner_hash), jsonb_build_object('enabled', false));
$$;

create or replace function public.set_recharge_notification_settings(
  p_owner_hash text, p_enabled boolean, p_encrypted_anon_key text default null, p_template_code text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := clock_timestamp(); v_charge_at timestamptz;
begin
  if nullif(p_owner_hash, '') is null or p_enabled is null then raise exception 'INVALID_NOTIFICATION_SETTINGS'; end if;
  if p_enabled and (p_encrypted_anon_key not like 'v1.%' or p_encrypted_anon_key is null or nullif(p_template_code, '') is null)
    then raise exception 'NOTIFICATION_AGREEMENT_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('recharge-notification:' || p_owner_hash, 0));
  v_now := clock_timestamp();
  insert into public.recharge_notification_settings(owner_hash, enabled, encrypted_anon_key, template_code, consented_at, last_visit_at, updated_at)
  values (p_owner_hash, p_enabled, case when p_enabled then p_encrypted_anon_key end,
    case when p_enabled then p_template_code end, case when p_enabled then v_now end, v_now, v_now)
  on conflict (owner_hash) do update set enabled = excluded.enabled,
    encrypted_anon_key = excluded.encrypted_anon_key, template_code = excluded.template_code,
    consented_at = excluded.consented_at, last_visit_at = v_now, updated_at = v_now;
  if not p_enabled then
    update public.recharge_notification_jobs set state = 'cancelled', finished_at = v_now, outcome_reason = 'opted_out'
      where owner_hash = p_owner_hash and state in ('scheduled', 'claimed');
    return;
  end if;
  select last_refill_at + interval '3 hours' into v_charge_at from public.pet_free_allowances
    where owner_hash = p_owner_hash and balance = 0;
  if v_charge_at > v_now then
    insert into public.recharge_notification_jobs(owner_hash, charge_at, not_before)
    values (p_owner_hash, v_charge_at, public.recharge_notification_not_before(v_charge_at))
    on conflict (owner_hash, charge_at) do update set state = 'scheduled', finished_at = null,
      outcome_reason = null, claim_token = null, claimed_at = null
      where recharge_notification_jobs.state = 'cancelled' and recharge_notification_jobs.attempt_date is null;
  end if;
end;
$$;

create or replace function public.note_recharge_notification_visit(p_owner_hash text)
returns void language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('recharge-notification:' || p_owner_hash, 0));
  v_now := clock_timestamp();
  update public.recharge_notification_settings set last_visit_at = v_now where owner_hash = p_owner_hash and enabled;
  update public.recharge_notification_jobs set state = 'cancelled', finished_at = v_now, outcome_reason = 'visited_since_charge'
    where owner_hash = p_owner_hash and charge_at <= v_now and state in ('scheduled', 'claimed');
end;
$$;

create or replace function public.queue_zero_balance_recharge_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_charge_at timestamptz := new.last_refill_at + interval '3 hours';
begin
  -- No job for 1 -> 2. Preserve the natural three-hour anchor rather than
  -- resetting it to the time a second ticket was spent.
  if new.balance <> 0 or v_charge_at <= clock_timestamp() then return new; end if;
  if tg_op = 'UPDATE' and old.balance = 0 and old.last_refill_at = new.last_refill_at then return new; end if;
  if not exists (select 1 from public.recharge_notification_settings where owner_hash = new.owner_hash and enabled) then return new; end if;
  -- Do not acquire the notification advisory lock while holding the free-ticket
  -- row lock: the worker only reads allowance rows and never changes tickets.
  update public.recharge_notification_jobs set state = 'cancelled', finished_at = clock_timestamp(), outcome_reason = 'new_charge_cycle'
    where owner_hash = new.owner_hash and charge_at <> v_charge_at and state in ('scheduled', 'claimed');
  insert into public.recharge_notification_jobs(owner_hash, charge_at, not_before)
  values (new.owner_hash, v_charge_at, public.recharge_notification_not_before(v_charge_at))
  on conflict (owner_hash, charge_at) do nothing;
  return new;
end;
$$;
drop trigger if exists queue_zero_balance_recharge_notification on public.pet_free_allowances;
create trigger queue_zero_balance_recharge_notification after insert or update of balance, last_refill_at
  on public.pet_free_allowances for each row execute function public.queue_zero_balance_recharge_notification();

create or replace function public.recharge_notification_suppression(
  p_owner_hash text, p_charge_at timestamptz, p_now timestamptz, p_job_id uuid
) returns text language plpgsql security definer set search_path = public as $$
declare v_settings public.recharge_notification_settings; v_balance integer; v_anchor timestamptz;
begin
  select * into v_settings from public.recharge_notification_settings where owner_hash = p_owner_hash;
  if not found or not v_settings.enabled or v_settings.encrypted_anon_key is null then return 'opted_out'; end if;
  if p_now < p_charge_at then return 'not_charged'; end if;
  if v_settings.last_visit_at >= p_charge_at then return 'visited_since_charge'; end if;
  select balance, last_refill_at into v_balance, v_anchor from public.pet_free_allowances where owner_hash = p_owner_hash;
  if not found then return 'allowance_missing'; end if;
  v_balance := least(2, v_balance + greatest(0, floor(extract(epoch from (p_now - v_anchor)) / 10800)::integer));
  if v_balance < 1 then return 'already_used'; end if;
  if (select count(*) from public.daily_house_assignments
      where owner_hash = p_owner_hash and assignment_date = (p_now at time zone 'Asia/Seoul')::date and met_at is not null) >= 4
    then return 'daily_complete'; end if;
  if exists (select 1 from public.recharge_notification_jobs where owner_hash = p_owner_hash
      and attempt_date = (p_now at time zone 'Asia/Seoul')::date and id <> p_job_id)
    then return 'daily_limit'; end if;
  return null;
end;
$$;

create or replace function public.claim_recharge_notification_jobs(p_limit integer default 25)
returns table(job_id uuid, claim_token uuid) language plpgsql security definer set search_path = public as $$
declare v_job public.recharge_notification_jobs; v_now timestamptz := clock_timestamp(); v_token uuid;
begin
  -- A process crash after starting the HTTP request has an unknown outcome.
  -- Never put such jobs back in the queue.
  update public.recharge_notification_jobs set state = 'unknown', finished_at = v_now, outcome_reason = 'worker_interrupted'
    where state = 'sending' and send_started_at < v_now - interval '15 minutes';
  for v_job in select * from public.recharge_notification_jobs
    where not_before <= v_now and (state = 'scheduled' or (state = 'claimed' and claimed_at < v_now - interval '15 minutes'))
    order by not_before, id limit greatest(1, least(p_limit, 100)) for update skip locked
  loop
    if public.recharge_notification_not_before(v_now) > v_now then
      update public.recharge_notification_jobs set state = 'scheduled', not_before = public.recharge_notification_not_before(v_now)
        where id = v_job.id;
      continue;
    end if;
    v_token := gen_random_uuid();
    update public.recharge_notification_jobs set state = 'claimed', claim_token = v_token, claimed_at = v_now where id = v_job.id;
    return query select v_job.id, v_token;
  end loop;
end;
$$;

create or replace function public.prepare_recharge_notification_send(p_job_id uuid, p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.recharge_notification_jobs; v_reason text; v_now timestamptz := clock_timestamp(); v_settings public.recharge_notification_settings;
begin
  select * into v_job from public.recharge_notification_jobs where id = p_job_id;
  if not found then return null; end if;
  -- Consistent lock order with opt-out and visit recording.
  perform pg_advisory_xact_lock(hashtextextended('recharge-notification:' || v_job.owner_hash, 0));
  select * into v_job from public.recharge_notification_jobs where id = p_job_id for update;
  -- A lock wait may cross 21:00, midnight, or the refill boundary.
  v_now := clock_timestamp();
  if v_job.state <> 'claimed' or v_job.claim_token is distinct from p_claim_token then return null; end if;
  if public.recharge_notification_not_before(v_now) > v_now then
    update public.recharge_notification_jobs set state = 'scheduled', not_before = public.recharge_notification_not_before(v_now) where id = p_job_id;
    return null;
  end if;
  v_reason := public.recharge_notification_suppression(v_job.owner_hash, v_job.charge_at, v_now, p_job_id);
  if v_reason is not null then
    update public.recharge_notification_jobs set state = 'skipped', finished_at = v_now, outcome_reason = v_reason where id = p_job_id;
    return null;
  end if;
  select * into v_settings from public.recharge_notification_settings where owner_hash = v_job.owner_hash;
  update public.recharge_notification_jobs set state = 'sending', send_started_at = v_now,
    attempt_date = (v_now at time zone 'Asia/Seoul')::date where id = p_job_id;
  return jsonb_build_object('ownerHash', v_job.owner_hash, 'encryptedAnonymousKey', v_settings.encrypted_anon_key,
    'templateCode', v_settings.template_code);
end;
$$;

create or replace function public.finish_recharge_notification_send(p_job_id uuid, p_claim_token uuid, p_outcome text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_outcome not in ('sent', 'failed', 'unknown') then raise exception 'INVALID_NOTIFICATION_OUTCOME'; end if;
  update public.recharge_notification_jobs set state = p_outcome, finished_at = clock_timestamp(), outcome_reason = left(p_reason, 80)
    where id = p_job_id and claim_token = p_claim_token and state = 'sending';
end;
$$;

-- A server cron invokes the Edge worker once per minute. Both this DB switch
-- and the Edge RECHARGE_NOTIFICATIONS_ENABLED flag start disabled. Store the
-- matching request secret in Supabase Vault, never in SQL or app configuration.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create table if not exists public.recharge_notification_worker_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  function_url text,
  secret_name text not null default 'recharge_notification_cron_secret',
  check (function_url is null or function_url ~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/recharge-notifications$')
);
insert into public.recharge_notification_worker_config(singleton) values (true) on conflict do nothing;
alter table public.recharge_notification_worker_config enable row level security;
revoke all on public.recharge_notification_worker_config from anon, authenticated;
grant select, update on public.recharge_notification_worker_config to service_role;

create or replace function public.dispatch_recharge_notification_worker()
returns void language plpgsql security definer set search_path = public as $$
declare v_config public.recharge_notification_worker_config; v_secret text;
begin
  select * into v_config from public.recharge_notification_worker_config where singleton;
  if not v_config.enabled or v_config.function_url is null then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = v_config.secret_name limit 1;
  if nullif(v_secret, '') is null then return; end if;
  perform net.http_post(url := v_config.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-recharge-cron-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 50000);
end;
$$;

select cron.schedule('recharge-notification-every-minute', '* * * * *', 'select public.dispatch_recharge_notification_worker()');

revoke all on function public.recharge_notification_not_before(timestamptz),
  public.get_recharge_notification_settings(text), public.set_recharge_notification_settings(text,boolean,text,text),
  public.note_recharge_notification_visit(text), public.queue_zero_balance_recharge_notification(),
  public.recharge_notification_suppression(text,timestamptz,timestamptz,uuid),
  public.claim_recharge_notification_jobs(integer), public.prepare_recharge_notification_send(uuid,uuid),
  public.finish_recharge_notification_send(uuid,uuid,text,text), public.dispatch_recharge_notification_worker()
  from public, anon, authenticated;
grant execute on function public.get_recharge_notification_settings(text), public.set_recharge_notification_settings(text,boolean,text,text),
  public.note_recharge_notification_visit(text), public.claim_recharge_notification_jobs(integer),
  public.prepare_recharge_notification_send(uuid,uuid), public.finish_recharge_notification_send(uuid,uuid,text,text)
  to service_role;
