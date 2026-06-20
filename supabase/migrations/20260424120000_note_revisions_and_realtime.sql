-- Strand revision history for cloud-backed notes + Realtime for cross-device freshness.

create table if not exists trellis.note_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  note_id uuid not null references trellis.notes(id) on delete cascade,
  body text not null,
  actor text not null check (actor in ('user', 'trellis', 'import', 'system')),
  session_id uuid references trellis.chat_sessions(id) on delete set null,
  content_sha256 text not null,
  created_at timestamptz not null default now()
);

create index if not exists note_revisions_note_created_idx
  on trellis.note_revisions (note_id, created_at desc);

alter table trellis.note_revisions enable row level security;

drop policy if exists "Users manage workspace note revisions" on trellis.note_revisions;
create policy "Users manage workspace note revisions"
on trellis.note_revisions
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

-- Broadcast row changes to subscribed clients (notes + links refresh graph/index).
-- Idempotent: query-mode deploy re-runs all migration files without schema_migrations tracking.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'trellis'
      and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table trellis.notes;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'trellis'
      and tablename = 'note_links'
  ) then
    alter publication supabase_realtime add table trellis.note_links;
  end if;
end $$;
