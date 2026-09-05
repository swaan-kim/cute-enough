-- Broad visual similarity created too much review noise. Keep comparison as an
-- informational exact-decoration check only; it must never block approval.
create or replace function public.pet_design_similarity_score(
  p_traits jsonb,
  p_style jsonb,
  p_other_traits jsonb,
  p_other_style jsonb
) returns integer
language sql
immutable
set search_path = public
as $$
  select 0;
$$;

create or replace function public.pet_design_exact_match(
  p_traits jsonb,
  p_style jsonb,
  p_accessory jsonb,
  p_other_traits jsonb,
  p_other_style jsonb,
  p_other_accessory jsonb
) returns boolean
language sql
immutable
set search_path = public
as $$
  select (coalesce(p_traits, '{}'::jsonb) - 'confidence')
      = (coalesce(p_other_traits, '{}'::jsonb) - 'confidence')
    and coalesce(p_style, '{}'::jsonb) = coalesce(p_other_style, '{}'::jsonb)
    and coalesce(p_accessory, 'null'::jsonb) = coalesce(p_other_accessory, 'null'::jsonb);
$$;

revoke all on function public.pet_design_exact_match(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.pet_design_exact_match(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
  to service_role;

drop view if exists public.pending_pet_review_queue;
create view public.pending_pet_review_queue
with (security_barrier = true)
as
select pet.id pet_id,pet.submission_id,pet.name,pet.traits,pet.created_at,pet.storage_path primary_storage_path,
  coalesce(photos.paths,'[]'::jsonb) storage_paths,coalesce(photos.photo_present,false) photo_present,
  pet.accessory_selection_mode,pet.accessory_required,pet.requested_accessory,pet.published_accessory,
  pet.design_version,coalesce(exact_matches.items,'[]'::jsonb) similar_pets,
  pet.submitted_traits,pet.submitted_style,pet.published_style
from public.pets pet
left join lateral (
  select jsonb_agg(photo.storage_path order by photo.sort_order) filter(where photo.is_active) paths,
    bool_or(object.id is not null) filter(where photo.is_active) photo_present
  from public.pet_photos photo left join storage.objects object on object.bucket_id='pet-photos' and object.name=photo.storage_path
  where photo.pet_id=pet.id
) photos on true
left join lateral (
  select jsonb_agg(candidate.item order by candidate.created_at desc) items from (
    select approved.created_at,
      jsonb_build_object(
        'id',approved.id,
        'name',approved.name,
        'traits',approved.traits,
        'publishedStyle',approved.published_style,
        'publishedAccessory',approved.published_accessory,
        'designVersion',approved.design_version,
        'similarityScore',100
      ) item
    from public.pets approved
    where approved.status='approved'
      and approved.id<>pet.id
      and public.pet_design_exact_match(
        coalesce(pet.submitted_traits,pet.traits),
        coalesce(pet.submitted_style,public.infer_pet_style_v1(coalesce(pet.submitted_traits,pet.traits))),
        case when pet.accessory_selection_mode='owner' then pet.requested_accessory else pet.published_accessory end,
        approved.traits,
        approved.published_style,
        approved.published_accessory
      )
    order by approved.created_at desc
    limit 3
  ) candidate
) exact_matches on true
where pet.status='pending';

revoke all on table public.pending_pet_review_queue from public, anon, authenticated;
grant select on table public.pending_pet_review_queue to service_role;

comment on function public.pet_design_exact_match(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
  is 'Exact visual-decoration match for review hints; confidence is intentionally ignored.';
