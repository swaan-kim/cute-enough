-- 새 제출은 승인 후 찰딱 워터마크가 포함된 사진 저장까지 동의한 버전으로 기록한다.
-- 기존 행은 소급 변경하지 않는다. 기존 사진은 소유자의 별도 동의를 확인한 뒤에만 갱신한다.
alter table public.pets
  alter column consent_version set default '2026-08-27-watermark-save';

comment on column public.pets.consent_version is
  '업로드 시 동의한 공개·저장 정책 버전. 2026-08-27-watermark-save부터 워터마크 복사본 저장 포함.';
