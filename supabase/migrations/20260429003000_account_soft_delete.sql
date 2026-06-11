-- Soft-delete and account action audit (recovery window, rate limits, diagnostics).
-- Rely on Edge `requireUser` for API enforcement; optional RLS tightened in a follow-up migration if needed.

alter table trellis.profiles
add column if not exists deleted_at timestamptz;

comment on column trellis.profiles.deleted_at is
  'When set, the account is in a pending-deletion / recovery window. APIs reject normal use until recovery or finalization.';

create table if not exists trellis.account_action_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references trellis.profiles(id) on delete cascade,
  action text not null,
  ip inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_action_audit_user_created_idx
  on trellis.account_action_audit (user_id, created_at desc);

create index if not exists profiles_deleted_at_expiry_idx
  on trellis.profiles (deleted_at)
  where deleted_at is not null;

alter table trellis.account_action_audit enable row level security;

-- No user-facing policies — only service role / Edge Functions.
