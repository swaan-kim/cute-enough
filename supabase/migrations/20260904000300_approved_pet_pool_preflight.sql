-- Read-only operational preflight for the public house candidate pool.
-- A dog counts only when it is approved, has an active photo row, and the
-- corresponding object still exists in the private pet-photos bucket.
create or replace function public.get_approved_active_photo_pet_pool()
returns table (
  pet_id uuid,
  name text,
  active_photo_count integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    pet.id as pet_id,
    pet.name,
    count(distinct photo.id)::integer as active_photo_count
  from public.pets as pet
  join public.pet_photos as photo
    on photo.pet_id = pet.id
   and photo.is_active = true
  join storage.objects as object
    on object.bucket_id = 'pet-photos'
   and object.name = photo.storage_path
  where pet.status = 'approved'
  group by pet.id, pet.name
  order by lower(pet.name), pet.id;
$$;

revoke all on function public.get_approved_active_photo_pet_pool()
  from public, anon, authenticated;
grant execute on function public.get_approved_active_photo_pet_pool()
  to service_role;

comment on function public.get_approved_active_photo_pet_pool() is
  'Service-role-only, read-only list of approved pets backed by active objects in private Storage.';
