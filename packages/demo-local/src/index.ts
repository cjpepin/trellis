import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const SESSION_STORAGE_KEY = "portfolio_demo_session_id";

export interface DemoMetaRecord {
  key: string;
  value: string;
}

export interface DemoStoreRecord {
  store: string;
  id: string;
  value: unknown;
}

interface DemoDbSchema extends DBSchema {
  meta: {
    key: string;
    value: DemoMetaRecord;
  };
  records: {
    key: [string, string];
    value: DemoStoreRecord;
    indexes: { "by-store": string };
  };
}

export type DemoDb = IDBPDatabase<DemoDbSchema>;

export function demoDbName(appId: string): string {
  return `portfolio-demo-${appId}`;
}

export async function openDemoDb(appId: string, schemaVersion: number): Promise<DemoDb> {
  return openDB<DemoDbSchema>(demoDbName(appId), schemaVersion, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore("meta", { keyPath: "key" });
        const records = db.createObjectStore("records", {
          keyPath: ["store", "id"],
        });
        records.createIndex("by-store", "store");
      }
      void tx;
    },
  });
}

export async function getMeta(db: DemoDb, key: string): Promise<string | null> {
  const row = await db.get("meta", key);
  return row?.value ?? null;
}

export async function setMeta(db: DemoDb, key: string, value: string): Promise<void> {
  await db.put("meta", { key, value });
}

export async function listStoreRecords<T>(db: DemoDb, store: string): Promise<T[]> {
  const rows = await db.getAllFromIndex("records", "by-store", store);
  return rows.map((row) => row.value as T);
}

export async function getStoreRecord<T>(db: DemoDb, store: string, id: string): Promise<T | null> {
  const row = await db.get("records", [store, id]);
  return row ? (row.value as T) : null;
}

export async function putStoreRecord(db: DemoDb, store: string, id: string, value: unknown): Promise<void> {
  await db.put("records", { store, id, value });
}

export async function deleteStoreRecord(db: DemoDb, store: string, id: string): Promise<void> {
  await db.delete("records", [store, id]);
}

export async function clearStore(db: DemoDb, store: string): Promise<void> {
  const rows = await db.getAllFromIndex("records", "by-store", store);
  const tx = db.transaction("records", "readwrite");
  await Promise.all([
    ...rows.map((row) => tx.store.delete([row.store, row.id])),
    tx.done,
  ]);
}

export interface DemoSeedPayload {
  version: string;
  stores: Record<string, Array<{ id: string; value: unknown }>>;
}

export async function hydrateIfEmpty(
  db: DemoDb,
  seed: DemoSeedPayload,
  seedMetaKey = "seed_version",
): Promise<boolean> {
  const existing = await getMeta(db, seedMetaKey);
  if (existing === seed.version) {
    return false;
  }

  for (const [store, rows] of Object.entries(seed.stores)) {
    await clearStore(db, store);
    const tx = db.transaction("records", "readwrite");
    await Promise.all([
      ...rows.map((row) => tx.store.put({ store, id: row.id, value: row.value })),
      tx.done,
    ]);
  }

  await setMeta(db, seedMetaKey, seed.version);
  return true;
}

export function demoSessionId(): string {
  if (typeof localStorage === "undefined") {
    return "demo-session-server";
  }

  const existing = localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(SESSION_STORAGE_KEY, created);
  return created;
}

export function isDemoModeFlag(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}
