create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create or replace function trellis.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function trellis.safe_object_path_uuid(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  first_segment text;
begin
  first_segment := split_part(coalesce(object_name, ''), '/', 1);

  if first_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return first_segment::uuid;
  end if;

  return null;
end;
$$;

create table if not exists trellis.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references trellis.profiles(id) on delete cascade,
  name text not null,
  slug text not null,
  migration_status text not null default 'not_started' check (migration_status in ('not_started', 'running', 'completed', 'failed')),
  import_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspaces_owner_slug_key
  on trellis.workspaces (owner_user_id, slug);

create or replace function trellis.user_owns_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = trellis
as $$
  select exists (
    select 1
    from trellis.workspaces
    where id = target_workspace_id
      and owner_user_id = auth.uid()
  );
$$;

create table if not exists trellis.user_preferences (
  user_id uuid primary key references trellis.profiles(id) on delete cascade,
  theme text,
  active_workspace_id uuid references trellis.workspaces(id) on delete set null,
  chat_json jsonb not null default '{}'::jsonb,
  platform_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trellis.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  legacy_id text,
  slug text not null,
  title text not null,
  markdown_body text not null,
  frontmatter_json jsonb not null default '{}'::jsonb,
  excerpt text not null default '',
  note_type text not null check (note_type in ('concept', 'entity', 'source-summary', 'synthesis')),
  folder_path text not null default '',
  source_count integer not null default 0,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notes_workspace_slug_key
  on trellis.notes (workspace_id, slug);

create unique index if not exists notes_workspace_legacy_id_key
  on trellis.notes (workspace_id, legacy_id);

create table if not exists trellis.workspace_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  path text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_folders_workspace_path_key
  on trellis.workspace_folders (workspace_id, path);

create table if not exists trellis.note_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  source_note_id uuid not null references trellis.notes(id) on delete cascade,
  target_slug text not null,
  target_title text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists note_links_source_target_key
  on trellis.note_links (workspace_id, source_note_id, target_slug);

create index if not exists note_links_workspace_target_slug_idx
  on trellis.note_links (workspace_id, target_slug);

create table if not exists trellis.note_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  note_id uuid not null references trellis.notes(id) on delete cascade,
  chunk_index integer not null,
  heading_path text not null default '',
  content text not null,
  content_hash text not null,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists note_chunks_note_chunk_index_key
  on trellis.note_chunks (note_id, chunk_index);

create table if not exists trellis.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  legacy_id text,
  title text not null,
  model text not null,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists chat_sessions_workspace_legacy_id_key
  on trellis.chat_sessions (workspace_id, legacy_id);

create index if not exists chat_sessions_workspace_updated_idx
  on trellis.chat_sessions (workspace_id, updated_at desc);

create or replace function trellis.user_owns_chat_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = trellis
as $$
  select exists (
    select 1
    from trellis.chat_sessions
    where id = target_session_id
      and trellis.user_owns_workspace(workspace_id)
  );
$$;

create table if not exists trellis.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references trellis.chat_sessions(id) on delete cascade,
  legacy_id text,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tokens integer,
  attachments_json jsonb not null default '[]'::jsonb,
  media_artifacts_json jsonb not null default '[]'::jsonb,
  note_actions_json jsonb not null default '[]'::jsonb,
  reply_context_json jsonb,
  composer_pins_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists chat_messages_session_legacy_id_key
  on trellis.chat_messages (session_id, legacy_id);

create index if not exists chat_messages_session_created_idx
  on trellis.chat_messages (session_id, created_at asc);

create table if not exists trellis.memory_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  legacy_id text,
  kind text not null,
  content text not null,
  source_message_ids jsonb not null default '[]'::jsonb,
  linked_note_slug text,
  confidence double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists memory_items_workspace_legacy_id_key
  on trellis.memory_items (workspace_id, legacy_id);

create table if not exists trellis.thoughts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  legacy_id text,
  content text not null,
  source_type text not null,
  status text not null,
  backing_note_slug text,
  related_thought_ids jsonb not null default '[]'::jsonb,
  extracted_entities jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  enrichment_json jsonb,
  enrichment_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists thoughts_workspace_legacy_id_key
  on trellis.thoughts (workspace_id, legacy_id);

create table if not exists trellis.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  chat_session_id uuid references trellis.chat_sessions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  trigger text not null default 'manual' check (trigger in ('idle', 'session-switch', 'manual', 'startup')),
  provider text,
  model text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  applied_update_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trellis.extraction_job_events (
  id uuid primary key default gen_random_uuid(),
  extraction_job_id uuid not null references trellis.extraction_jobs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists trellis.source_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  legacy_id text,
  source_type text not null check (source_type in ('pdf', 'web', 'text')),
  title text not null,
  source_path text,
  storage_path text,
  mime_type text,
  byte_size bigint,
  sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists source_documents_workspace_legacy_id_key
  on trellis.source_documents (workspace_id, legacy_id);

create table if not exists trellis.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  legacy_id text,
  chat_session_id uuid references trellis.chat_sessions(id) on delete set null,
  note_id uuid references trellis.notes(id) on delete set null,
  source_document_id uuid references trellis.source_documents(id) on delete set null,
  bucket text not null check (bucket in ('note-assets', 'source-files', 'exports')),
  storage_path text not null,
  mime_type text,
  byte_size bigint,
  sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists attachments_workspace_legacy_id_key
  on trellis.attachments (workspace_id, legacy_id);

create table if not exists trellis.provider_credentials (
  user_id uuid not null references trellis.profiles(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic')),
  encrypted_secret text not null,
  secret_nonce text not null,
  key_version integer not null default 1,
  last_four text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists trellis.migration_import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references trellis.workspaces(id) on delete cascade,
  import_digest text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  summary_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists migration_import_runs_workspace_digest_key
  on trellis.migration_import_runs (workspace_id, import_digest);

drop trigger if exists workspaces_set_updated_at on trellis.workspaces;
create trigger workspaces_set_updated_at
before update on trellis.workspaces
for each row execute procedure trellis.set_updated_at();

drop trigger if exists user_preferences_set_updated_at on trellis.user_preferences;
create trigger user_preferences_set_updated_at
before update on trellis.user_preferences
for each row execute procedure trellis.set_updated_at();

drop trigger if exists notes_set_updated_at on trellis.notes;
create trigger notes_set_updated_at
before update on trellis.notes
for each row execute procedure trellis.set_updated_at();

drop trigger if exists note_chunks_set_updated_at on trellis.note_chunks;
create trigger note_chunks_set_updated_at
before update on trellis.note_chunks
for each row execute procedure trellis.set_updated_at();

drop trigger if exists chat_sessions_set_updated_at on trellis.chat_sessions;
create trigger chat_sessions_set_updated_at
before update on trellis.chat_sessions
for each row execute procedure trellis.set_updated_at();

drop trigger if exists memory_items_set_updated_at on trellis.memory_items;
create trigger memory_items_set_updated_at
before update on trellis.memory_items
for each row execute procedure trellis.set_updated_at();

drop trigger if exists thoughts_set_updated_at on trellis.thoughts;
create trigger thoughts_set_updated_at
before update on trellis.thoughts
for each row execute procedure trellis.set_updated_at();

drop trigger if exists extraction_jobs_set_updated_at on trellis.extraction_jobs;
create trigger extraction_jobs_set_updated_at
before update on trellis.extraction_jobs
for each row execute procedure trellis.set_updated_at();

drop trigger if exists source_documents_set_updated_at on trellis.source_documents;
create trigger source_documents_set_updated_at
before update on trellis.source_documents
for each row execute procedure trellis.set_updated_at();

drop trigger if exists attachments_set_updated_at on trellis.attachments;
create trigger attachments_set_updated_at
before update on trellis.attachments
for each row execute procedure trellis.set_updated_at();

drop trigger if exists provider_credentials_set_updated_at on trellis.provider_credentials;
create trigger provider_credentials_set_updated_at
before update on trellis.provider_credentials
for each row execute procedure trellis.set_updated_at();

drop trigger if exists workspace_folders_set_updated_at on trellis.workspace_folders;
create trigger workspace_folders_set_updated_at
before update on trellis.workspace_folders
for each row execute procedure trellis.set_updated_at();

drop trigger if exists migration_import_runs_set_updated_at on trellis.migration_import_runs;
create trigger migration_import_runs_set_updated_at
before update on trellis.migration_import_runs
for each row execute procedure trellis.set_updated_at();

alter table trellis.workspaces enable row level security;
alter table trellis.user_preferences enable row level security;
alter table trellis.notes enable row level security;
alter table trellis.workspace_folders enable row level security;
alter table trellis.note_links enable row level security;
alter table trellis.note_chunks enable row level security;
alter table trellis.chat_sessions enable row level security;
alter table trellis.chat_messages enable row level security;
alter table trellis.memory_items enable row level security;
alter table trellis.thoughts enable row level security;
alter table trellis.extraction_jobs enable row level security;
alter table trellis.extraction_job_events enable row level security;
alter table trellis.source_documents enable row level security;
alter table trellis.attachments enable row level security;
alter table trellis.provider_credentials enable row level security;
alter table trellis.migration_import_runs enable row level security;

drop policy if exists "Users manage own workspaces" on trellis.workspaces;
create policy "Users manage own workspaces"
on trellis.workspaces
for all
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

drop policy if exists "Users manage own preferences" on trellis.user_preferences;
create policy "Users manage own preferences"
on trellis.user_preferences
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage workspace notes" on trellis.notes;
create policy "Users manage workspace notes"
on trellis.notes
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage workspace folders" on trellis.workspace_folders;
create policy "Users manage workspace folders"
on trellis.workspace_folders
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage workspace note links" on trellis.note_links;
create policy "Users manage workspace note links"
on trellis.note_links
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage workspace note chunks" on trellis.note_chunks;
create policy "Users manage workspace note chunks"
on trellis.note_chunks
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage workspace chat sessions" on trellis.chat_sessions;
create policy "Users manage workspace chat sessions"
on trellis.chat_sessions
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage workspace chat messages" on trellis.chat_messages;
create policy "Users manage workspace chat messages"
on trellis.chat_messages
for all
using (trellis.user_owns_chat_session(session_id))
with check (trellis.user_owns_chat_session(session_id));

drop policy if exists "Users manage workspace memory items" on trellis.memory_items;
create policy "Users manage workspace memory items"
on trellis.memory_items
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage workspace thoughts" on trellis.thoughts;
create policy "Users manage workspace thoughts"
on trellis.thoughts
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage workspace extraction jobs" on trellis.extraction_jobs;
create policy "Users manage workspace extraction jobs"
on trellis.extraction_jobs
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage extraction job events" on trellis.extraction_job_events;
create policy "Users manage extraction job events"
on trellis.extraction_job_events
for all
using (
  exists (
    select 1
    from trellis.extraction_jobs
    where trellis.extraction_jobs.id = extraction_job_id
      and trellis.user_owns_workspace(trellis.extraction_jobs.workspace_id)
  )
)
with check (
  exists (
    select 1
    from trellis.extraction_jobs
    where trellis.extraction_jobs.id = extraction_job_id
      and trellis.user_owns_workspace(trellis.extraction_jobs.workspace_id)
  )
);

drop policy if exists "Users manage workspace source documents" on trellis.source_documents;
create policy "Users manage workspace source documents"
on trellis.source_documents
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage workspace attachments" on trellis.attachments;
create policy "Users manage workspace attachments"
on trellis.attachments
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

drop policy if exists "Users manage own provider credentials" on trellis.provider_credentials;
create policy "Users manage own provider credentials"
on trellis.provider_credentials
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own migration runs" on trellis.migration_import_runs;
create policy "Users manage own migration runs"
on trellis.migration_import_runs
for all
using (trellis.user_owns_workspace(workspace_id))
with check (trellis.user_owns_workspace(workspace_id));

insert into storage.buckets (id, name, public)
values
  ('note-assets', 'note-assets', false),
  ('source-files', 'source-files', false),
  ('exports', 'exports', false)
on conflict (id) do nothing;

drop policy if exists "Users manage workspace note assets" on storage.objects;
create policy "Users manage workspace note assets"
on storage.objects
for all
using (
  bucket_id = 'note-assets'
  and trellis.user_owns_workspace(trellis.safe_object_path_uuid(name))
)
with check (
  bucket_id = 'note-assets'
  and trellis.user_owns_workspace(trellis.safe_object_path_uuid(name))
);

drop policy if exists "Users manage workspace source files" on storage.objects;
create policy "Users manage workspace source files"
on storage.objects
for all
using (
  bucket_id = 'source-files'
  and trellis.user_owns_workspace(trellis.safe_object_path_uuid(name))
)
with check (
  bucket_id = 'source-files'
  and trellis.user_owns_workspace(trellis.safe_object_path_uuid(name))
);

drop policy if exists "Users manage own exports" on storage.objects;
create policy "Users manage own exports"
on storage.objects
for all
using (
  bucket_id = 'exports'
  and trellis.safe_object_path_uuid(name) = auth.uid()
)
with check (
  bucket_id = 'exports'
  and trellis.safe_object_path_uuid(name) = auth.uid()
);

create or replace function trellis.rename_workspace_folder(
  p_workspace_id uuid,
  p_from_path text,
  p_to_path text
)
returns void
language plpgsql
security invoker
set search_path = trellis
as $$
declare
  source_prefix text := p_from_path || '/';
  target_prefix text := p_to_path || '/';
begin
  if p_from_path is null or p_from_path = '' then
    raise exception 'A source folder path is required.';
  end if;

  if p_to_path is null or p_to_path = '' then
    raise exception 'A target folder path is required.';
  end if;

  if p_to_path = p_from_path then
    return;
  end if;

  if p_to_path like source_prefix || '%' then
    raise exception 'A folder cannot be moved inside itself.';
  end if;

  insert into trellis.workspace_folders (workspace_id, path, name)
  select
    workspace_id,
    case
      when path = p_from_path then p_to_path
      else target_prefix || substr(path, length(source_prefix) + 1)
    end,
    regexp_replace(
      case
        when path = p_from_path then p_to_path
        else target_prefix || substr(path, length(source_prefix) + 1)
      end,
      '^.*/',
      ''
    )
  from trellis.workspace_folders
  where workspace_id = p_workspace_id
    and (path = p_from_path or path like source_prefix || '%')
  on conflict (workspace_id, path) do update
    set name = excluded.name,
        updated_at = now();

  update trellis.notes
  set folder_path = case
    when folder_path = p_from_path then p_to_path
    else target_prefix || substr(folder_path, length(source_prefix) + 1)
  end
  where workspace_id = p_workspace_id
    and (folder_path = p_from_path or folder_path like source_prefix || '%');

  delete from trellis.workspace_folders
  where workspace_id = p_workspace_id
    and (path = p_from_path or path like source_prefix || '%');
end;
$$;

create or replace function trellis.delete_workspace_folder(
  p_workspace_id uuid,
  p_folder_path text
)
returns void
language plpgsql
security invoker
set search_path = trellis
as $$
declare
  folder_prefix text := p_folder_path || '/';
begin
  if p_folder_path is null or p_folder_path = '' then
    raise exception 'A folder path is required.';
  end if;

  delete from trellis.notes
  where workspace_id = p_workspace_id
    and (folder_path = p_folder_path or folder_path like folder_prefix || '%');

  delete from trellis.workspace_folders
  where workspace_id = p_workspace_id
    and (path = p_folder_path or path like folder_prefix || '%');
end;
$$;
