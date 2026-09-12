-- Local candidate only: no existing approved dogs or saved references are rewritten.
begin;

-- Deferring the check lets the approved-state update and PNG attachment happen
-- in either order INSIDE the same transaction, but never commit separately.
create or replace function public.require_reviewed_artwork_for_publication()
returns trigger language plpgsql security definer set search_path=public as $$
declare current_pet public.pets%rowtype; needs_new_image boolean;
begin
  if new.status <> 'approved' then return null; end if;
  needs_new_image := tg_op='INSERT';
  if tg_op='UPDATE' then
    needs_new_image := old.status is distinct from new.status
      or old.design_version is distinct from new.design_version
      or old.traits is distinct from new.traits
      or old.published_style is distinct from new.published_style
      or old.published_accessory is distinct from new.published_accessory;
    needs_new_image := needs_new_image or old.reviewed_artwork is distinct from new.reviewed_artwork;
  end if;
  if not needs_new_image then return null; end if;
  select * into current_pet from public.pets where id=new.id;
  if not found or current_pet.status<>'approved' then return null; end if;
  if current_pet.reviewed_artwork is null
    or (current_pet.reviewed_artwork->>'designVersion')::integer is distinct from current_pet.design_version
    or not exists(select 1 from storage.objects where bucket_id='pet-artwork' and name=current_pet.reviewed_artwork->>'path')
    then raise exception 'REVIEW_ARTWORK_REQUIRED'; end if;
  -- A direct traits update cannot reuse a previous picture merely by leaving its version unchanged.
  if tg_op='UPDATE' and old.status='approved'
    and current_pet.reviewed_artwork->>'path' is not distinct from old.reviewed_artwork->>'path'
    then raise exception 'REVIEW_ARTWORK_REQUIRED'; end if;
  return null;
end; $$;
revoke all on function public.require_reviewed_artwork_for_publication() from public,anon,authenticated,service_role;
drop trigger if exists require_reviewed_artwork_for_publication on public.pets;
create constraint trigger require_reviewed_artwork_for_publication
  after insert or update on public.pets deferrable initially deferred
  for each row execute function public.require_reviewed_artwork_for_publication();

-- The wrappers are SECURITY DEFINER; their internal legacy calls still work.
-- Retire direct service-role access to the old approval/publication entrypoints.
do $$ declare routine record; begin
  for routine in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname ~ '^review_pet_submission(_v[0-9]+)?$'
      or p.proname ~ '^manage_pet_publication(_v[0-9]+)?$')
  loop execute format('revoke execute on function %s from public,anon,authenticated,service_role',routine.signature); end loop;
end; $$;

-- Dry-run inventory only. Keep every current/historical committed image; do not
-- delete on RPC timeouts. Objects must be at least 24h old before even listing.
create or replace view public.unlinked_reviewed_artwork_candidates with (security_barrier=true) as
select object.name storage_path, object.created_at
from storage.objects object
where object.bucket_id='pet-artwork' and object.created_at < now()-interval '24 hours'
  and not exists(select 1 from public.pets pet where pet.reviewed_artwork->>'path'=object.name)
  and not exists(select 1 from public.admin_audit_logs audit where audit.action='review_artwork_saved'
    and (audit.detail->'before'->>'path'=object.name or audit.detail->'after'->>'path'=object.name));
revoke all on public.unlinked_reviewed_artwork_candidates from public,anon,authenticated;
grant select on public.unlinked_reviewed_artwork_candidates to service_role;
commit;
