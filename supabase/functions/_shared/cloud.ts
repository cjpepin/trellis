import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type {
  CloudChatMessage,
  CloudChatSessionSummary,
  CloudGraphData,
  CloudGraphEdge,
  CloudGraphNode,
  CloudNote,
  CloudNoteSummary,
  CloudProviderCredentialStatus,
  CloudUserPreferences,
  CloudWorkspace,
  JsonObject
} from "../../../shared/cloud/types.ts";
import { extractParsedCloudWikiLinks } from "../../../shared/cloud/wikiLinks.ts";
import type { ExtractionNoteType } from "../../../shared/extraction/contracts.ts";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  migration_status: CloudWorkspace["migrationStatus"];
  import_summary: JsonObject | null;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  markdown_body: string;
  frontmatter_json: JsonObject | null;
  excerpt: string;
  note_type: ExtractionNoteType;
  folder_path: string;
  source_count: number;
  url: string | null;
  created_at: string;
  updated_at: string;
}

interface NoteLinkRow {
  source_note_id: string;
  target_slug: string;
}

interface ProviderCredentialRow {
  provider: CloudProviderCredentialStatus["provider"];
  last_four: string;
  encrypted_secret: string;
  secret_nonce: string;
  updated_at: string;
}

interface UserPreferencesRow {
  theme: string | null;
  active_workspace_id: string | null;
  chat_json: JsonObject | null;
  platform_json: JsonObject | null;
}

interface ChatSessionRow {
  id: string;
  workspace_id: string;
  legacy_id: string | null;
  title: string;
  model: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  legacy_id: string | null;
  role: "user" | "assistant";
  content: string;
  tokens: number | null;
  attachments_json: JsonValue[] | null;
  media_artifacts_json: JsonValue[] | null;
  note_actions_json: JsonValue[] | null;
  reply_context_json: JsonObject | null;
  composer_pins_json: JsonValue[] | null;
  created_at: string;
}

const defaultWorkspaceName = "Personal Workspace";
const defaultWorkspaceSlug = "personal";
const defaultProviderStatuses: CloudProviderCredentialStatus[] = [
  {
    provider: "openai",
    configured: false,
    lastFour: null,
    updatedAt: null
  },
  {
    provider: "anthropic",
    configured: false,
    lastFour: null,
    updatedAt: null
  }
];

interface FolderRow {
  path: string;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function workspaceNameToSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || defaultWorkspaceSlug;
}

export function normalizeFolderPath(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  if (normalized.includes("..")) {
    throw new Error("Folder paths must stay inside the workspace root.");
  }

  return normalized;
}

export function buildNoteExcerpt(markdownBody: string, maxChars = 220): string {
  const withoutFrontmatter = markdownBody.replace(/^---[\s\S]*?---\s*/u, "");
  const flattened = withoutFrontmatter
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, " ")
    .replace(/[#>*_`-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (flattened.length <= maxChars) {
    return flattened;
  }

  return `${flattened.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function mapWorkspaceRow(row: WorkspaceRow): CloudWorkspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    migrationStatus: row.migration_status,
    importSummary: row.import_summary ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapNoteSummaryRow(
  row: NoteRow,
  inboundCountBySlug: ReadonlyMap<string, number>
): CloudNoteSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    tags: readNoteTags(row.frontmatter_json),
    noteType: row.note_type,
    folderPath: row.folder_path,
    sourceCount: row.source_count,
    url: row.url,
    inboundCount: inboundCountBySlug.get(row.slug) ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapNoteRow(row: NoteRow, inboundCountBySlug: ReadonlyMap<string, number>): CloudNote {
  const summary = mapNoteSummaryRow(row, inboundCountBySlug);
  return {
    ...summary,
    markdownBody: row.markdown_body,
    frontmatter: row.frontmatter_json ?? {}
  };
}

export function mapChatSessionRow(row: ChatSessionRow): CloudChatSessionSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    legacyId: row.legacy_id,
    title: row.title,
    model: row.model,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapChatMessageRow(row: ChatMessageRow): CloudChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    legacyId: row.legacy_id,
    role: row.role,
    content: row.content,
    tokens: row.tokens,
    attachments: row.attachments_json ?? [],
    mediaArtifacts: row.media_artifacts_json ?? [],
    noteActions: row.note_actions_json ?? [],
    replyContext: row.reply_context_json,
    composerPins: row.composer_pins_json ?? [],
    createdAt: row.created_at
  };
}

function readNoteTags(frontmatter: JsonObject | null): string[] {
  const rawTags = frontmatter?.tags;

  if (!Array.isArray(rawTags)) {
    return [];
  }

  return rawTags.filter((value): value is string => typeof value === "string");
}

export function buildInboundCountBySlug(noteLinks: NoteLinkRow[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const row of noteLinks) {
    counts.set(row.target_slug, (counts.get(row.target_slug) ?? 0) + 1);
  }

  return counts;
}

export function buildWorkspaceGraph(
  notes: CloudNoteSummary[],
  noteLinks: Array<{ sourceNoteId: string; targetSlug: string; targetTitle?: string }>
): CloudGraphData {
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const noteBySlug = new Map(notes.map((note) => [note.slug, note]));
  const edges: CloudGraphEdge[] = [];
  const seenEdges = new Set<string>();
  const placeholderTargets = new Map<string, string>();

  for (const link of noteLinks) {
    const source = noteById.get(link.sourceNoteId);
    const target = noteBySlug.get(link.targetSlug);

    if (!source) {
      continue;
    }

    if (!target) {
      placeholderTargets.set(link.targetSlug, link.targetTitle ?? link.targetSlug);
      continue;
    }

    const edgeKey = `${source.slug}::${target.slug}`;

    if (seenEdges.has(edgeKey)) {
      continue;
    }

    seenEdges.add(edgeKey);
    edges.push({
      source: source.slug,
      target: target.slug
    });
  }

  const nodes: CloudGraphNode[] = notes.map((note) => ({
    id: note.slug,
    slug: note.slug,
    title: note.title,
    tags: note.tags,
    noteType: note.noteType,
    folderPath: note.folderPath,
    inboundCount: note.inboundCount,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    isPlaceholder: false
  }));

  for (const [slug, title] of placeholderTargets.entries()) {
    nodes.push({
      id: slug,
      slug,
      title,
      tags: [],
      noteType: "concept",
      folderPath: "",
      inboundCount: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      isPlaceholder: true
    });
  }

  return { nodes, edges };
}

export function buildNoteLinkInserts(noteId: string, markdownBody: string) {
  return extractParsedCloudWikiLinks(markdownBody).map((link) => ({
    source_note_id: noteId,
    target_slug: link.slug,
    target_title: link.title
  }));
}

export async function ensureDefaultWorkspace(
  admin: SupabaseClient,
  userId: string
): Promise<CloudWorkspace[]> {
  const { data: existingRows, error: existingError } = await admin
    .from("workspaces")
    .select("id, name, slug, migration_status, import_summary, created_at, updated_at")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });

  if (existingError) {
    throw existingError;
  }

  if (existingRows && existingRows.length > 0) {
    return existingRows.map((row) => mapWorkspaceRow(row as WorkspaceRow));
  }

  const { data: insertedRow, error: insertError } = await admin
    .from("workspaces")
    .insert({
      owner_user_id: userId,
      name: defaultWorkspaceName,
      slug: defaultWorkspaceSlug
    })
    .select("id, name, slug, migration_status, import_summary, created_at, updated_at")
    .single();

  if (insertError || !insertedRow) {
    throw insertError ?? new Error("Could not create a default workspace.");
  }

  return [mapWorkspaceRow(insertedRow as WorkspaceRow)];
}

export async function getUserPreferences(
  admin: SupabaseClient,
  userId: string
): Promise<CloudUserPreferences> {
  const { data, error } = await admin
    .from("user_preferences")
    .select("theme, active_workspace_id, chat_json, platform_json")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = data as UserPreferencesRow | null;

  return {
    theme: row?.theme ?? null,
    activeWorkspaceId: row?.active_workspace_id ?? null,
    chat: row?.chat_json ?? {},
    platform: row?.platform_json ?? {}
  };
}

export async function upsertUserPreferences(
  admin: SupabaseClient,
  userId: string,
  input: Partial<CloudUserPreferences>
): Promise<CloudUserPreferences> {
  let mergedPlatform: Record<string, unknown> | undefined;
  if (input.platform !== undefined) {
    const existing = await getUserPreferences(admin, userId);
    mergedPlatform = {
      ...(existing.platform as Record<string, unknown>),
      ...input.platform
    };
  }

  const nextRow = {
    user_id: userId,
    ...(input.theme !== undefined ? { theme: input.theme } : {}),
    ...(input.activeWorkspaceId !== undefined
      ? { active_workspace_id: input.activeWorkspaceId }
      : {}),
    ...(input.chat !== undefined ? { chat_json: input.chat } : {}),
    ...(mergedPlatform !== undefined ? { platform_json: mergedPlatform } : {})
  };

  const { data, error } = await admin
    .from("user_preferences")
    .upsert(nextRow, { onConflict: "user_id" })
    .select("theme, active_workspace_id, chat_json, platform_json")
    .single();

  if (error || !data) {
    throw error ?? new Error("Could not save user preferences.");
  }

  const row = data as UserPreferencesRow;

  return {
    theme: row.theme,
    activeWorkspaceId: row.active_workspace_id,
    chat: row.chat_json ?? {},
    platform: row.platform_json ?? {}
  };
}

export async function listProviderCredentialStatuses(
  admin: SupabaseClient,
  userId: string
): Promise<CloudProviderCredentialStatus[]> {
  const { data, error } = await admin
    .from("provider_credentials")
    .select("provider, last_four, updated_at")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ProviderCredentialRow[];
  const statusByProvider = new Map(
    defaultProviderStatuses.map((status) => [status.provider, { ...status }])
  );

  for (const row of rows) {
    statusByProvider.set(row.provider, {
      provider: row.provider,
      configured: true,
      lastFour: row.last_four,
      updatedAt: row.updated_at
    });
  }

  return [...statusByProvider.values()];
}

export async function getStoredProviderCredentialSecret(
  admin: SupabaseClient,
  userId: string,
  provider: CloudProviderCredentialStatus["provider"]
): Promise<string | null> {
  const { data, error } = await admin
    .from("provider_credentials")
    .select("provider, last_four, encrypted_secret, secret_nonce, updated_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = data as ProviderCredentialRow | null;

  if (!row) {
    return null;
  }

  return decryptProviderCredentialSecret({
    encryptedSecret: row.encrypted_secret,
    secretNonce: row.secret_nonce
  });
}

/**
 * BYOK key from `provider_credentials` first, then the Edge Function secret (hosted extraction).
 * Matches how the `chat` function uses env fallbacks via `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.
 */
export async function resolveExtractionProviderApiKey(
  admin: SupabaseClient,
  userId: string,
  provider: CloudProviderCredentialStatus["provider"]
): Promise<string | null> {
  const stored = await getStoredProviderCredentialSecret(admin, userId, provider);
  if (stored) {
    return stored;
  }

  const envName = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const fromEnv = Deno.env.get(envName)?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

function readCredentialSecretSeed(): Uint8Array {
  const rawSeed = Deno.env.get("TRELLIS_PROVIDER_CREDENTIALS_SECRET")?.trim();

  if (!rawSeed) {
    throw new Error("Missing TRELLIS_PROVIDER_CREDENTIALS_SECRET.");
  }

  const normalized = rawSeed.startsWith("base64:") ? rawSeed.slice("base64:".length) : rawSeed;
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  if (bytes.byteLength !== 32) {
    throw new Error("TRELLIS_PROVIDER_CREDENTIALS_SECRET must decode to 32 bytes.");
  }

  return bytes;
}

async function getCredentialCryptoKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    readCredentialSecretSeed(),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

export async function encryptProviderCredentialSecret(secret: string): Promise<{
  encryptedSecret: string;
  secretNonce: string;
  lastFour: string;
  keyVersion: number;
}> {
  const key = await getCredentialCryptoKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(secret);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce
      },
      key,
      plaintext
    )
  );

  return {
    encryptedSecret: bytesToBase64(ciphertext),
    secretNonce: bytesToBase64(nonce),
    lastFour: secret.slice(-4),
    keyVersion: 1
  };
}

export async function decryptProviderCredentialSecret(input: {
  encryptedSecret: string;
  secretNonce: string;
}): Promise<string> {
  const key = await getCredentialCryptoKey();
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(input.secretNonce)
    },
    key,
    base64ToBytes(input.encryptedSecret)
  );

  return new TextDecoder().decode(plaintext);
}

export function assertWorkspaceAccess(
  workspaces: CloudWorkspace[],
  workspaceId: string | null | undefined
): CloudWorkspace {
  if (!workspaceId) {
    throw new Error("A workspace id is required.");
  }

  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);

  if (!workspace) {
    throw new Error("That workspace could not be found for this account.");
  }

  return workspace;
}

export function safeJsonObject(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

export function expandFolderPathAncestors(folderPath: string): string[] {
  const normalized = normalizeFolderPath(folderPath);

  if (normalized.length === 0) {
    return [];
  }

  const segments = normalized.split("/");
  const paths: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    paths.push(segments.slice(0, index + 1).join("/"));
  }

  return paths;
}

export function collectWorkspaceFolderPaths(
  notes: Array<{ folder_path: string }>,
  folders: FolderRow[]
): string[] {
  const allPaths = new Set<string>();

  for (const note of notes) {
    for (const path of expandFolderPathAncestors(note.folder_path)) {
      allPaths.add(path);
    }
  }

  for (const folder of folders) {
    for (const path of expandFolderPathAncestors(folder.path)) {
      allPaths.add(path);
    }
  }

  return [...allPaths].sort((left, right) => left.localeCompare(right));
}

export async function ensureWorkspaceFolderPath(
  admin: SupabaseClient,
  workspaceId: string,
  folderPath: string
): Promise<void> {
  const normalized = normalizeFolderPath(folderPath);

  if (normalized.length === 0) {
    return;
  }

  const rows = expandFolderPathAncestors(normalized).map((path) => ({
    workspace_id: workspaceId,
    path,
    name: path.split("/").at(-1) ?? path
  }));

  const { error } = await admin
    .from("workspace_folders")
    .upsert(rows, { onConflict: "workspace_id,path" });

  if (error) {
    throw error;
  }
}
