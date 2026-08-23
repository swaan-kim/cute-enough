alter table public.pets drop constraint if exists pets_name_check;

alter table public.pets
  add constraint pets_name_check
  check (name is null or char_length(name) <= 4)
  not valid;
