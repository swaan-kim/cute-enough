-- Harden idempotent submissions and global upload capacity.
alter table public.pets
  add column if not exists submission_id uuid;

create unique index if not exists pets_owner_submission_idx
  on public.pets(owner_hash, submission_id)
  where submission_id is not null;

create index if not exists pets_created_at_idx
  on public.pets(created_at);

create unique index if not exists reveals_one_pet_per_day_idx
  on public.daily_reveals(owner_hash, reveal_date, pet_id);

update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg']
where id = 'pet-photos';

delete from public.pet_api_rate_limits where action = 'delete';
alter table public.pet_api_rate_limits
  drop constraint if exists pet_api_rate_limits_action_check;
alter table public.pet_api_rate_limits
  add constraint pet_api_rate_limits_action_check
  check (action in ('house', 'shared', 'mine', 'reveal', 'submit', 'report'));

create or replace function public.register_pet_submission(
  p_owner_hash text,
  p_submission_id uuid,
  p_pet_id uuid,
  p_storage_path text,
  p_name text,
  p_traits jsonb,
  p_reveal_date date,
  p_global_daily_limit integer,
  p_global_pending_limit integer
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
  if global_daily_count >= p_global_daily_limit then
    raise exception 'UPLOAD_CAPACITY_REACHED';
  end if;

  select count(*) into global_pending_count
  from public.pets as p
  where p.status = 'pending';
  if global_pending_count >= p_global_pending_limit then
    raise exception 'UPLOAD_CAPACITY_REACHED';
  end if;

  select count(*) into owner_daily_count
  from public.pets as p
  where p.owner_hash = p_owner_hash
    and p.created_at >= day_start
    and p.created_at < day_end;
  if owner_daily_count >= 1 then
    raise exception 'DAILY_UPLOAD_LIMIT_REACHED';
  end if;

  select count(*) into owner_pending_count
  from public.pets as p
  where p.owner_hash = p_owner_hash and p.status = 'pending';
  if owner_pending_count >= 3 then
    raise exception 'PENDING_UPLOAD_LIMIT_REACHED';
  end if;

  insert into public.pets(
    id, owner_hash, submission_id, name, storage_path, traits, status, moderation
  ) values (
    p_pet_id,
    p_owner_hash,
    p_submission_id,
    p_name,
    p_storage_path,
    p_traits,
    'pending',
    jsonb_build_object(
      'automatic', 'not_run',
      'source', 'local_color_suggestion',
      'requiresHumanReview', true,
      'serverReencoded', true
    )
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

revoke all on function public.register_pet_submission(text,uuid,uuid,text,text,jsonb,date,integer,integer)
  from public, anon, authenticated;
grant execute on function public.register_pet_submission(text,uuid,uuid,text,text,jsonb,date,integer,integer)
  to service_role;
