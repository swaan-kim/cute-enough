-- Correct the approved pet "우유" to the all-white character requested by the operator.
-- Keep the name, approval timestamp, ownership and photo records unchanged.
do $$
declare
  target_pet_id constant uuid := 'bfd77d46-e3e7-45d9-ab2c-09692c6a4734';
  previous_traits jsonb;
  corrected_traits jsonb;
begin
  select traits
    into previous_traits
  from public.pets
  where id = target_pet_id
    and name = '우유'
  for update;

  if not found then
    raise exception 'WOOYOO_NOT_FOUND';
  end if;

  -- The operator may have applied this narrow correction from the Dashboard
  -- before the migration reaches a later environment. Keep that deployment
  -- idempotent and avoid duplicate audit entries.
  if previous_traits ->> 'baseColor' = 'white'
     and previous_traits ->> 'secondaryColor' = 'white'
     and previous_traits ->> 'markingPattern' = 'none' then
    return;
  end if;

  corrected_traits := previous_traits || jsonb_build_object(
    'baseColor', 'white',
    'secondaryColor', 'white',
    'markingPattern', 'none'
  );

  update public.pets
  set traits = corrected_traits
  where id = target_pet_id;

  insert into public.admin_audit_logs(pet_id, actor, action, detail)
  values (
    target_pet_id,
    'operator-migration',
    'update_pet_traits',
    jsonb_build_object(
      'reason', '우유 캐릭터를 실사에 맞춰 순백색으로 보정',
      'before', jsonb_build_object(
        'baseColor', previous_traits ->> 'baseColor',
        'secondaryColor', previous_traits ->> 'secondaryColor',
        'markingPattern', previous_traits ->> 'markingPattern'
      ),
      'after', jsonb_build_object(
        'baseColor', corrected_traits ->> 'baseColor',
        'secondaryColor', corrected_traits ->> 'secondaryColor',
        'markingPattern', corrected_traits ->> 'markingPattern'
      )
    )
  );
end;
$$;
