import {
  hydrateIfEmpty,
  listStoreRecords,
  openDemoDb,
  putStoreRecord,
  type DemoSeedPayload,
} from "@trellis/demo-local";
import type { AppBootstrap, ChatModel, ChatSessionSummary, MessageRecord } from "@trellis/contracts";
import seedDb from "./seed/db.json";
import { buildWebPlaceholderBootstrap } from "@/lib/bootstrap/webPlaceholder";
import { DEMO_BUCKET_ID } from "./config";
import { getDemoVaultManifestForBootstrap } from "./demoVault";

const APP_ID = "trellis";
const SCHEMA_VERSION = 1;

type SeedDb = {
  sessions: Array<{
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    model: ChatModel;
    bucketId: string;
  }>;
  messages: Array<{
    id: string;
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    createdAt: number;
    tokens?: number | null;
  }>;
};

let dbPromise: ReturnType<typeof openDemoDb> | null = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = openDemoDb(APP_ID, SCHEMA_VERSION);
  }
  return dbPromise;
}

function buildSeedPayload(): DemoSeedPayload {
  const typed = seedDb as SeedDb;
  return {
    version: "trellis-demo-v2",
    stores: {
      sessions: typed.sessions.map((session) => ({
        id: session.id,
        value: {
          ...session,
          messageCount: typed.messages.filter((message) => message.sessionId === session.id).length,
        } satisfies ChatSessionSummary,
      })),
      messages: typed.messages.map((message) => ({
        id: message.id,
        value: {
          ...message,
          tokens: message.tokens ?? null,
        } satisfies MessageRecord,
      })),
    },
  };
}

export async function ensureDemoHydrated(): Promise<void> {
  const db = await getDb();
  await hydrateIfEmpty(db, buildSeedPayload());
}

export async function listDemoSessions(): Promise<ChatSessionSummary[]> {
  await ensureDemoHydrated();
  const db = await getDb();
  return listStoreRecords<ChatSessionSummary>(db, "sessions");
}

export async function getDemoMessages(sessionId: string): Promise<MessageRecord[]> {
  await ensureDemoHydrated();
  const db = await getDb();
  const rows = await listStoreRecords<MessageRecord>(db, "messages");
  return rows
    .filter((message) => message.sessionId === sessionId)
    .sort((left, right) => left.createdAt - right.createdAt);
}

export async function replaceDemoMessages(input: {
  sessionId: string;
  messages: MessageRecord[];
}): Promise<void> {
  const db = await getDb();
  const existing = await listStoreRecords<MessageRecord>(db, "messages");
  const tx = db.transaction("records", "readwrite");
  await Promise.all([
    ...existing
      .filter((message) => message.sessionId === input.sessionId)
      .map((message) => tx.store.delete(["messages", message.id])),
    ...input.messages.map((message) =>
      tx.store.put({ store: "messages", id: message.id, value: message }),
    ),
    tx.done,
  ]);

  const sessions = await listStoreRecords<ChatSessionSummary>(db, "sessions");
  const session = sessions.find((row) => row.id === input.sessionId);
  if (session) {
    await putStoreRecord(db, "sessions", session.id, {
      ...session,
      messageCount: input.messages.length,
      updatedAt: Date.now(),
    });
  }
}

export async function createDemoSession(input: {
  model: ChatSessionSummary["model"];
  bucketId: string;
}): Promise<ChatSessionSummary> {
  const db = await getDb();
  const now = Date.now();
  const session: ChatSessionSummary = {
    id: crypto.randomUUID(),
    title: "Untitled Session",
    createdAt: now,
    updatedAt: now,
    model: input.model,
    messageCount: 0,
    bucketId: input.bucketId,
  };
  await putStoreRecord(db, "sessions", session.id, session);
  return session;
}

export async function updateDemoSession(
  payload: Partial<ChatSessionSummary> & { id: string },
): Promise<ChatSessionSummary> {
  const db = await getDb();
  const sessions = await listStoreRecords<ChatSessionSummary>(db, "sessions");
  const current = sessions.find((session) => session.id === payload.id);
  if (!current) {
    throw new Error(`Unknown session: ${payload.id}`);
  }
  const next: ChatSessionSummary = {
    ...current,
    ...payload,
    updatedAt: payload.updatedAt ?? Date.now(),
  };
  await putStoreRecord(db, "sessions", next.id, next);
  return next;
}

export async function deleteDemoSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.delete("records", ["sessions", sessionId]);
  const messages = await listStoreRecords<MessageRecord>(db, "messages");
  const tx = db.transaction("records", "readwrite");
  await Promise.all([
    ...messages
      .filter((message) => message.sessionId === sessionId)
      .map((message) => tx.store.delete(["messages", message.id])),
    tx.done,
  ]);
}

export async function buildDemoBootstrap(): Promise<AppBootstrap> {
  await ensureDemoHydrated();
  const placeholder = buildWebPlaceholderBootstrap();
  const sessions = await listDemoSessions();
  const vault = await getDemoVaultManifestForBootstrap();
  const previewWorkspace = {
    id: "preview" as const,
    label: "Preview",
    description: "Portfolio demo workspace",
    localOnly: true,
    canReset: true,
    isPreview: true,
    seedVersion: "trellis-demo-v2",
  };

  return {
    ...placeholder,
    workspace: previewWorkspace,
    workspaces: [previewWorkspace],
    settings: {
      ...placeholder.settings,
      activeBucketId: DEMO_BUCKET_ID,
      buckets: [{ id: DEMO_BUCKET_ID, name: "Preview Vault", path: "preview" }],
      cloudSyncEnabled: false,
    },
    sessions,
    notes: vault.notes,
    folders: vault.folders,
    graph: vault.graph,
    authSession: null,
    needsWorkspaceChoice: false,
  };
}
