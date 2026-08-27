-- Support multiple private photos per approved pet.
create table if not exists public.pet_photos (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  storage_path text not null unique,
  sort_order smallint not null default 0 check (sort_order between 0 and 15),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (pet_id, sort_order)
);

create index if not exists pet_photos_active_idx
  on public.pet_photos(pet_id, is_active, sort_order);

alter table public.pet_photos enable row level security;
revoke all on table public.pet_photos from public, anon, authenticated;
grant select, insert, update, delete on table public.pet_photos to service_role;

-- 기존 단일 사진은 0번 대표 사진으로 이관해 이전 앱과 새 Edge Function이 함께 동작한다.
insert into public.pet_photos (pet_id, storage_path, sort_order, is_active)
select id, storage_path, 0, true
from public.pets
on conflict do nothing;

create or replace function public.sync_primary_pet_photo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.pet_photos (pet_id, storage_path, sort_order, is_active)
  values (new.id, new.storage_path, 0, true)
  on conflict (pet_id, sort_order) do update
    set storage_path = excluded.storage_path,
        is_active = true;
  return new;
end;
$$;

revoke all on function public.sync_primary_pet_photo() from public, anon, authenticated;

drop trigger if exists sync_primary_pet_photo_trigger on public.pets;
create trigger sync_primary_pet_photo_trigger
after insert or update of storage_path on public.pets
for each row execute function public.sync_primary_pet_photo();

comment on table public.pet_photos is
  '한 실제 강아지에 연결된 검수 완료 실사. 일반 제출은 0번 한 장, 운영자 선별 강아지는 여러 장을 가질 수 있다.';
