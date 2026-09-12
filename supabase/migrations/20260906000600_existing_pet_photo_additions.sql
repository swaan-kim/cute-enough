-- Owner photo additions are private proposals. Only a separate, explicit
-- creator review may promote them into pet_photos. No existing dog is changed.
begin;

create table public.pet_photo_addition_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null check (length(owner_hash) > 0),
  submission_id uuid not null,
  pet_id uuid not null references public.pets(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  photo_count smallint not null check (photo_count between 1 and 5),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text check (char_length(review_note) <= 500),
  unique (owner_hash, submission_id)
);
create unique index pet_photo_addition_one_pending_idx
  on public.pet_photo_addition_submissions(pet_id) where status = 'pending';
create index pet_photo_addition_pet_history_idx
  on public.pet_photo_addition_submissions(pet_id, created_at desc, id desc);

create table public.pet_photo_addition_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.pet_photo_addition_submissions(id),
  photo_index smallint not null check (photo_index between 0 and 4),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (batch_id, photo_index)
);

alter table public.pet_photo_addition_submissions enable row level security;
alter table public.pet_photo_addition_items enable row level security;
revoke all on public.pet_photo_addition_submissions, public.pet_photo_addition_items
  from public, anon, authenticated, service_role;
grant select on public.pet_photo_addition_submissions, public.pet_photo_addition_items to service_role;

create or replace function public.get_pet_photo_addition_status(
  p_owner_hash text, p_pet_id uuid, p_submission_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pet public.pets%rowtype;
  v_batch public.pet_photo_addition_submissions%rowtype;
  v_active integer; v_pending integer; v_remaining integer; v_reason text;
  v_result jsonb;
begin
  if nullif(p_owner_hash,'') is null or p_pet_id is null then raise exception 'INVALID_PHOTO_ADDITION_INPUT'; end if;
  -- A shared parent lock keeps the successive counts consistent with creator
  -- edits and submissions even under READ COMMITTED isolation.
  select * into v_pet from public.pets where id = p_pet_id and owner_hash = p_owner_hash for share;
  if not found then raise exception 'PHOTO_ADDITION_PET_NOT_FOUND'; end if;
  select count(*)::integer into v_active from public.pet_photos where pet_id = p_pet_id and is_active;
  select coalesce(sum(photo_count),0)::integer into v_pending
    from public.pet_photo_addition_submissions where pet_id = p_pet_id and status = 'pending';
  v_remaining := greatest(0, 5 - v_active - v_pending);
  v_reason := case when v_pet.status not in ('pending','approved') then 'PHOTO_ADDITION_NOT_ALLOWED'
    when v_pending > 0 then 'PHOTO_ADDITION_PENDING'
    when v_remaining = 0 then 'PHOTO_ADDITION_CAPACITY_REACHED' else null end;
  select * into v_batch from public.pet_photo_addition_submissions
    where pet_id = p_pet_id and owner_hash = p_owner_hash
      and (p_submission_id is null or submission_id = p_submission_id)
    order by (status = 'pending') desc, created_at desc, id desc limit 1;
  v_result := jsonb_build_object('petId',p_pet_id,'activePhotoCount',v_active,
    'pendingPhotoCount',v_pending,'maxPhotoCount',5,'remainingCount',v_remaining,'canSubmit',v_reason is null);
  if v_reason is not null then v_result := v_result || jsonb_build_object('unavailableReason',v_reason); end if;
  if p_submission_id is not null then v_result := v_result || jsonb_build_object('found',v_batch.id is not null); end if;
  if v_batch.id is not null then
    v_result := v_result || jsonb_build_object('submission',jsonb_strip_nulls(jsonb_build_object(
      'submissionId',v_batch.submission_id,'petId',v_batch.pet_id,'status',v_batch.status,
      'photoCount',v_batch.photo_count,'createdAt',v_batch.created_at,'reviewNote',v_batch.review_note)));
  end if;
  return v_result;
end; $$;

-- Lock the same parent as creator photo review, and recheck before every
-- upload. Staging never reserves a batch or consumes a dog/reward allowance.
create or replace function public.prepare_pet_photo_addition(
  p_owner_hash text, p_pet_id uuid, p_submission_id uuid, p_photo_index integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.pet_photo_addition_submissions%rowtype; v_state jsonb;
begin
  if nullif(p_owner_hash,'') is null or p_pet_id is null or p_submission_id is null
    then raise exception 'INVALID_PHOTO_ADDITION_INPUT'; end if;
  perform 1 from public.pets where id = p_pet_id and owner_hash = p_owner_hash for update;
  if not found then raise exception 'PHOTO_ADDITION_PET_NOT_FOUND'; end if;
  select * into v_existing from public.pet_photo_addition_submissions
    where owner_hash = p_owner_hash and submission_id = p_submission_id;
  if found then
    if v_existing.pet_id <> p_pet_id then raise exception 'PHOTO_ADDITION_CONFLICT'; end if;
    raise exception 'PHOTO_ADDITION_ALREADY_SUBMITTED';
  end if;
  v_state := public.get_pet_photo_addition_status(p_owner_hash,p_pet_id,p_submission_id);
  if not (v_state->>'canSubmit')::boolean then raise exception '%',v_state->>'unavailableReason'; end if;
  if p_photo_index is null or p_photo_index not between 0 and 4 then raise exception 'INVALID_PHOTO_INDEX'; end if;
  if p_photo_index >= (v_state->>'remainingCount')::integer then raise exception 'PHOTO_ADDITION_CAPACITY_REACHED'; end if;
  return v_state;
end; $$;

create or replace function public.submit_pet_photo_addition(
  p_owner_hash text, p_pet_id uuid, p_submission_id uuid,
  p_storage_paths text[], p_photo_sha256 text[]
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.pet_photo_addition_submissions%rowtype;
  v_state jsonb; v_batch_id uuid; v_photo record;
begin
  if nullif(p_owner_hash,'') is null or p_pet_id is null or p_submission_id is null
    then raise exception 'INVALID_PHOTO_ADDITION_INPUT'; end if;
  -- Serializes cap/count decisions, creator edits, status changes and retries.
  perform 1 from public.pets where id = p_pet_id and owner_hash = p_owner_hash for update;
  if not found then raise exception 'PHOTO_ADDITION_PET_NOT_FOUND'; end if;
  -- Protect reuse of one owner request ID across two different dogs as well.
  perform pg_advisory_xact_lock(hashtextextended('pet-photo-addition:'||p_owner_hash||':'||p_submission_id::text,0));
  select * into v_existing from public.pet_photo_addition_submissions
    where owner_hash = p_owner_hash and submission_id = p_submission_id;
  if found then
    if v_existing.pet_id <> p_pet_id then raise exception 'PHOTO_ADDITION_CONFLICT'; end if;
    -- Return the immutable first result even after rejection/approval, expired
    -- receipts, or a later moderation status change. Never append or reward.
    v_state := public.get_pet_photo_addition_status(p_owner_hash,p_pet_id,p_submission_id);
    return jsonb_build_object('submission',v_state->'submission','remainingCount',v_state->'remainingCount');
  end if;
  v_state := public.get_pet_photo_addition_status(p_owner_hash,p_pet_id,p_submission_id);
  if not (v_state->>'canSubmit')::boolean then raise exception '%',v_state->>'unavailableReason'; end if;
  if p_storage_paths is null or cardinality(p_storage_paths) not between 1 and 5
    or array_ndims(p_storage_paths) <> 1 or array_lower(p_storage_paths,1) <> 1
    or p_photo_sha256 is null or cardinality(p_photo_sha256) <> cardinality(p_storage_paths)
    or array_ndims(p_photo_sha256) <> 1 or array_lower(p_photo_sha256,1) <> 1
    then raise exception 'INVALID_PHOTO_COUNT'; end if;
  if cardinality(p_storage_paths) > (v_state->>'remainingCount')::integer
    then raise exception 'PHOTO_ADDITION_CAPACITY_REACHED'; end if;
  for v_photo in select path,ordinality from unnest(p_storage_paths) with ordinality as photo(path,ordinality) loop
    if v_photo.path is null or not starts_with(v_photo.path,
      p_owner_hash||'/'||p_submission_id::text||'/photo-addition/'||p_pet_id::text||'/staged/'||(v_photo.ordinality-1)::text||'-')
      or substring(v_photo.path from length(p_owner_hash||'/'||p_submission_id::text||'/photo-addition/'||p_pet_id::text||'/staged/')+1)
        !~ '^[0-4]-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jpg$'
      or p_photo_sha256[v_photo.ordinality] is null or p_photo_sha256[v_photo.ordinality] !~ '^[0-9a-f]{64}$'
      then raise exception 'INVALID_PHOTO_PATH'; end if;
    perform 1 from storage.objects where bucket_id = 'pet-photos' and name = v_photo.path for share;
    if not found then raise exception 'PET_PHOTO_MISSING'; end if;
  end loop;
  insert into public.pet_photo_addition_submissions(owner_hash,submission_id,pet_id,photo_count)
    values(p_owner_hash,p_submission_id,p_pet_id,cardinality(p_storage_paths)) returning id into v_batch_id;
  insert into public.pet_photo_addition_items(batch_id,photo_index,storage_path,sha256)
    select v_batch_id,(ordinality-1)::smallint,path,p_photo_sha256[ordinality]
    from unnest(p_storage_paths) with ordinality as photo(path,ordinality);
  v_state := public.get_pet_photo_addition_status(p_owner_hash,p_pet_id,p_submission_id);
  return jsonb_build_object('submission',v_state->'submission','remainingCount',v_state->'remainingCount');
end; $$;

-- A later creator restore must honor pending reservations too. Deferred checks
-- let a future explicit review atomically transition its batch and add photos.
-- Historical dogs over five photos without pending additions remain valid.
create or replace function public.guard_pet_photo_addition_capacity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pet_id uuid; v_pending integer; v_active integer;
begin
  v_pet_id := case when tg_op = 'DELETE' then old.pet_id else new.pet_id end;
  perform 1 from public.pets where id = v_pet_id for update;
  select coalesce(sum(photo_count),0)::integer into v_pending
    from public.pet_photo_addition_submissions where pet_id = v_pet_id and status = 'pending';
  if v_pending > 0 then
    select count(*)::integer into v_active from public.pet_photos where pet_id = v_pet_id and is_active;
    if v_active + v_pending > 5 then raise exception 'PHOTO_ADDITION_CAPACITY_REACHED'; end if;
  end if;
  return null;
end; $$;
create constraint trigger pet_photo_addition_active_capacity
  after insert or update or delete on public.pet_photos deferrable initially deferred
  for each row execute function public.guard_pet_photo_addition_capacity();
create constraint trigger pet_photo_addition_pending_capacity
  after insert or update or delete on public.pet_photo_addition_submissions deferrable initially deferred
  for each row execute function public.guard_pet_photo_addition_capacity();

revoke all on function public.get_pet_photo_addition_status(text,uuid,uuid),
  public.prepare_pet_photo_addition(text,uuid,uuid,integer),
  public.submit_pet_photo_addition(text,uuid,uuid,text[],text[]),
  public.guard_pet_photo_addition_capacity() from public,anon,authenticated;
grant execute on function public.get_pet_photo_addition_status(text,uuid,uuid),
  public.prepare_pet_photo_addition(text,uuid,uuid,integer),
  public.submit_pet_photo_addition(text,uuid,uuid,text[],text[]) to service_role;

alter table public.pet_api_rate_limits drop constraint if exists pet_api_rate_limits_action_check;
alter table public.pet_api_rate_limits add constraint pet_api_rate_limits_action_check
  check(action in ('house','shared','mine','artwork','design','reveal','ownerPhoto','submit','submitPhoto','submissionStatus','report',
    'photoAdditionStatus','photoAdditionUpload','photoAdditionSubmit',
    'album','albumPhoto','setFavorite','rewardStart','rewardComplete','rewardCancel','rewardStatus',
    'rewardRebind','shareStart','shareReward','shareClose','notificationSettings','setNotificationSettings'));

comment on table public.pet_photo_addition_submissions is
  'Private owner proposals for an existing dog. Submission never approves a dog or photo, grants a reward, or changes its current appearance.';
comment on table public.pet_photo_addition_items is
  'Private immutable staged photo identities, separate from pet_photos and all album readers. Preserve sources and submission history after review.';
commit;
