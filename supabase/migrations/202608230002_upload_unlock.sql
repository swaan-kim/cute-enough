alter table public.daily_reveals
  drop constraint if exists daily_reveals_unlock_method_check;
alter table public.daily_reveals
  drop constraint if exists rewarded_requires_session;

alter table public.daily_reveals
  add constraint daily_reveals_unlock_method_check
  check (unlock_method in ('FREE', 'REWARDED', 'UPLOAD'));
alter table public.daily_reveals
  add constraint rewarded_requires_session check (
    (unlock_method in ('FREE', 'UPLOAD') and ad_session_id is null) or
    (unlock_method = 'REWARDED' and ad_session_id is not null)
  );

create unique index if not exists reveals_one_upload_idx
  on public.daily_reveals(owner_hash, reveal_date)
  where unlock_method = 'UPLOAD';
