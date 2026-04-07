import { PGlite } from "@electric-sql/pglite";
import type {
  ChatModel,
  ChatSessionSummary,
  MessageRecord,
  RecordWikiOpInput
} from "../ipc/types";
import { normalizeChatModel } from "../ipc/types";

let database: PGlite | null = null;

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

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as MessageRecord["role"],
    content: row.content,
    createdAt: Number(row.created_at),
    tokens: row.tokens !== null ? Number(row.tokens) : null
  };
}

async function ensureSchema(db: PGlite): Promise<void> {
  await db.exec(`
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
      tokens INTEGER
    );

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
  `);
}

export async function initializeDatabase(dataDir: string): Promise<PGlite> {
  if (!database) {
    database = new PGlite(dataDir);
    await database.waitReady;
    await ensureSchema(database);
  }

  return database;
}

export function getDatabase(): PGlite {
  if (!database) {
    throw new Error("Database has not been initialized yet.");
  }

  return database;
}

export async function listSessions(): Promise<ChatSessionSummary[]> {
  const result = await getDatabase().query<SessionRow>(
    `SELECT id, title, created_at, updated_at, model, message_count, vault_id
     FROM chat_sessions
     ORDER BY updated_at DESC`
  );

  return result.rows.map(mapSession);
}

export async function createSession(model: ChatModel, vaultId: string): Promise<ChatSessionSummary> {
  const now = Date.now();
  const id = crypto.randomUUID();

  await getDatabase().query(
    `INSERT INTO chat_sessions (id, title, created_at, updated_at, model, vault_id, message_count)
     VALUES ($1, $2, $3, $4, $5, $6, 0)`,
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
  const result = await getDatabase().query<MessageRow>(
    `SELECT id, session_id, role, content, created_at, tokens
     FROM messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId]
  );

  return result.rows.map(mapMessage);
}

export async function appendMessages(messages: MessageRecord[]): Promise<void> {
  const db = getDatabase();

  await db.transaction(async (tx) => {
    const touchedSessions = new Set<string>();

    for (const message of messages) {
      await tx.query(
        `INSERT INTO messages (id, session_id, role, content, created_at, tokens)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           tokens = EXCLUDED.tokens`,
        [message.id, message.sessionId, message.role, message.content, message.createdAt, message.tokens]
      );
      touchedSessions.add(message.sessionId);
    }

    const now = Date.now();
    for (const sessionId of touchedSessions) {
      await tx.query(
        `UPDATE chat_sessions
         SET updated_at = $1,
             message_count = (SELECT COUNT(*) FROM messages WHERE session_id = $2)
         WHERE id = $2`,
        [now, sessionId]
      );
    }
  });
}

export async function replaceMessages(sessionId: string, messages: MessageRecord[]): Promise<void> {
  const db = getDatabase();

  await db.transaction(async (tx) => {
    await tx.query(
      `DELETE FROM messages WHERE session_id = $1`,
      [sessionId]
    );

    for (const message of messages) {
      await tx.query(
        `INSERT INTO messages (id, session_id, role, content, created_at, tokens)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [message.id, message.sessionId, message.role, message.content, message.createdAt, message.tokens]
      );
    }

    await tx.query(
      `UPDATE chat_sessions
       SET updated_at = $1, message_count = $2
       WHERE id = $3`,
      [Date.now(), messages.length, sessionId]
    );
  });
}

export async function updateSession(
  payload: Partial<ChatSessionSummary> & { id: string }
): Promise<ChatSessionSummary> {
  const db = getDatabase();

  const existing = await db.query<SessionRow>(
    `SELECT id, title, created_at, updated_at, model, message_count, vault_id
     FROM chat_sessions
     WHERE id = $1`,
    [payload.id]
  );

  const row = existing.rows[0];
  if (!row) {
    throw new Error(`Unknown session: ${payload.id}`);
  }

  const updatedTitle = payload.title ?? row.title ?? "Untitled Session";
  const updatedAt = payload.updatedAt ?? Date.now();
  const updatedModel = payload.model ?? row.model;
  const updatedVaultId = payload.vaultId ?? row.vault_id ?? "";

  await db.query(
    `UPDATE chat_sessions
     SET title = $1, updated_at = $2, model = $3, vault_id = $4
     WHERE id = $5`,
    [updatedTitle, updatedAt, updatedModel, updatedVaultId, payload.id]
  );

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

  await db.transaction(async (tx) => {
    const now = Date.now();

    for (const item of ops) {
      await tx.query(
        `INSERT INTO wiki_ops (id, session_id, file, action, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), item.sessionId ?? null, item.file, item.action, now]
      );
    }
  });
}
