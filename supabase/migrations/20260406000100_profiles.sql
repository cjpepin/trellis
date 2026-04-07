create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  subscription_tier text not null default 'trial' check (subscription_tier in ('trial', 'pro')),
  subscription_status text not null default 'trialing' check (subscription_status in ('trialing', 'active', 'expired')),
  messages_used integer not null default 0,
  message_limit integer not null default 50,
  ingests_used integer not null default 0,
  ingest_limit integer not null default 5,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('message', 'ingest')),
  amount integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.usage_events enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "Users can read own usage" on public.usage_events;
create policy "Users can read own usage"
on public.usage_events
for select
using (auth.uid() = user_id);

