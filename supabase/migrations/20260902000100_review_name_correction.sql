-- Let the reviewer repair a missing or malformed display name in the same
-- transaction that approves the final character design.
create or replace function public.review_pet_submission_v4(
  p_pet_id uuid,
  p_decision text,
  p_actor text,
  p_reason text default null,
  p_final_name text default null,
  p_final_traits jsonb default null,
  p_final_style jsonb default null,
  p_published_accessory jsonb default null,
  p_review_note text default null
) returns public.pet_status
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  previous_name text;
  normalized_name text;
  reviewed_status public.pet_status;
begin
  select name into previous_name
  from public.pets
  where id = p_pet_id and status = 'pending';

  if not found then
    raise exception 'PET_NOT_PENDING';
  end if;

  if p_decision = 'approved' then
    normalized_name := trim(coalesce(p_final_name, ''));
    if normalized_name !~ '^[가-힣A-Za-z0-9]{1,4}$' then
      raise exception 'INVALID_FINAL_PET_NAME';
    end if;
  end if;

  reviewed_status := public.review_pet_submission_v3(
    p_pet_id,
    p_decision,
    p_actor,
    p_reason,
    p_final_traits,
    p_final_style,
    p_published_accessory,
    p_review_note
  );

  if reviewed_status = 'approved' then
    update public.pets
    set name = normalized_name
    where id = p_pet_id;

    if previous_name is distinct from normalized_name then
      insert into public.admin_audit_logs(pet_id, actor, action, detail)
      values (
        p_pet_id,
        trim(p_actor),
        'review_name_corrected',
        jsonb_build_object('before', previous_name, 'after', normalized_name)
      );
    end if;
  end if;

  return reviewed_status;
end;
$$;

revoke all on function public.review_pet_submission_v4(uuid,text,text,text,text,jsonb,jsonb,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.review_pet_submission_v4(uuid,text,text,text,text,jsonb,jsonb,jsonb,text)
  to service_role;
