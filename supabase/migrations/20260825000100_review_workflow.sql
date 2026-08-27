-- Review submissions atomically and record the operator audit trail.
create or replace function public.review_pet_submission(
  p_pet_id uuid,
  p_decision text,
  p_actor text,
  p_reason text default null
) returns public.pet_status
language plpgsql
security definer
set search_path = public
as $$
declare
  next_status public.pet_status;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_REVIEW_DECISION';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'REVIEW_ACTOR_REQUIRED';
  end if;
  if p_decision = 'rejected' and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;

  next_status := p_decision::public.pet_status;
  update public.pets
  set status = next_status,
      reviewed_at = now(),
      rejection_reason = case when next_status = 'rejected' then trim(p_reason) else null end,
      owner_pinned_pending = false
  where id = p_pet_id and status = 'pending';

  if not found then raise exception 'PET_NOT_PENDING'; end if;

  insert into public.admin_audit_logs(pet_id, actor, action, detail)
  values (
    p_pet_id,
    trim(p_actor),
    'review_' || p_decision,
    jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), ''))
  );

  return next_status;
end;
$$;

comment on function public.review_pet_submission(uuid,text,text,text)
  is '검수 상태와 감사 로그를 한 트랜잭션으로 기록한다. Edge/Admin service role 전용.';

revoke all on function public.review_pet_submission(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.review_pet_submission(uuid,text,text,text)
  to service_role;
