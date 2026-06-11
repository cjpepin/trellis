-- Rolling 24-hour window for trial message quota (per-window cap, not lifetime).

alter table trellis.profiles
  add column if not exists trial_message_window_started_at timestamptz not null default now();

alter table trellis.profiles
  alter column message_limit set default 8;

update trellis.profiles
set message_limit = 8
where subscription_tier = 'trial';

create or replace function trellis.increment_profile_usage_counters(
  p_user_id uuid,
  p_field text,
  p_amount integer
)
returns void
language plpgsql
security definer
set search_path = trellis
as $$
begin
  if p_field not in ('messages_used', 'ingests_used') then
    raise exception 'invalid usage field';
  end if;

  if p_amount < 1 or p_amount > 1000000 then
    raise exception 'invalid usage amount';
  end if;

  if p_field = 'messages_used' then
    update trellis.profiles
    set
      messages_used = case
        when subscription_tier = 'trial'
          and now() >= trial_message_window_started_at + interval '24 hours'
        then p_amount
        else messages_used + p_amount
      end,
      trial_message_window_started_at = case
        when subscription_tier = 'trial'
          and now() >= trial_message_window_started_at + interval '24 hours'
        then now()
        else trial_message_window_started_at
      end,
      updated_at = now()
    where id = p_user_id;
  else
    update trellis.profiles
    set
      ingests_used = ingests_used + p_amount,
      updated_at = now()
    where id = p_user_id;
  end if;
end;
$$;
