-- Immutable PNG bytes live in private Storage; approval and the current image
-- pointer commit together. No existing pet is approved or rewritten here.
begin;

alter table public.pets add column if not exists reviewed_artwork jsonb;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('pet-artwork','pet-artwork',false,2097152,array['image/png'])
on conflict (id) do nothing;

create or replace function public.attach_reviewed_pet_artwork(p_pet_id uuid,p_actor text,p_artwork jsonb)
returns void language plpgsql security definer set search_path=public,storage as $$
declare old_artwork jsonb; current_version integer; stored_artwork jsonb;
begin
  if p_artwork is null or jsonb_typeof(p_artwork)<>'object'
    or coalesce(p_artwork->>'path','') !~ ('^'||p_pet_id::text||'/[0-9a-f-]{36}\.png$')
    or coalesce(p_artwork->>'sha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_artwork->>'width','') !~ '^[0-9]{1,4}$'
    or coalesce(p_artwork->>'height','') !~ '^[0-9]{1,4}$'
    then raise exception 'REVIEW_ARTWORK_REQUIRED'; end if;
  if (p_artwork->>'width')::integer not between 1 and 1536
    or (p_artwork->>'height')::integer not between 1 and 1536
    then raise exception 'INVALID_REVIEW_ARTWORK'; end if;
  if not exists(select 1 from storage.objects where bucket_id='pet-artwork' and name=p_artwork->>'path')
    then raise exception 'REVIEW_ARTWORK_MISSING'; end if;
  select reviewed_artwork,design_version into old_artwork,current_version from public.pets where id=p_pet_id for update;
  if not found then raise exception 'PET_NOT_FOUND'; end if;
  stored_artwork:=jsonb_build_object('path',p_artwork->>'path','sha256',p_artwork->>'sha256',
    'width',(p_artwork->>'width')::integer,'height',(p_artwork->>'height')::integer,
    'rendererVersion','review-png-v1','savedAt',now(),'designVersion',current_version);
  update public.pets set reviewed_artwork=stored_artwork where id=p_pet_id;
  insert into public.admin_audit_logs(pet_id,actor,action,detail)
    values(p_pet_id,trim(p_actor),'review_artwork_saved',jsonb_build_object('before',old_artwork,'after',stored_artwork));
end; $$;

create or replace function public.review_pet_submission_with_artwork(
  p_pet_id uuid,p_decision text,p_actor text,p_reason text default null,p_final_name text default null,
  p_final_traits jsonb default null,p_final_style jsonb default null,p_published_accessory jsonb default null,
  p_review_note text default null,p_artwork jsonb default null,p_expected_design_version integer default null
) returns public.pet_status language plpgsql security definer set search_path=public,storage as $$
declare current_pet public.pets%rowtype; result public.pet_status;
begin
  select * into current_pet from public.pets where id=p_pet_id and status='pending' for update;
  if not found then raise exception 'PET_NOT_PENDING'; end if;
  if p_decision='approved' and (p_artwork is null or p_expected_design_version is null)
    then raise exception 'REVIEW_ARTWORK_REQUIRED'; end if;
  if p_expected_design_version is not null and current_pet.design_version<>p_expected_design_version
    then raise exception 'REVIEW_DESIGN_CHANGED'; end if;
  if to_regprocedure('public.review_pet_submission_v5(uuid,text,text,text,text,jsonb,jsonb,jsonb,text)') is not null then
    result:=public.review_pet_submission_v5(p_pet_id,p_decision,p_actor,p_reason,p_final_name,p_final_traits,p_final_style,p_published_accessory,p_review_note);
  else
    result:=public.review_pet_submission_v4(p_pet_id,p_decision,p_actor,p_reason,p_final_name,p_final_traits,p_final_style,p_published_accessory,p_review_note);
  end if;
  if result='approved' then perform public.attach_reviewed_pet_artwork(p_pet_id,p_actor,p_artwork); end if;
  return result;
end; $$;

create or replace function public.manage_pet_publication_with_artwork(
  p_pet_id uuid,p_action text,p_actor text,p_final_traits jsonb default null,p_final_style jsonb default null,
  p_published_accessory jsonb default null,p_review_note text default null,p_artwork jsonb default null,
  p_expected_design_version integer default null
) returns public.pet_status language plpgsql security definer set search_path=public,storage as $$
declare current_pet public.pets%rowtype; result public.pet_status;
begin
  select * into current_pet from public.pets where id=p_pet_id and status in ('approved','paused') for update;
  if not found then raise exception 'PET_NOT_MANAGEABLE'; end if;
  if p_action<>'pause' and (p_artwork is null or p_expected_design_version is null)
    then raise exception 'REVIEW_ARTWORK_REQUIRED'; end if;
  if p_expected_design_version is not null and current_pet.design_version<>p_expected_design_version
    then raise exception 'REVIEW_DESIGN_CHANGED'; end if;
  result:=public.manage_pet_publication_v3(p_pet_id,p_action,p_actor,p_final_traits,p_final_style,p_published_accessory,p_review_note);
  if p_action<>'pause' then perform public.attach_reviewed_pet_artwork(p_pet_id,p_actor,p_artwork); end if;
  return result;
end; $$;

revoke all on function public.attach_reviewed_pet_artwork(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.review_pet_submission_with_artwork(uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.manage_pet_publication_with_artwork(uuid,text,text,jsonb,jsonb,jsonb,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.review_pet_submission_with_artwork(uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,integer) to service_role;
grant execute on function public.manage_pet_publication_with_artwork(uuid,text,text,jsonb,jsonb,jsonb,text,jsonb,integer) to service_role;

create or replace view public.pet_review_catalog with (security_barrier=true) as
select pet.id pet_id,pet.name,pet.status,pet.submitted_traits,pet.submitted_style,pet.traits,
  pet.published_style,pet.published_accessory,pet.design_version,pet.reviewed_at,pet.review_note,pet.reviewed_artwork
from public.pets pet where pet.status in ('approved','paused');
revoke all on table public.pet_review_catalog from public,anon,authenticated;
grant select on table public.pet_review_catalog to service_role;
commit;
