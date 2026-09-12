-- Additive creator-only review. Never approves a dog or changes its SVG.
begin;
create or replace function public.get_pet_photo_addition_review_queue()
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(item order by created_at), '[]'::jsonb))
  from (
    select b.created_at, jsonb_build_object('batchId', b.id, 'petId', b.pet_id,
      'name', p.name, 'petStatus', p.status, 'createdAt', b.created_at,
      'expectedRevision', public.get_pet_photo_review(p.id)->>'revision',
      'photos', (select jsonb_agg(jsonb_build_object('photoId', i.id, 'storagePath', i.storage_path,
        'available', exists(select 1 from storage.objects o where o.bucket_id='pet-photos' and o.name=i.storage_path))
        order by i.photo_index) from public.pet_photo_addition_items i where i.batch_id=b.id)) item
    from public.pet_photo_addition_submissions b join public.pets p on p.id=b.pet_id
    where b.status='pending' and p.status in ('pending','approved','paused')
  ) q;
$$;

create or replace function public.review_pet_photo_addition(
  p_batch_id uuid, p_expected_revision text, p_decision text, p_note text, p_actor text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pet_id uuid; v_status text; v_batch public.pet_photo_addition_submissions%rowtype;
  v_before jsonb; v_after jsonb; v_next integer; v_count integer;
begin
  if nullif(trim(p_actor),'') is null or char_length(p_actor)>100 then raise exception 'REVIEW_ACTOR_REQUIRED'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') or char_length(coalesce(p_note,''))>500
    or (p_decision='rejected' and nullif(trim(p_note),'') is null) then raise exception 'INVALID_PHOTO_ADDITION_REVIEW'; end if;
  select pet_id into v_pet_id from public.pet_photo_addition_submissions where id=p_batch_id;
  if not found then raise exception 'PHOTO_ADDITION_NOT_FOUND'; end if;
  -- Same parent-first lock order as owner submission and creator photo edits.
  select status into v_status from public.pets where id=v_pet_id for update;
  select * into v_batch from public.pet_photo_addition_submissions where id=p_batch_id for update;
  if v_batch.status <> 'pending' then
    if v_batch.status <> p_decision then raise exception 'PHOTO_ADDITION_ALREADY_REVIEWED'; end if;
    return jsonb_build_object('batchId',p_batch_id,'petId',v_pet_id,'status',v_batch.status);
  end if;
  if v_status not in ('pending','approved','paused') then raise exception 'PHOTO_REVIEW_NOT_ALLOWED'; end if;
  v_before := public.get_pet_photo_review(v_pet_id);
  if p_expected_revision is distinct from v_before->>'revision' then raise exception 'REVIEW_PHOTOS_CHANGED'; end if;
  if p_decision='approved' then
    if v_status not in ('pending','approved') then raise exception 'PHOTO_REVIEW_NOT_ALLOWED'; end if;
    select count(*),coalesce(max(sort_order),-1)+1 into v_count,v_next
      from public.pet_photos where pet_id=v_pet_id and is_active;
    if v_count+v_batch.photo_count>5 or v_next+v_batch.photo_count>16 then raise exception 'PHOTO_ADDITION_CAPACITY_REACHED'; end if;
    if (select count(*) from public.pet_photo_addition_items where batch_id=p_batch_id) <> v_batch.photo_count
      then raise exception 'INVALID_PHOTO_ADDITION_REVIEW'; end if;
    perform 1 from storage.objects o where o.bucket_id='pet-photos' and exists(
      select 1 from public.pet_photo_addition_items i where i.batch_id=p_batch_id and i.storage_path=o.name)
      order by o.name for share;
    if exists(select 1 from public.pet_photo_addition_items i where i.batch_id=p_batch_id and not exists(
      select 1 from storage.objects o where o.bucket_id='pet-photos' and o.name=i.storage_path)) then raise exception 'PET_PHOTO_MISSING'; end if;
  end if;
  update public.pet_photo_addition_submissions set status=p_decision, reviewed_at=clock_timestamp(),
    reviewed_by=trim(p_actor), review_note=nullif(trim(p_note),'') where id=p_batch_id;
  if p_decision='approved' then
    insert into public.pet_photos(pet_id,storage_path,sort_order,is_active)
      select v_pet_id,storage_path,(v_next+photo_index)::smallint,true
      from public.pet_photo_addition_items where batch_id=p_batch_id order by photo_index;
  end if;
  v_after := public.get_pet_photo_review(v_pet_id);
  insert into public.pet_photo_review_audit(pet_id,actor,before_revision,after_revision,before_snapshot,after_snapshot)
    values(v_pet_id,trim(p_actor),v_before->>'revision',v_after->>'revision',v_before,
      v_after || jsonb_build_object('additionBatchId',p_batch_id,'decision',p_decision,'note',nullif(trim(p_note),'')));
  return jsonb_build_object('batchId',p_batch_id,'petId',v_pet_id,'status',p_decision);
end; $$;
revoke all on function public.get_pet_photo_addition_review_queue(),
  public.review_pet_photo_addition(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.get_pet_photo_addition_review_queue(),
  public.review_pet_photo_addition(uuid,text,text,text,text) to service_role;
comment on function public.review_pet_photo_addition(uuid,text,text,text,text) is
  'Explicit creator decision for one immutable batch. Append only; preserve primary photo, SVG, owner values, albums and source files.';
commit;
