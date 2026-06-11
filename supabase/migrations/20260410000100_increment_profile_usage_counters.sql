-- Atomic usage counter updates for Edge Functions (avoids read-modify-write races).
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
      messages_used = messages_used + p_amount,
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

revoke all on function trellis.increment_profile_usage_counters(uuid, text, integer) from public;

grant execute on function trellis.increment_profile_usage_counters(uuid, text, integer) to service_role;
