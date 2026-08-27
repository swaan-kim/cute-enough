-- 기존 데이터 중 DB 경로만 있고 private Storage 실사가 없는 항목은
-- 사진을 다시 등록할 때까지 집과 공유 화면에 노출하지 않는다.
with missing_photo_pets as (
  select p.id
  from public.pets p
  where p.status in ('pending', 'approved')
    and not exists (
      select 1
      from public.pet_photos pp
      join storage.objects o
        on o.bucket_id = 'pet-photos'
       and o.name = pp.storage_path
      where pp.pet_id = p.id
        and pp.is_active
    )
), paused_pets as (
  update public.pets p
  set status = 'paused',
      owner_pinned_pending = false
  from missing_photo_pets missing
  where p.id = missing.id
  returning p.id
)
insert into public.admin_audit_logs(pet_id, actor, action, detail)
select
  id,
  'migration:202608270003',
  'pause_missing_pet_photo',
  jsonb_build_object('reason', 'active storage object not found')
from paused_pets;
