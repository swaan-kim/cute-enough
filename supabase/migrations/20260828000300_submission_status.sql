-- Allow the read-only reconciliation action to use its own rate-limit bucket.
alter table public.pet_api_rate_limits
  drop constraint if exists pet_api_rate_limits_action_check;

alter table public.pet_api_rate_limits
  add constraint pet_api_rate_limits_action_check
  check (action in ('house', 'shared', 'mine', 'reveal', 'submit', 'submissionStatus', 'report'));
