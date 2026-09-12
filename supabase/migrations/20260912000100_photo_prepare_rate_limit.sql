-- Allow the read-only photo preparation endpoint to use its own 30/minute
-- counter. Preserve every existing action and all accumulated counters.
begin;

alter table public.pet_api_rate_limits drop constraint if exists pet_api_rate_limits_action_check;
alter table public.pet_api_rate_limits add constraint pet_api_rate_limits_action_check
  check(action in ('house','shared','mine','artwork','design','reveal','ownerPhoto','photoPrepare',
    'submit','submitPhoto','submissionStatus','report',
    'photoAdditionStatus','photoAdditionUpload','photoAdditionSubmit',
    'album','albumPhoto','setFavorite','rewardStart','rewardComplete','rewardCancel','rewardStatus',
    'rewardRebind','shareStart','shareReward','shareClose','notificationSettings','setNotificationSettings'));

commit;
