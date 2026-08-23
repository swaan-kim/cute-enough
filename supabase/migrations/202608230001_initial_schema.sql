create extension if not exists pgcrypto;

do $$ begin
  create type public.pet_status as enum ('pending', 'approved', 'rejected', 'paused', 'deleted');
exception when duplicate_object then null;
end $$;

create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null,
  name text check (char_length(name) <= 12),
  storage_path text not null unique,
  status public.pet_status not null default 'pending',
  traits jsonb not null,
  moderation jsonb not null default '{}'::jsonb,
  rejection_reason text,
  reports_count integer not null default 0 check (reports_count >= 0),
  owner_pinned_pending boolean not null default false,
  consent_version text not null default '2026-08-23',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  deleted_at timestamptz
);

create index if not exists pets_feed_idx on public.pets(status, created_at desc);
create index if not exists pets_owner_idx on public.pets(owner_hash, created_at desc);

create table if not exists public.daily_reveals (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null,
  reveal_date date not null,
  pet_id uuid not null references public.pets(id),
  unlock_method text not null check (unlock_method in ('FREE', 'REWARDED', 'UPLOAD')),
  ad_session_id uuid,
  created_at timestamptz not null default now(),
  constraint rewarded_requires_session check (
    (unlock_method in ('FREE', 'UPLOAD') and ad_session_id is null) or
    (unlock_method = 'REWARDED' and ad_session_id is not null)
  )
);

create unique index if not exists reveals_one_free_idx
  on public.daily_reveals(owner_hash, reveal_date)
  where unlock_method = 'FREE';
create unique index if not exists reveals_ad_session_idx
  on public.daily_reveals(ad_session_id)
  where ad_session_id is not null;
create unique index if not exists reveals_one_upload_idx
  on public.daily_reveals(owner_hash, reveal_date)
  where unlock_method = 'UPLOAD';
create index if not exists reveals_daily_idx on public.daily_reveals(owner_hash, reveal_date, unlock_method);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id),
  reporter_hash text not null,
  reason text not null check (reason in ('inappropriate', 'not_dog', 'privacy', 'copyright', 'other')),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique(pet_id, reporter_hash)
);

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  pet_id uuid references public.pets(id),
  actor text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.pets enable row level security;
alter table public.daily_reveals enable row level security;
alter table public.reports enable row level security;
alter table public.admin_audit_logs enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pet-photos', 'pet-photos', false, 7340032, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;

-- Edge Functions use the service role. No direct anonymous table/storage policies are created.
-- Reviewers approve through the Supabase dashboard by setting status='approved',
-- reviewed_at=now(), owner_pinned_pending=true and recording an admin_audit_logs row.
