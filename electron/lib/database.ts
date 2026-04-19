import fs from "node:fs";
import path from "node:path";
import Sqlite from "better-sqlite3";
import type {
  ChatAttachment,
  ChatMediaArtifact,
  ChatModel,
  ChatNoteActionProposal,
  ChatReplyContext,
  ChatSessionSummary,
  ExtractionJobSnapshot,
  ExtractionJobStatus,
  ExtractionJobTrigger,
  ExtractionMode,
  ExtractionProviderId,
  MemoryItem,
  MemoryKind,
  MessageRecord,
  RecordWikiOpInput
} from "../ipc/types";
import { normalizeChatModel } from "../ipc/types";
import type {
  CreateThoughtInput,
  ThoughtEnrichment,
  ThoughtRecord,
  ThoughtSourceType,
  ThoughtStatus
} from "@shared/thoughts/types";

let database: Sqlite.Database | null = null;
let currentDatabasePath: string | null = null;

interface SessionRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  model: string;
  message_count: string;
  vault_id: string | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  tokens: string | null;
  attachments: string | null;
  media_artifacts: string | null;
  note_actions: string | null;
  reply_context: string | null;
  composer_pins: string | null;
}

interface NoteEmbeddingRow {
  vault_id: string;
  note_slug: string;
  chunk_id: string;
  note_title: string;
  note_type: string;
  tags: string;
  heading_path: string;
  content: string;
  content_hash: string;
  embedding: string | null;
  updated_at: string;
}

interface ExtractionJobRow {
  id: string;
  session_id: string;
  vault_id: string;
  status: ExtractionJobStatus;
  trigger: ExtractionJobTrigger;
  /** Legacy rows may store auto/cloud; snapshots always report `"local"`. */
  mode: string;
  /** Legacy rows may reference cloud; snapshots only surface `"embedded"` or null. */
  provider: string | null;
  model: string | null;
  transcript_start_index: string;
  transcript_end_index: string;
  transcript_digest: string;
  attempt_count: string;
  applied_update_count: string;
  session_title: string | null;
  error_message: string | null;
  cloud_functions_base_url: string | null;
  cloud_publishable_key: string | null;
  preferred_local_model_id: string | null;
  priority: string | null;
  max_attempts: string | null;
  next_run_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface MemoryItemRow {
  id: string;
  vault_id: string;
  kind: MemoryKind;
  content: string;
  source_message_ids: string;
  linked_note_slug: string | null;
  confidence: string;
  created_at: string;
  updated_at: string;
}

interface ThoughtRow {
  id: string;
  vault_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  source_type: ThoughtSourceType;
  status: ThoughtStatus;
  backing_note_slug: string | null;
  related_thought_ids: string;
  extracted_entities: string;
  tags: string;
  enrichment_json: string | null;
  enrichment_error: string | null;
}

interface ExtractionJobConfigRow {
  cloud_functions_base_url: string | null;
  cloud_publishable_key: string | null;
  preferred_local_model_id: string | null;
}

export interface StoredNoteEmbedding {
  vaultId: string;
  noteSlug: string;
  chunkId: string;
  noteTitle: string;
  noteType: string;
  tags: string[];
  headingPath: string;
  content: string;
  contentHash: string;
  embedding: number[] | null;
  updatedAt: number;
}

export interface SaveMemoryItemInput {
  id?: string;
  vaultId: string;
  kind: MemoryKind;
  content: string;
  sourceMessageIds: string[];
  linkedNoteSlug?: string | null;
  confidence: number;
}

export interface RecentSessionNoteLinkSummary {
  sessionId: string;
  title: string;
  updatedAt: number;
  noteFiles: string[];
}

interface ReplaceNoteEmbeddingInput {
  chunkId: string;
  noteTitle: string;
  noteType: string;
  tags: string[];
  headingPath: string;
  content: string;
  contentHash: string;
  embedding: number[] | null;
}

export interface CreateExtractionJobInput {
  sessionId: string;
  vaultId: string;
  trigger: ExtractionJobTrigger;
  mode: ExtractionMode;
  transcriptStartIndex: number;
  transcriptEndIndex: number;
  transcriptDigest: string;
  cloudFunctionsBaseUrl?: string | null;
  cloudPublishableKey?: string | null;
  preferredLocalModelId?: string | null;
  /** Higher priority runs first. User-initiated ("manual") triggers should pass a positive value. */
  priority?: number;
  /** Defaults to extractionDefaultMaxAttempts. After this many failed attempts the job is marked failed. */
  maxAttempts?: number;
}

export interface SeedSessionInput {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: ChatModel;
  vaultId: string;
}

export interface SeedDatabaseFixture {
  sessions: SeedSessionInput[];
  messages: MessageRecord[];
}

export interface UpdateExtractionJobInput {
  id: string;
  status?: ExtractionJobStatus;
  provider?: ExtractionProviderId | null;
  model?: string | null;
  transcriptStartIndex?: number;
  transcriptEndIndex?: number;
  transcriptDigest?: string;
  attemptCount?: number;
  appliedUpdateCount?: number;
  sessionTitle?: string | null;
  errorMessage?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  priority?: number;
  maxAttempts?: number;
  nextRunAt?: number | null;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function allRows<T extends object>(db: Sqlite.Database, sql: string, params: unknown[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

function firstRow<T extends object>(db: Sqlite.Database, sql: string, params: unknown[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function runExec(db: Sqlite.Database, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...params);
}

function mapSession(row: SessionRow): ChatSessionSummary {
  return {
    id: row.id,
    title: row.title ?? "Untitled Session",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    model: normalizeChatModel(row.model),
    messageCount: Number(row.message_count),
    vaultId: row.vault_id ?? ""
  };
}

function parseAttachments(raw: string | null | undefined): ChatAttachment[] | undefined {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }

    return parsed as ChatAttachment[];
  } catch {
    return undefined;
  }
}

function parseMediaArtifacts(raw: string | null | undefined): ChatMediaArtifact[] | undefined {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }

    return parsed as ChatMediaArtifact[];
  } catch {
    return undefined;
  }
}

function parseNoteActions(raw: string | null | undefined): ChatNoteActionProposal[] | undefined {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }

    return parsed as ChatNoteActionProposal[];
  } catch {
    return undefined;
  }
}

function parseComposerPins(
  raw: string | null | undefined
): Array<{ slug: string; title: string }> | undefined {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }

    const out: Array<{ slug: string; title: string }> = [];

    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const rec = entry as Record<string, unknown>;
      const slug = rec.slug;
      const title = rec.title;

      if (typeof slug === "string" && slug.length > 0 && typeof title === "string" && title.length > 0) {
        out.push({ slug, title });
      }
    }

    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function parseReplyContext(raw: string | null | undefined): ChatReplyContext | undefined {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    const rec = parsed as Record<string, unknown>;
    const labels = rec.sourceLabels;
    const items = rec.items;

    if (!Array.isArray(labels) || !Array.isArray(items)) {
      return undefined;
    }

    const sourceLabels = labels.filter((value): value is string => typeof value === "string");
    const parsedItems: ChatReplyContext["items"] = [];

    for (const entry of items) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const item = entry as Record<string, unknown>;
      const kind = item.kind;
      const title = item.title;

      if (kind !== "note" && kind !== "memory") {
        continue;
      }

      if (typeof title !== "string" || title.length === 0) {
        continue;
      }

      parsedItems.push({
        kind,
        title,
        ...(typeof item.slug === "string" && item.slug.length > 0 ? { slug: item.slug } : {}),
        ...(item.pinned === true ? { pinned: true } : {})
      });
    }

    return { sourceLabels, items: parsedItems };
  } catch {
    return undefined;
  }
}

function mapMessage(row: MessageRow): MessageRecord {
  const attachments = parseAttachments(row.attachments);
  const mediaArtifacts = parseMediaArtifacts(row.media_artifacts);
  const noteActions = parseNoteActions(row.note_actions);
  const replyContext = parseReplyContext(row.reply_context);
  const composerPins = parseComposerPins(row.composer_pins);

  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as MessageRecord["role"],
    content: row.content,
    createdAt: Number(row.created_at),
    tokens: row.tokens !== null ? Number(row.tokens) : null,
    ...(attachments ? { attachments } : {}),
    ...(mediaArtifacts ? { mediaArtifacts } : {}),
    ...(noteActions ? { noteActions } : {}),
    ...(replyContext ? { replyContext } : {}),
    ...(composerPins ? { composerPins } : {})
  };
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return null;
    }

    const embedding = parsed.filter((value): value is number => typeof value === "number");
    return embedding.length > 0 ? embedding : null;
  } catch {
    return null;
  }
}

function mapNoteEmbedding(row: NoteEmbeddingRow): StoredNoteEmbedding {
  let tags: string[] = [];

  try {
    const parsed = JSON.parse(row.tags) as unknown;

    if (Array.isArray(parsed)) {
      tags = parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    tags = [];
  }

  return {
    vaultId: row.vault_id,
    noteSlug: row.note_slug,
    chunkId: row.chunk_id,
    noteTitle: row.note_title,
    noteType: row.note_type,
    tags,
    headingPath: row.heading_path,
    content: row.content,
    contentHash: row.content_hash,
    embedding: parseEmbedding(row.embedding),
    updatedAt: Number(row.updated_at)
  };
}

function mapExtractionJob(row: ExtractionJobRow): ExtractionJobSnapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    vaultId: row.vault_id,
    status: row.status,
    trigger: row.trigger,
    mode: "local",
    provider: row.provider === "embedded" ? "embedded" : null,
    model: row.model,
    transcriptStartIndex: Number(row.transcript_start_index),
    transcriptEndIndex: Number(row.transcript_end_index),
    transcriptDigest: row.transcript_digest,
    attemptCount: Number(row.attempt_count),
    appliedUpdateCount: Number(row.applied_update_count),
    sessionTitle: row.session_title,
    errorMessage: row.error_message,
    priority: row.priority !== null && row.priority !== undefined ? Number(row.priority) : 0,
    maxAttempts:
      row.max_attempts !== null && row.max_attempts !== undefined
        ? Number(row.max_attempts)
        : 3,
    nextRunAt: row.next_run_at !== null && row.next_run_at !== undefined ? Number(row.next_run_at) : null,
    createdAt: Number(row.created_at),
    startedAt: row.started_at !== null ? Number(row.started_at) : null,
    finishedAt: row.finished_at !== null ? Number(row.finished_at) : null
  };
}

function mapMemoryItem(row: MemoryItemRow): MemoryItem {
  let sourceMessageIds: string[] = [];

  try {
    const parsed = JSON.parse(row.source_message_ids) as unknown;

    if (Array.isArray(parsed)) {
      sourceMessageIds = parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    sourceMessageIds = [];
  }

  return {
    id: row.id,
    vaultId: row.vault_id,
    kind: row.kind,
    content: row.content,
    sourceMessageIds,
    linkedNoteSlug: row.linked_note_slug,
    confidence: Number(row.confidence),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function ensureSchema(db: Sqlite.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      model TEXT NOT NULL,
      vault_id TEXT NOT NULL DEFAULT '',
      message_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id),
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      tokens INTEGER,
      note_actions TEXT
    );

    CREATE INDEX IF NOT EXISTS messages_session_idx
      ON messages (session_id);

    CREATE INDEX IF NOT EXISTS chat_sessions_updated_idx
      ON chat_sessions (updated_at DESC);

    CREATE TABLE IF NOT EXISTS wiki_ops (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES chat_sessions(id),
      file TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingested_sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('pdf', 'web', 'text')),
      title TEXT,
      source_path TEXT,
      wiki_file TEXT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS note_embeddings (
      vault_id TEXT NOT NULL,
      note_slug TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      note_title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      tags TEXT NOT NULL,
      heading_path TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding TEXT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (vault_id, note_slug, chunk_id)
    );

    CREATE INDEX IF NOT EXISTS note_embeddings_vault_idx
      ON note_embeddings (vault_id);

    CREATE INDEX IF NOT EXISTS note_embeddings_note_idx
      ON note_embeddings (vault_id, note_slug);

    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('preference', 'project', 'open_loop', 'fact', 'task')),
      content TEXT NOT NULL,
      source_message_ids TEXT NOT NULL,
      linked_note_slug TEXT,
      confidence REAL NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memory_items_vault_idx
      ON memory_items (vault_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS memory_items_linked_note_idx
      ON memory_items (vault_id, linked_note_slug);

    CREATE TABLE IF NOT EXISTS thoughts (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('manual', 'imported', 'converted_from_note', 'system')),
      status TEXT NOT NULL CHECK(status IN ('raw', 'processing', 'enriched', 'failed')),
      backing_note_slug TEXT,
      related_thought_ids TEXT NOT NULL DEFAULT '[]',
      extracted_entities TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      enrichment_json TEXT,
      enrichment_error TEXT
    );

    CREATE INDEX IF NOT EXISTS thoughts_vault_updated_idx
      ON thoughts (vault_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS extraction_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id),
      vault_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
      trigger TEXT NOT NULL CHECK(trigger IN ('idle', 'session-switch', 'manual', 'startup')),
      mode TEXT NOT NULL CHECK(mode IN ('auto', 'cloud', 'local')),
      provider TEXT CHECK(provider IN ('cloud', 'ollama', 'embedded')),
      model TEXT,
      transcript_start_index INTEGER NOT NULL,
      transcript_end_index INTEGER NOT NULL,
      transcript_digest TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      applied_update_count INTEGER NOT NULL DEFAULT 0,
      session_title TEXT,
      error_message TEXT,
      cloud_functions_base_url TEXT,
      cloud_publishable_key TEXT,
      preferred_local_model_id TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_run_at BIGINT,
      created_at BIGINT NOT NULL,
      started_at BIGINT,
      finished_at BIGINT
    );

    CREATE INDEX IF NOT EXISTS extraction_jobs_session_status_idx
      ON extraction_jobs (session_id, status, created_at);

    CREATE INDEX IF NOT EXISTS extraction_jobs_status_idx
      ON extraction_jobs (status, created_at);

    CREATE INDEX IF NOT EXISTS extraction_jobs_pending_order_idx
      ON extraction_jobs (session_id, status, priority DESC, next_run_at, created_at);
  `);
}

function migrateMessagesAttachmentsColumn(db: Sqlite.Database): void {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN attachments TEXT`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      !message.includes("duplicate column") &&
      !message.includes("already exists") &&
      !message.includes("Duplicate column")
    ) {
      throw error;
    }
  }
}

function migrateMessagesMediaArtifactsColumn(db: Sqlite.Database): void {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN media_artifacts TEXT`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      !message.includes("duplicate column") &&
      !message.includes("already exists") &&
      !message.includes("Duplicate column")
    ) {
      throw error;
    }
  }
}

function migrateMessagesNoteActionsColumn(db: Sqlite.Database): void {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN note_actions TEXT`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      !message.includes("duplicate column") &&
      !message.includes("already exists") &&
      !message.includes("Duplicate column")
    ) {
      throw error;
    }
  }
}

function migrateMessagesDropTemplateInstanceColumn(db: Sqlite.Database): void {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM pragma_table_info('messages') WHERE name = 'template_instance' LIMIT 1`
    )
    .get() as { ok: number } | undefined;

  if (!row) {
    return;
  }

  try {
    db.exec(`ALTER TABLE messages DROP COLUMN template_instance`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes("no such column") && !message.includes("duplicate column")) {
      throw error;
    }
  }
}

function migrateMessagesReplyContextColumn(db: Sqlite.Database): void {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN reply_context TEXT`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      !message.includes("duplicate column") &&
      !message.includes("already exists") &&
      !message.includes("Duplicate column")
    ) {
      throw error;
    }
  }
}

function migrateMessagesComposerPinsColumn(db: Sqlite.Database): void {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN composer_pins TEXT`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      !message.includes("duplicate column") &&
      !message.includes("already exists") &&
      !message.includes("Duplicate column")
    ) {
      throw error;
    }
  }
}

/** PGlite-era migration; SQLite ships the full CHECK in ensureSchema. No-op. */
function migrateExtractionJobProviderConstraint(_db: Sqlite.Database): void {}

function addColumnIfMissing(db: Sqlite.Database, sql: string): void {
  try {
    db.exec(sql);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      !message.includes("duplicate column") &&
      !message.includes("already exists") &&
      !message.includes("Duplicate column")
    ) {
      throw error;
    }
  }
}

function migrateExtractionJobsAddSchedulingColumns(db: Sqlite.Database): void {
  addColumnIfMissing(
    db,
    `ALTER TABLE extraction_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`
  );
  addColumnIfMissing(
    db,
    `ALTER TABLE extraction_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3`
  );
  addColumnIfMissing(db, `ALTER TABLE extraction_jobs ADD COLUMN next_run_at BIGINT`);
  try {
    db.exec(
      `CREATE INDEX IF NOT EXISTS extraction_jobs_pending_order_idx
         ON extraction_jobs (session_id, status, priority DESC, next_run_at, created_at)`
    );
  } catch {
    // index creation is best-effort for migration
  }
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export async function initializeDatabase(databaseFilePath: string): Promise<Sqlite.Database> {
  if (database && currentDatabasePath === databaseFilePath && database.open) {
    ensureSchema(database);
    migrateMessagesAttachmentsColumn(database);
    migrateMessagesMediaArtifactsColumn(database);
    migrateMessagesNoteActionsColumn(database);
    migrateMessagesDropTemplateInstanceColumn(database);
    migrateMessagesReplyContextColumn(database);
    migrateMessagesComposerPinsColumn(database);
    migrateExtractionJobProviderConstraint(database);
    migrateExtractionJobsAddSchedulingColumns(database);
    return database;
  }

  if (database && database.open) {
    database.close();
  }

  ensureParentDir(databaseFilePath);
  database = new Sqlite(databaseFilePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  currentDatabasePath = databaseFilePath;

  ensureSchema(database);
  migrateMessagesAttachmentsColumn(database);
  migrateMessagesMediaArtifactsColumn(database);
  migrateMessagesNoteActionsColumn(database);
  migrateMessagesDropTemplateInstanceColumn(database);
  migrateMessagesReplyContextColumn(database);
  migrateMessagesComposerPinsColumn(database);
  migrateExtractionJobProviderConstraint(database);

  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database || !database.open) {
    database = null;
    currentDatabasePath = null;
    return;
  }

  database.close();
  database = null;
  currentDatabasePath = null;
}

export function getDatabase(): Sqlite.Database {
  if (!database || !database.open) {
    throw new Error("Database has not been initialized yet.");
  }

  return database;
}

export async function listSessions(): Promise<ChatSessionSummary[]> {
  const db = getDatabase();
  const rows = allRows<SessionRow>(
    db,
    `SELECT id, title, created_at, updated_at, model, message_count, vault_id
     FROM chat_sessions
     ORDER BY updated_at DESC`
  );

  return rows.map(mapSession);
}

export async function listRecentSessionNoteLinks(
  limit: number,
  excludeSessionId?: string | null
): Promise<RecentSessionNoteLinkSummary[]> {
  const db = getDatabase();
  const sessionRows = excludeSessionId
    ? allRows<SessionRow>(
        db,
        `SELECT id, title, created_at, updated_at, model, message_count, vault_id
         FROM chat_sessions
         WHERE id <> ?
         ORDER BY updated_at DESC
         LIMIT ?`,
        [excludeSessionId, limit]
      )
    : allRows<SessionRow>(
        db,
        `SELECT id, title, created_at, updated_at, model, message_count, vault_id
         FROM chat_sessions
         ORDER BY updated_at DESC
         LIMIT ?`,
        [limit]
      );
  const summaries = sessionRows.map(mapSession);

  if (summaries.length === 0) {
    return [];
  }

  const sessionIds = summaries.map((session) => session.id);
  const inList = placeholders(sessionIds.length);
  const ops = allRows<{ session_id: string; file: string }>(
    db,
    `SELECT session_id, file
     FROM wiki_ops
     WHERE session_id IN (${inList})
     ORDER BY created_at DESC`,
    sessionIds
  );
  const filesBySession = new Map<string, string[]>();

  for (const row of ops) {
    const files = filesBySession.get(row.session_id) ?? [];

    if (!files.includes(row.file)) {
      files.push(row.file);
    }

    filesBySession.set(row.session_id, files);
  }

  return summaries.map((session) => ({
    sessionId: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    noteFiles: filesBySession.get(session.id) ?? []
  }));
}

export async function getSessionById(sessionId: string): Promise<ChatSessionSummary | null> {
  const db = getDatabase();
  const row = firstRow<SessionRow>(
    db,
    `SELECT id, title, created_at, updated_at, model, message_count, vault_id
     FROM chat_sessions
     WHERE id = ?`,
    [sessionId]
  );

  return row ? mapSession(row) : null;
}

export async function createSession(model: ChatModel, vaultId: string): Promise<ChatSessionSummary> {
  const db = getDatabase();
  const now = Date.now();
  const id = crypto.randomUUID();

  runExec(
    db,
    `INSERT INTO chat_sessions (id, title, created_at, updated_at, model, vault_id, message_count)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [id, "Untitled Session", now, now, model, vaultId]
  );

  return {
    id,
    title: "Untitled Session",
    createdAt: now,
    updatedAt: now,
    model,
    messageCount: 0,
    vaultId
  };
}

export async function getMessagesBySession(sessionId: string): Promise<MessageRecord[]> {
  const db = getDatabase();
  const rows = allRows<MessageRow>(
    db,
    `SELECT id, session_id, role, content, created_at, tokens, attachments, media_artifacts, note_actions, reply_context, composer_pins
     FROM messages
     WHERE session_id = ?
     ORDER BY created_at ASC`,
    [sessionId]
  );

  return rows.map(mapMessage);
}

export async function appendMessages(messages: MessageRecord[]): Promise<void> {
  const db = getDatabase();

  const run = db.transaction(() => {
    const touchedSessions = new Set<string>();

    for (const message of messages) {
      const attachmentsJson =
        message.attachments && message.attachments.length > 0
          ? JSON.stringify(message.attachments)
          : null;
      const mediaJson =
        message.mediaArtifacts && message.mediaArtifacts.length > 0
          ? JSON.stringify(message.mediaArtifacts)
          : null;
      const noteActionsJson =
        message.noteActions && message.noteActions.length > 0
          ? JSON.stringify(message.noteActions)
          : null;
      const replyContextJson = message.replyContext ? JSON.stringify(message.replyContext) : null;
      const composerPinsJson =
        message.composerPins && message.composerPins.length > 0
          ? JSON.stringify(message.composerPins)
          : null;

      runExec(
        db,
        `INSERT INTO messages (id, session_id, role, content, created_at, tokens, attachments, media_artifacts, note_actions, reply_context, composer_pins)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           content = excluded.content,
           tokens = excluded.tokens,
           attachments = excluded.attachments,
           media_artifacts = excluded.media_artifacts,
           note_actions = excluded.note_actions,
           reply_context = excluded.reply_context,
           composer_pins = excluded.composer_pins`,
        [
          message.id,
          message.sessionId,
          message.role,
          message.content,
          message.createdAt,
          message.tokens,
          attachmentsJson,
          mediaJson,
          noteActionsJson,
          replyContextJson,
          composerPinsJson
        ]
      );
      touchedSessions.add(message.sessionId);
    }

    if (touchedSessions.size > 0) {
      const now = Date.now();
      const sessionIds = Array.from(touchedSessions);
      const ph = placeholders(sessionIds.length);
      runExec(
        db,
        `UPDATE chat_sessions AS cs
         SET updated_at = ?,
             message_count = m.cnt
         FROM (
           SELECT session_id, COUNT(*) AS cnt
           FROM messages
           WHERE session_id IN (${ph})
           GROUP BY session_id
         ) AS m
         WHERE cs.id = m.session_id`,
        [now, ...sessionIds]
      );
    }
  });

  run();
}

export async function replaceMessages(sessionId: string, messages: MessageRecord[]): Promise<void> {
  const db = getDatabase();

  const txn = db.transaction(() => {
    runExec(db, `DELETE FROM messages WHERE session_id = ?`, [sessionId]);

    for (const message of messages) {
      const attachmentsJson =
        message.attachments && message.attachments.length > 0
          ? JSON.stringify(message.attachments)
          : null;
      const mediaJson =
        message.mediaArtifacts && message.mediaArtifacts.length > 0
          ? JSON.stringify(message.mediaArtifacts)
          : null;
      const noteActionsJson =
        message.noteActions && message.noteActions.length > 0
          ? JSON.stringify(message.noteActions)
          : null;
      const replyContextJson = message.replyContext ? JSON.stringify(message.replyContext) : null;
      const composerPinsJson =
        message.composerPins && message.composerPins.length > 0
          ? JSON.stringify(message.composerPins)
          : null;

      runExec(
        db,
        `INSERT INTO messages (id, session_id, role, content, created_at, tokens, attachments, media_artifacts, note_actions, reply_context, composer_pins)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          message.sessionId,
          message.role,
          message.content,
          message.createdAt,
          message.tokens,
          attachmentsJson,
          mediaJson,
          noteActionsJson,
          replyContextJson,
          composerPinsJson
        ]
      );
    }

    runExec(db, `UPDATE chat_sessions SET updated_at = ?, message_count = ? WHERE id = ?`, [
      Date.now(),
      messages.length,
      sessionId
    ]);
  });

  txn();
}

export async function updateSession(
  payload: Partial<ChatSessionSummary> & { id: string }
): Promise<ChatSessionSummary> {
  const db = getDatabase();

  const row = firstRow<SessionRow>(
    db,
    `SELECT id, title, created_at, updated_at, model, message_count, vault_id
     FROM chat_sessions
     WHERE id = ?`,
    [payload.id]
  );

  if (!row) {
    throw new Error(`Unknown session: ${payload.id}`);
  }

  const updatedTitle = payload.title ?? row.title ?? "Untitled Session";
  const updatedAt = payload.updatedAt ?? Date.now();
  const updatedModel = payload.model ?? row.model;
  const updatedVaultId = payload.vaultId ?? row.vault_id ?? "";

  runExec(db, `UPDATE chat_sessions SET title = ?, updated_at = ?, model = ?, vault_id = ? WHERE id = ?`, [
    updatedTitle,
    updatedAt,
    updatedModel,
    updatedVaultId,
    payload.id
  ]);

  return {
    id: row.id,
    title: updatedTitle,
    createdAt: Number(row.created_at),
    updatedAt: updatedAt,
    model: normalizeChatModel(updatedModel),
    messageCount: Number(row.message_count),
    vaultId: updatedVaultId
  };
}

export async function recordWikiOps(ops: RecordWikiOpInput[]): Promise<void> {
  const db = getDatabase();

  const txn = db.transaction(() => {
    const now = Date.now();

    for (const item of ops) {
      runExec(
        db,
        `INSERT INTO wiki_ops (id, session_id, file, action, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), item.sessionId ?? null, item.file, item.action, now]
      );
    }
  });

  txn();
}

interface WikiTouchSessionSummaryRow {
  sessionId: string;
  sessionTitle: string | null;
  lastTouchAt: number;
  touchCount: number;
}

/** Chat sessions that have applied wiki_ops to the vault, for the Strands “From chats” list. */
export async function listWikiTouchSessionsForVault(
  vaultId: string
): Promise<WikiTouchSessionSummaryRow[]> {
  const db = getDatabase();
  const rows = allRows<{
    session_id: string;
    session_title: string | null;
    last_touch_at: number;
    touch_count: number;
  }>(
    db,
    `SELECT wo.session_id AS session_id,
            cs.title AS session_title,
            MAX(wo.created_at) AS last_touch_at,
            COUNT(*) AS touch_count
     FROM wiki_ops wo
     INNER JOIN chat_sessions cs ON cs.id = wo.session_id
     WHERE cs.vault_id = ? AND wo.session_id IS NOT NULL
     GROUP BY wo.session_id
     ORDER BY last_touch_at DESC
     LIMIT 80`,
    [vaultId]
  );

  return rows.map((row) => ({
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    lastTouchAt: row.last_touch_at,
    touchCount: row.touch_count
  }));
}

export interface StrandProvenanceRow {
  sessionId: string;
  sessionTitle: string | null;
  lastTouchedAt: number;
}

/** Latest extraction/write lineage for a vault markdown file (e.g. `slug.md`). */
export async function getStrandProvenanceForFile(
  vaultId: string,
  fileName: string
): Promise<StrandProvenanceRow | null> {
  const db = getDatabase();
  const row = firstRow<{
    session_id: string;
    session_title: string | null;
    last_touched_at: number;
  }>(
    db,
    `SELECT wo.session_id AS session_id,
            cs.title AS session_title,
            wo.created_at AS last_touched_at
     FROM wiki_ops wo
     INNER JOIN chat_sessions cs ON cs.id = wo.session_id
     WHERE cs.vault_id = ? AND wo.file = ?
     ORDER BY wo.created_at DESC
     LIMIT 1`,
    [vaultId, fileName]
  );

  if (!row) {
    return null;
  }

  return {
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    lastTouchedAt: row.last_touched_at
  };
}

export async function listMemoryItems(vaultId: string): Promise<MemoryItem[]> {
  const db = getDatabase();
  const rows = allRows<MemoryItemRow>(
    db,
    `SELECT id, vault_id, kind, content, source_message_ids, linked_note_slug, confidence,
            created_at, updated_at
     FROM memory_items
     WHERE vault_id = ?
     ORDER BY updated_at DESC, created_at DESC`,
    [vaultId]
  );

  return rows.map(mapMemoryItem);
}

function parseThoughtStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function mapThoughtRow(row: ThoughtRow): ThoughtRecord {
  let enrichment: ThoughtEnrichment | null = null;

  if (row.enrichment_json) {
    try {
      enrichment = JSON.parse(row.enrichment_json) as ThoughtEnrichment;
    } catch {
      enrichment = null;
    }
  }

  return {
    id: row.id,
    vaultId: row.vault_id,
    content: row.content,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    sourceType: row.source_type,
    status: row.status,
    backingNoteSlug: row.backing_note_slug,
    relatedThoughtIds: parseThoughtStringArray(row.related_thought_ids),
    extractedEntities: parseThoughtStringArray(row.extracted_entities),
    tags: parseThoughtStringArray(row.tags),
    enrichment,
    enrichmentError: row.enrichment_error
  };
}

export async function createThought(input: CreateThoughtInput): Promise<ThoughtRecord> {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = Date.now();
  const sourceType: ThoughtSourceType = input.sourceType ?? "manual";
  const content = input.content.trim();

  if (content.length === 0) {
    throw new Error("Thought content cannot be empty.");
  }

  const row = firstRow<ThoughtRow>(
    db,
    `INSERT INTO thoughts (
       id,
       vault_id,
       content,
       created_at,
       updated_at,
       source_type,
       status,
       backing_note_slug,
       related_thought_ids,
       extracted_entities,
       tags,
       enrichment_json,
       enrichment_error
     )
     VALUES (?, ?, ?, ?, ?, ?, 'raw', ?, '[]', '[]', '[]', NULL, NULL)
     RETURNING id, vault_id, content, created_at, updated_at, source_type, status, backing_note_slug,
               related_thought_ids, extracted_entities, tags, enrichment_json, enrichment_error`,
    [id, input.vaultId, content, now, now, sourceType, input.backingNoteSlug ?? null]
  );

  if (!row) {
    throw new Error("Could not create thought.");
  }

  return mapThoughtRow(row);
}

export async function getThoughtById(thoughtId: string): Promise<ThoughtRecord | null> {
  const db = getDatabase();
  const row = firstRow<ThoughtRow>(
    db,
    `SELECT id, vault_id, content, created_at, updated_at, source_type, status, backing_note_slug,
            related_thought_ids, extracted_entities, tags, enrichment_json, enrichment_error
     FROM thoughts
     WHERE id = ?`,
    [thoughtId]
  );

  return row ? mapThoughtRow(row) : null;
}

export async function listThoughtsForVault(vaultId: string, limit = 300): Promise<ThoughtRecord[]> {
  const db = getDatabase();
  const rows = allRows<ThoughtRow>(
    db,
    `SELECT id, vault_id, content, created_at, updated_at, source_type, status, backing_note_slug,
            related_thought_ids, extracted_entities, tags, enrichment_json, enrichment_error
     FROM thoughts
     WHERE vault_id = ?
     ORDER BY updated_at DESC
     LIMIT ?`,
    [vaultId, limit]
  );

  return rows.map(mapThoughtRow);
}

export async function markThoughtProcessing(thoughtId: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  runExec(
    db,
    `UPDATE thoughts
     SET status = 'processing', updated_at = ?, enrichment_error = NULL
     WHERE id = ?`,
    [now, thoughtId]
  );
}

export async function finalizeThoughtEnrichment(
  thoughtId: string,
  payload: {
    enrichment: ThoughtEnrichment;
    relatedThoughtIds: string[];
    extractedEntities: string[];
    tags: string[];
  }
): Promise<ThoughtRecord> {
  const db = getDatabase();
  const now = Date.now();

  const row = firstRow<ThoughtRow>(
    db,
    `UPDATE thoughts
     SET status = 'enriched',
         updated_at = ?,
         enrichment_json = ?,
         related_thought_ids = ?,
         extracted_entities = ?,
         tags = ?,
         enrichment_error = NULL
     WHERE id = ?
     RETURNING id, vault_id, content, created_at, updated_at, source_type, status, backing_note_slug,
               related_thought_ids, extracted_entities, tags, enrichment_json, enrichment_error`,
    [
      now,
      JSON.stringify(payload.enrichment),
      JSON.stringify(payload.relatedThoughtIds),
      JSON.stringify(payload.extractedEntities),
      JSON.stringify(payload.tags),
      thoughtId
    ]
  );

  if (!row) {
    throw new Error(`Thought ${thoughtId} not found.`);
  }

  return mapThoughtRow(row);
}

export async function finalizeThoughtFailure(thoughtId: string, message: string): Promise<ThoughtRecord> {
  const db = getDatabase();
  const now = Date.now();

  const row = firstRow<ThoughtRow>(
    db,
    `UPDATE thoughts
     SET status = 'failed', updated_at = ?, enrichment_error = ?
     WHERE id = ?
     RETURNING id, vault_id, content, created_at, updated_at, source_type, status, backing_note_slug,
               related_thought_ids, extracted_entities, tags, enrichment_json, enrichment_error`,
    [now, message, thoughtId]
  );

  if (!row) {
    throw new Error(`Thought ${thoughtId} not found.`);
  }

  return mapThoughtRow(row);
}

export async function saveMemoryItem(input: SaveMemoryItemInput): Promise<MemoryItem> {
  const db = getDatabase();
  const now = Date.now();
  const id = input.id ?? crypto.randomUUID();

  const row = firstRow<MemoryItemRow>(
    db,
    `INSERT INTO memory_items (
       id,
       vault_id,
       kind,
       content,
       source_message_ids,
       linked_note_slug,
       confidence,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       kind = excluded.kind,
       content = excluded.content,
       source_message_ids = excluded.source_message_ids,
       linked_note_slug = excluded.linked_note_slug,
       confidence = excluded.confidence,
       updated_at = excluded.updated_at
     RETURNING id, vault_id, kind, content, source_message_ids, linked_note_slug, confidence,
               created_at, updated_at`,
    [
      id,
      input.vaultId,
      input.kind,
      input.content,
      JSON.stringify(input.sourceMessageIds),
      input.linkedNoteSlug ?? null,
      input.confidence,
      now,
      now
    ]
  );

  if (!row) {
    throw new Error(`Could not load saved memory item ${id}.`);
  }

  return mapMemoryItem(row);
}

export async function seedDatabase(fixture: SeedDatabaseFixture): Promise<void> {
  const db = getDatabase();

  const txn = db.transaction(() => {
    const messageCountBySession = new Map<string, number>();
    for (const message of fixture.messages) {
      messageCountBySession.set(
        message.sessionId,
        (messageCountBySession.get(message.sessionId) ?? 0) + 1
      );
    }

    for (const session of fixture.sessions) {
      runExec(
        db,
        `INSERT INTO chat_sessions (id, title, created_at, updated_at, model, vault_id, message_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          session.title,
          session.createdAt,
          session.updatedAt,
          session.model,
          session.vaultId,
          messageCountBySession.get(session.id) ?? 0
        ]
      );
    }

    for (const message of fixture.messages) {
      const attachmentsJson =
        message.attachments && message.attachments.length > 0
          ? JSON.stringify(message.attachments)
          : null;
      const mediaJson =
        message.mediaArtifacts && message.mediaArtifacts.length > 0
          ? JSON.stringify(message.mediaArtifacts)
          : null;
      const noteActionsJson =
        message.noteActions && message.noteActions.length > 0
          ? JSON.stringify(message.noteActions)
          : null;
      const replyContextJson = message.replyContext ? JSON.stringify(message.replyContext) : null;
      const composerPinsJson =
        message.composerPins && message.composerPins.length > 0
          ? JSON.stringify(message.composerPins)
          : null;

      runExec(
        db,
        `INSERT INTO messages (id, session_id, role, content, created_at, tokens, attachments, media_artifacts, note_actions, reply_context, composer_pins)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          message.sessionId,
          message.role,
          message.content,
          message.createdAt,
          message.tokens,
          attachmentsJson,
          mediaJson,
          noteActionsJson,
          replyContextJson,
          composerPinsJson
        ]
      );
    }
  });

  txn();
}

export async function replaceNoteEmbeddings(
  vaultId: string,
  noteSlug: string,
  chunks: ReplaceNoteEmbeddingInput[]
): Promise<void> {
  const db = getDatabase();

  const txn = db.transaction(() => {
    runExec(
      db,
      `DELETE FROM note_embeddings
       WHERE vault_id = ? AND note_slug = ?`,
      [vaultId, noteSlug]
    );

    const now = Date.now();

    if (chunks.length === 0) {
      return;
    }

    const valueRows: string[] = [];
    const params: unknown[] = [];

    for (const chunk of chunks) {
      valueRows.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      params.push(
        vaultId,
        noteSlug,
        chunk.chunkId,
        chunk.noteTitle,
        chunk.noteType,
        JSON.stringify(chunk.tags),
        chunk.headingPath,
        chunk.content,
        chunk.contentHash,
        chunk.embedding ? JSON.stringify(chunk.embedding) : null,
        now
      );
    }

    runExec(
      db,
      `INSERT INTO note_embeddings (
         vault_id,
         note_slug,
         chunk_id,
         note_title,
         note_type,
         tags,
         heading_path,
         content,
         content_hash,
         embedding,
         updated_at
       )
       VALUES ${valueRows.join(", ")}`,
      params
    );
  });

  txn();
}

export async function listNoteEmbeddings(vaultId: string): Promise<StoredNoteEmbedding[]> {
  const db = getDatabase();
  const rows = allRows<NoteEmbeddingRow>(
    db,
    `SELECT vault_id, note_slug, chunk_id, note_title, note_type, tags, heading_path, content,
            content_hash, embedding, updated_at
     FROM note_embeddings
     WHERE vault_id = ?`,
    [vaultId]
  );

  return rows.map(mapNoteEmbedding);
}

export async function deleteMissingNoteEmbeddings(
  vaultId: string,
  existingSlugs: string[]
): Promise<void> {
  const db = getDatabase();

  if (existingSlugs.length === 0) {
    runExec(db, `DELETE FROM note_embeddings WHERE vault_id = ?`, [vaultId]);
    return;
  }

  const ph = placeholders(existingSlugs.length);
  runExec(
    db,
    `DELETE FROM note_embeddings
     WHERE vault_id = ?
       AND note_slug NOT IN (${ph})`,
    [vaultId, ...existingSlugs]
  );
}

const extractionJobSelectColumns = `id, session_id, vault_id, status, trigger, mode, provider, model,
            transcript_start_index, transcript_end_index, transcript_digest,
            attempt_count, applied_update_count, session_title, error_message,
            cloud_functions_base_url, cloud_publishable_key, preferred_local_model_id,
            priority, max_attempts, next_run_at,
            created_at, started_at, finished_at`;

export async function createExtractionJob(
  input: CreateExtractionJobInput
): Promise<ExtractionJobSnapshot> {
  const db = getDatabase();
  const now = Date.now();
  const id = crypto.randomUUID();

  const row = firstRow<ExtractionJobRow>(
    db,
    `INSERT INTO extraction_jobs (
       id,
       session_id,
       vault_id,
       status,
       trigger,
       mode,
       transcript_start_index,
       transcript_end_index,
       transcript_digest,
       cloud_functions_base_url,
       cloud_publishable_key,
       preferred_local_model_id,
       priority,
       max_attempts,
       created_at
     )
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING ${extractionJobSelectColumns}`,
    [
      id,
      input.sessionId,
      input.vaultId,
      input.trigger,
      input.mode,
      input.transcriptStartIndex,
      input.transcriptEndIndex,
      input.transcriptDigest,
      input.cloudFunctionsBaseUrl ?? null,
      input.cloudPublishableKey ?? null,
      input.preferredLocalModelId ?? null,
      input.priority ?? 0,
      input.maxAttempts ?? 3,
      now
    ]
  );

  if (!row) {
    throw new Error(`Could not load newly created extraction job ${id}.`);
  }

  return mapExtractionJob(row);
}

export async function getExtractionJob(jobId: string): Promise<ExtractionJobSnapshot | null> {
  const db = getDatabase();
  const row = firstRow<ExtractionJobRow>(
    db,
    `SELECT ${extractionJobSelectColumns}
     FROM extraction_jobs
     WHERE id = ?`,
    [jobId]
  );

  return row ? mapExtractionJob(row) : null;
}

export async function updateExtractionJob(
  input: UpdateExtractionJobInput
): Promise<ExtractionJobSnapshot> {
  const db = getDatabase();
  const row = firstRow<ExtractionJobRow>(
    db,
    `SELECT ${extractionJobSelectColumns}
     FROM extraction_jobs
     WHERE id = ?`,
    [input.id]
  );

  if (!row) {
    throw new Error(`Unknown extraction job: ${input.id}`);
  }

  const updated = firstRow<ExtractionJobRow>(
    db,
    `UPDATE extraction_jobs
     SET status = ?,
         provider = ?,
         model = ?,
         transcript_start_index = ?,
         transcript_end_index = ?,
         transcript_digest = ?,
         attempt_count = ?,
         applied_update_count = ?,
         session_title = ?,
         error_message = ?,
         priority = ?,
         max_attempts = ?,
         next_run_at = ?,
         started_at = ?,
         finished_at = ?
     WHERE id = ?
     RETURNING ${extractionJobSelectColumns}`,
    [
      input.status ?? row.status,
      input.provider === undefined ? row.provider : input.provider,
      input.model === undefined ? row.model : input.model,
      input.transcriptStartIndex ?? Number(row.transcript_start_index),
      input.transcriptEndIndex ?? Number(row.transcript_end_index),
      input.transcriptDigest ?? row.transcript_digest,
      input.attemptCount ?? Number(row.attempt_count),
      input.appliedUpdateCount ?? Number(row.applied_update_count),
      input.sessionTitle === undefined ? row.session_title : input.sessionTitle,
      input.errorMessage === undefined ? row.error_message : input.errorMessage,
      input.priority ?? (row.priority !== null ? Number(row.priority) : 0),
      input.maxAttempts ?? (row.max_attempts !== null ? Number(row.max_attempts) : 3),
      input.nextRunAt === undefined
        ? (row.next_run_at !== null ? Number(row.next_run_at) : null)
        : input.nextRunAt,
      input.startedAt === undefined ? (row.started_at !== null ? Number(row.started_at) : null) : input.startedAt,
      input.finishedAt === undefined ? (row.finished_at !== null ? Number(row.finished_at) : null) : input.finishedAt,
      input.id
    ]
  );

  if (!updated) {
    throw new Error(`Unknown extraction job: ${input.id}`);
  }

  return mapExtractionJob(updated);
}

export async function getLatestCompletedExtractionJob(
  sessionId: string
): Promise<ExtractionJobSnapshot | null> {
  const db = getDatabase();
  const row = firstRow<ExtractionJobRow>(
    db,
    `SELECT ${extractionJobSelectColumns}
     FROM extraction_jobs
     WHERE session_id = ? AND status = 'completed'
     ORDER BY finished_at DESC, created_at DESC
     LIMIT 1`,
    [sessionId]
  );

  return row ? mapExtractionJob(row) : null;
}

export async function listQueuedExtractionJobsBySession(
  sessionId: string
): Promise<ExtractionJobSnapshot[]> {
  const db = getDatabase();
  const rows = allRows<ExtractionJobRow>(
    db,
    `SELECT ${extractionJobSelectColumns}
     FROM extraction_jobs
     WHERE session_id = ? AND status IN ('pending', 'running')
     ORDER BY priority DESC, created_at ASC`,
    [sessionId]
  );

  return rows.map(mapExtractionJob);
}

export async function getNextPendingExtractionJob(
  sessionId: string,
  now: number = Date.now()
): Promise<ExtractionJobSnapshot | null> {
  const db = getDatabase();
  const row = firstRow<ExtractionJobRow>(
    db,
    `SELECT ${extractionJobSelectColumns}
     FROM extraction_jobs
     WHERE session_id = ? AND status = 'pending'
       AND (next_run_at IS NULL OR next_run_at <= ?)
     ORDER BY priority DESC, created_at ASC
     LIMIT 1`,
    [sessionId, now]
  );

  return row ? mapExtractionJob(row) : null;
}

export async function getEarliestPendingRunAt(sessionId: string): Promise<number | null> {
  const db = getDatabase();
  const row = firstRow<{ next_run_at: string | null }>(
    db,
    `SELECT next_run_at FROM extraction_jobs
     WHERE session_id = ? AND status = 'pending' AND next_run_at IS NOT NULL
     ORDER BY next_run_at ASC
     LIMIT 1`,
    [sessionId]
  );

  if (!row || row.next_run_at === null || row.next_run_at === undefined) {
    return null;
  }

  return Number(row.next_run_at);
}

export async function listResumableExtractionJobs(): Promise<ExtractionJobSnapshot[]> {
  const db = getDatabase();
  const rows = allRows<ExtractionJobRow>(
    db,
    `SELECT ${extractionJobSelectColumns}
     FROM extraction_jobs
     WHERE status IN ('pending', 'running')
     ORDER BY priority DESC, created_at ASC`
  );

  return rows.map(mapExtractionJob);
}

export async function listRecentExtractionJobs(limit = 20): Promise<ExtractionJobSnapshot[]> {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = allRows<ExtractionJobRow>(
    db,
    `SELECT ${extractionJobSelectColumns}
     FROM extraction_jobs
     ORDER BY COALESCE(finished_at, started_at, created_at) DESC
     LIMIT ?`,
    [safeLimit]
  );

  return rows.map(mapExtractionJob);
}

export async function getExtractionJobConfig(
  jobId: string
): Promise<{
  cloudFunctionsBaseUrl: string | null;
  cloudPublishableKey: string | null;
  preferredLocalModelId: string | null;
} | null> {
  const db = getDatabase();
  const row = firstRow<ExtractionJobConfigRow>(
    db,
    `SELECT cloud_functions_base_url, cloud_publishable_key, preferred_local_model_id
     FROM extraction_jobs
     WHERE id = ?`,
    [jobId]
  );

  if (!row) {
    return null;
  }

  return {
    cloudFunctionsBaseUrl: row.cloud_functions_base_url,
    cloudPublishableKey: row.cloud_publishable_key,
    preferredLocalModelId: row.preferred_local_model_id
  };
}
