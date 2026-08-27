-- Add server-side request rate limiting.
create table if not exists public.pet_api_rate_limits (
  owner_hash text not null,
  action text not null check (action in ('house', 'shared', 'mine', 'reveal', 'submit', 'report', 'delete')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (owner_hash, action)
);

alter table public.pet_api_rate_limits enable row level security;

create or replace function public.check_pet_api_rate_limit(
  p_owner_hash text,
  p_action text,
  p_window_seconds integer,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  insert into public.pet_api_rate_limits(owner_hash, action, window_started_at, request_count)
  values (p_owner_hash, p_action, now(), 1)
  on conflict (owner_hash, action) do update
  set window_started_at = case
        when pet_api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
        else pet_api_rate_limits.window_started_at
      end,
      request_count = case
        when pet_api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
        else pet_api_rate_limits.request_count + 1
      end
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

revoke all on table public.pet_api_rate_limits from public, anon, authenticated;
revoke all on function public.check_pet_api_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_pet_api_rate_limit(text, text, integer, integer) to service_role;

update storage.buckets
set file_size_limit = 4194304,
    allowed_mime_types = array['image/jpeg']
where id = 'pet-photos';
