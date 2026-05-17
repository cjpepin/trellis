create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  );
$$;

alter table public.profiles
  alter column message_limit set default 25;

update public.profiles
set message_limit = 25
where subscription_tier = 'trial'
  and message_limit <> 25;

create table if not exists public.feature_posts (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feature_posts_status_created_idx
  on public.feature_posts (status, created_at desc);

create index if not exists feature_posts_author_created_idx
  on public.feature_posts (author_user_id, created_at desc);

create table if not exists public.update_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  summary text not null,
  body_markdown text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug)
);

create index if not exists update_posts_status_published_idx
  on public.update_posts (status, published_at desc nulls last);

create or replace function public.set_feature_post_review_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'pending' then
    new.reviewed_at := null;
    new.reviewed_by_user_id := null;
    return new;
  end if;

  if old.status is distinct from new.status then
    new.reviewed_at := now();
    new.reviewed_by_user_id := auth.uid();
  end if;

  return new;
end;
$$;

create or replace function public.set_update_post_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  if new.status = 'draft' then
    new.published_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists feature_posts_set_updated_at on public.feature_posts;
create trigger feature_posts_set_updated_at
before update on public.feature_posts
for each row execute procedure public.set_updated_at();

drop trigger if exists feature_posts_set_review_metadata on public.feature_posts;
create trigger feature_posts_set_review_metadata
before update on public.feature_posts
for each row execute procedure public.set_feature_post_review_metadata();

drop trigger if exists update_posts_set_updated_at on public.update_posts;
create trigger update_posts_set_updated_at
before update on public.update_posts
for each row execute procedure public.set_updated_at();

drop trigger if exists update_posts_set_published_at on public.update_posts;
create trigger update_posts_set_published_at
before insert or update on public.update_posts
for each row execute procedure public.set_update_post_published_at();

alter table public.feature_posts enable row level security;
alter table public.update_posts enable row level security;

drop policy if exists "Public read approved feature posts" on public.feature_posts;
create policy "Public read approved feature posts"
on public.feature_posts
for select
using (
  status = 'approved'
  or author_user_id = auth.uid()
  or public.is_current_user_admin()
);

drop policy if exists "Admins manage feature posts" on public.feature_posts;
create policy "Admins manage feature posts"
on public.feature_posts
for update
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "Admins delete feature posts" on public.feature_posts;
create policy "Admins delete feature posts"
on public.feature_posts
for delete
using (public.is_current_user_admin());

drop policy if exists "Public read published update posts" on public.update_posts;
create policy "Public read published update posts"
on public.update_posts
for select
using (
  status = 'published'
  or public.is_current_user_admin()
);

drop policy if exists "Admins insert update posts" on public.update_posts;
create policy "Admins insert update posts"
on public.update_posts
for insert
with check (public.is_current_user_admin());

drop policy if exists "Admins update update posts" on public.update_posts;
create policy "Admins update update posts"
on public.update_posts
for update
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "Admins delete update posts" on public.update_posts;
create policy "Admins delete update posts"
on public.update_posts
for delete
using (public.is_current_user_admin());
