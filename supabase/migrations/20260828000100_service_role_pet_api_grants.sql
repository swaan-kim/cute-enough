-- Grant the Edge Function only the direct table privileges it uses.
-- RLS remains enabled; the service_role bypass is still required for server-only access.
grant select on table
  public.pets,
  public.daily_reveals,
  public.upload_rewards
to service_role;

grant insert on table public.reports to service_role;
