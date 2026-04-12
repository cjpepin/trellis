-- Rolling 24-hour window for trial message quota (per-window cap, not lifetime).

alter table public.profiles
  add column if not exists trial_message_window_started_at timestamptz not null default now();

alter table public.profiles
  alter column message_limit set default 8;

update public.profiles
set message_limit = 8
where subscription_tier = 'trial';

create or replace function public.increment_profile_usage_counters(
  p_user_id uuid,
  p_field text,
  p_amount integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_field not in ('messages_used', 'ingests_used') then
    raise exception 'invalid usage field';
  end if;

  if p_amount < 1 or p_amount > 1000000 then
    raise exception 'invalid usage amount';
  end if;

  if p_field = 'messages_used' then
    update public.profiles
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
    update public.profiles
    set
      ingests_used = ingests_used + p_amount,
      updated_at = now()
    where id = p_user_id;
  end if;
end;
$$;
