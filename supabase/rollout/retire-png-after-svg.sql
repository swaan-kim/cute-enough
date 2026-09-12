-- MANUAL POST-ROLLOUT CANDIDATE, deliberately outside migrations.
-- Preconditions: creator-confirmed conversion of every approved/paused pet,
-- deployed SVG AIT + verified user surfaces, PET_REQUIRE_SVG_DESIGN=true,
-- and Storage API cleanup of pet-artwork objects after those checks.
-- No dog approval, real photograph deletion, album changes or audit deletion.
begin;
do $$ begin
  if exists(select 1 from public.pets p where p.status in ('approved','paused')
    and not exists(select 1 from public.pet_design_versions d where d.id=p.published_design_id
      and d.pet_id=p.id and d.design_version=p.design_version)) then
    raise exception 'SVG_TRANSITION_INCOMPLETE';
  end if;
  if exists(select 1 from storage.objects where bucket_id='pet-artwork') then
    raise exception 'PNG_STORAGE_CLEANUP_PENDING';
  end if;
end; $$;

drop trigger if exists require_reviewed_artwork_for_publication on public.pets;
drop function if exists public.require_reviewed_artwork_for_publication();
drop function if exists public.review_pet_submission_with_artwork(uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,integer);
drop function if exists public.manage_pet_publication_with_artwork(uuid,text,text,jsonb,jsonb,jsonb,text,jsonb,integer);
drop function if exists public.attach_reviewed_pet_artwork(uuid,text,jsonb);
drop view if exists public.unlinked_reviewed_artwork_candidates;
drop view public.pet_review_catalog;
create view public.pet_review_catalog with (security_barrier=true) as
select pet.id pet_id,pet.name,pet.status,pet.submitted_traits,pet.submitted_style,pet.traits,
  pet.published_style,pet.published_accessory,pet.design_version,pet.reviewed_at,pet.review_note,pet.published_design_id
from public.pets pet where pet.status in ('approved','paused');
revoke all on public.pet_review_catalog from public,anon,authenticated;
grant select on public.pet_review_catalog to service_role;
alter table public.pets drop column reviewed_artwork;
delete from storage.buckets where id='pet-artwork';
-- Old approval functions are already uncallable by service_role after migration003;
-- remove their definitions in dependency order once all external tooling is migrated.
drop function if exists public.review_pet_submission_v5(uuid,text,text,text,text,jsonb,jsonb,jsonb,text);
drop function if exists public.review_pet_submission_v4(uuid,text,text,text,text,jsonb,jsonb,jsonb,text);
drop function if exists public.review_pet_submission_v3(uuid,text,text,text,jsonb,jsonb,jsonb,text);
drop function if exists public.review_pet_submission(uuid,text,text,text);
drop function if exists public.review_pet_submission_v2(uuid,text,text,text,jsonb,text);
drop function if exists public.manage_pet_publication_v3(uuid,text,text,jsonb,jsonb,jsonb,text);
commit;
