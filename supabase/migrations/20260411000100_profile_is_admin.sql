alter table public.profiles
add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'When true, allows preview-workspace premium model sandbox for trial accounts (set only via service role / SQL).';
