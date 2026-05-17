-- Strand revision history for cloud-backed notes + Realtime for cross-device freshness.

create table if not exists public.note_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  body text not null,
  actor text not null check (actor in ('user', 'trellis', 'import', 'system')),
  session_id uuid references public.chat_sessions(id) on delete set null,
  content_sha256 text not null,
  created_at timestamptz not null default now()
);

create index if not exists note_revisions_note_created_idx
  on public.note_revisions (note_id, created_at desc);

alter table public.note_revisions enable row level security;

drop policy if exists "Users manage workspace note revisions" on public.note_revisions;
create policy "Users manage workspace note revisions"
on public.note_revisions
for all
using (public.user_owns_workspace(workspace_id))
with check (public.user_owns_workspace(workspace_id));

-- Broadcast row changes to subscribed clients (notes + links refresh graph/index).
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.note_links;
