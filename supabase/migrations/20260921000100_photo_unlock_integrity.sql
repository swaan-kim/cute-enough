-- A collection grant belongs to one exact photo and that photo's dog.
-- Validate every existing grant; inconsistent history must abort this entire
-- migration rather than be deleted, reassigned, or silently excluded.
begin;

alter table public.pet_photos
  add constraint pet_photos_id_pet_id_key unique (id, pet_id);

-- The old photo-only CASCADE could erase a collection when a photo row was
-- deleted. Keep grants and source identities intact: normal withdrawal uses
-- is_active, and deleting a referenced photo must fail. Pet-level purge rules
-- and service-role privileges are outside this change and remain unchanged.
alter table public.user_photo_unlocks
  add constraint user_photo_unlocks_photo_pet_fkey
    foreign key (photo_id, pet_id) references public.pet_photos (id, pet_id)
    on update no action on delete no action,
  drop constraint user_photo_unlocks_photo_id_fkey;

commit;
