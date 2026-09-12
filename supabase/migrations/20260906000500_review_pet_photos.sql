-- Creator-only photo selection. Keep exact photo identities and every historical
-- entitlement; removing a photo from this selection never deletes the source.
begin;

create table public.pet_photo_review_audit (
  id bigint generated always as identity primary key,
  pet_id uuid not null references public.pets(id),
  actor text not null check (length(trim(actor)) > 0),
  before_revision text not null check (before_revision ~ '^[0-9a-f]{64}$'),
  after_revision text not null check (after_revision ~ '^[0-9a-f]{64}$'),
  before_snapshot jsonb not null check (jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot jsonb not null check (jsonb_typeof(after_snapshot) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
create index pet_photo_review_audit_pet_idx
  on public.pet_photo_review_audit(pet_id, id desc);
alter table public.pet_photo_review_audit enable row level security;
revoke all on public.pet_photo_review_audit from public, anon, authenticated, service_role;
grant select on public.pet_photo_review_audit to service_role;

create or replace function public.get_pet_photo_review(p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_photos jsonb; v_state jsonb;
begin
  if not exists(select 1 from public.pets where id = p_pet_id
    and status in ('pending', 'approved', 'paused')) then
    raise exception 'PHOTO_REVIEW_NOT_ALLOWED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'photoId', photo.id, 'storagePath', photo.storage_path,
    'caption', photo.caption, 'sortOrder', photo.sort_order,
    'isActive', photo.is_active,
    'available', exists(select 1 from storage.objects object
      where object.bucket_id = 'pet-photos' and object.name = photo.storage_path)
  ) order by photo.is_active desc,
    case when photo.is_active then photo.sort_order end nulls last, photo.id), '[]'::jsonb)
  into v_photos from public.pet_photos photo where photo.pet_id = p_pet_id;
  v_state := jsonb_build_object('petId', p_pet_id, 'photos', v_photos);
  -- Stable content only: no signed URL, timestamps or SVG/publication fields.
  return v_state || jsonb_build_object('revision', public.pet_design_sha256(v_state));
end; $$;

create or replace function public.save_pet_photo_review(
  p_pet_id uuid, p_expected_revision text, p_photos jsonb, p_actor text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before jsonb; v_after jsonb; v_photo jsonb; v_ids uuid[] := '{}';
  v_photo_id uuid; v_caption text; v_first_path text;
begin
  if nullif(trim(p_actor), '') is null then raise exception 'REVIEW_ACTOR_REQUIRED'; end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    raise exception 'INVALID_REVIEW_PHOTOS';
  end if;
  if jsonb_array_length(p_photos) not between 1 and 16 then
    raise exception 'INVALID_REVIEW_PHOTOS';
  end if;
  for v_photo in select value from jsonb_array_elements(p_photos) loop
    if jsonb_typeof(v_photo) <> 'object' then raise exception 'INVALID_REVIEW_PHOTOS'; end if;
    if not (v_photo ?& array['photoId', 'caption'])
      or exists(select 1 from jsonb_object_keys(v_photo) k where k not in ('photoId', 'caption'))
      or jsonb_typeof(v_photo->'photoId') is distinct from 'string'
      or coalesce(v_photo->>'photoId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_photo->'caption') not in ('string', 'null') then
      raise exception 'INVALID_REVIEW_PHOTOS';
    end if;
    v_photo_id := (v_photo->>'photoId')::uuid;
    if v_photo_id = any(v_ids) then raise exception 'INVALID_REVIEW_PHOTOS'; end if;
    v_ids := array_append(v_ids, v_photo_id);
    v_caption := v_photo->>'caption';
    if v_caption is not null and (char_length(v_caption) > 30 or v_caption ~ '[<>[:cntrl:]]'
      or v_caption ~ U&'[\200B-\200F\2028-\202E\2060-\206F\FEFF]') then
      raise exception 'INVALID_REVIEW_PHOTOS';
    end if;
  end loop;

  -- Serializes editors, status changes and photo inserts (the latter take the
  -- parent FK key-share lock). Lock existing rows before checking the revision.
  perform 1 from public.pets where id = p_pet_id
    and status in ('pending', 'approved', 'paused') for update;
  if not found then raise exception 'PHOTO_REVIEW_NOT_ALLOWED'; end if;
  perform 1 from public.pet_photos where pet_id = p_pet_id order by id for update;
  -- Existing source objects cannot disappear between validation and commit.
  perform 1 from storage.objects object
    where object.bucket_id = 'pet-photos' and exists(select 1 from public.pet_photos photo
      where photo.pet_id = p_pet_id and photo.storage_path = object.name)
    order by object.name for share;
  v_before := public.get_pet_photo_review(p_pet_id);
  if p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{64}$'
    or p_expected_revision is distinct from v_before->>'revision' then
    raise exception 'REVIEW_PHOTOS_CHANGED';
  end if;
  if (select count(*) from public.pet_photos where pet_id = p_pet_id and id = any(v_ids))
    <> cardinality(v_ids) then raise exception 'INVALID_REVIEW_PHOTOS'; end if;
  if exists(select 1 from public.pet_photos photo where photo.pet_id = p_pet_id and photo.id = any(v_ids)
    and not exists(select 1 from storage.objects object
      where object.bucket_id = 'pet-photos' and object.name = photo.storage_path)) then
    raise exception 'PET_PHOTO_MISSING';
  end if;

  -- Free unique (pet_id, sort_order) slots before assigning the submitted order.
  -- Withdrawn captions/IDs/paths remain intact for later restoration and audit.
  update public.pet_photos set is_active = false, sort_order = null where pet_id = p_pet_id;
  update public.pet_photos photo set is_active = true, sort_order = (item.ordinal - 1)::smallint,
    caption = item.value->>'caption'
    from jsonb_array_elements(p_photos) with ordinality item(value, ordinal)
    where photo.pet_id = p_pet_id and photo.id = (item.value->>'photoId')::uuid;
  select storage_path into v_first_path from public.pet_photos
    where pet_id = p_pet_id and id = v_ids[1] and sort_order = 0;
  -- The existing sync_primary_pet_photo trigger now finds this exact same ID
  -- at slot zero, so it cannot withdraw it or create a replacement identity.
  update public.pets set storage_path = v_first_path
    where id = p_pet_id and storage_path is distinct from v_first_path;

  v_after := public.get_pet_photo_review(p_pet_id);
  insert into public.pet_photo_review_audit(
    pet_id, actor, before_revision, after_revision, before_snapshot, after_snapshot
  ) values(p_pet_id, trim(p_actor), v_before->>'revision', v_after->>'revision', v_before, v_after);
  return v_after;
end; $$;

revoke all on function public.get_pet_photo_review(uuid) from public, anon, authenticated;
revoke all on function public.save_pet_photo_review(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.get_pet_photo_review(uuid) to service_role;
grant execute on function public.save_pet_photo_review(uuid, text, jsonb, text) to service_role;
comment on table public.pet_photo_review_audit is
  'Creator photo selection history. Exclusion never deletes photos, Storage objects or collection records.';
comment on function public.save_pet_photo_review(uuid, text, jsonb, text) is
  'Creator-only atomic ordering, captions and soft exclusion/restoration. Does not approve pets or publish SVG designs.';
commit;
