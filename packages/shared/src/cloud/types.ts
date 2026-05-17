import type { ExtractionNoteType, ExtractionResponse } from "../extraction/contracts.ts";

export type CloudChatProvider = "openai" | "anthropic";
export type CloudSubscriptionTier = "trial" | "byok" | "pro";
export type WorkspaceMigrationStatus = "not_started" | "running" | "completed" | "failed";
export type CloudChatMessageRole = "user" | "assistant";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface CloudWorkspace {
  id: string;
  name: string;
  slug: string;
  migrationStatus: WorkspaceMigrationStatus;
  importSummary: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface CloudUserPreferences {
  theme: string | null;
  activeWorkspaceId: string | null;
  chat: JsonObject;
  platform: JsonObject;
}

/** Partial update for `user-preferences` Edge Function (PATCH/POST). */
export interface CloudPatchUserPreferencesInput {
  theme?: string | null;
  activeWorkspaceId?: string | null;
  chat?: JsonObject;
  platform?: JsonObject;
}

/** Response from `chat-session-extract`: client applies updates with shared guardrails. */
export interface CloudSessionExtractionResponse {
  sessionTitle: string;
  extraction: ExtractionResponse;
}

export interface CloudProviderCredentialStatus {
  provider: CloudChatProvider;
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
}

export interface CloudNoteSummary {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  noteType: ExtractionNoteType;
  folderPath: string;
  sourceCount: number;
  url: string | null;
  inboundCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CloudNote extends CloudNoteSummary {
  markdownBody: string;
  frontmatter: JsonObject;
}

export interface CloudGraphNode {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  noteType: ExtractionNoteType;
  folderPath: string;
  inboundCount: number;
  createdAt: string;
  updatedAt: string;
  isPlaceholder?: boolean;
}

export interface CloudGraphEdge {
  source: string;
  target: string;
}

export interface CloudGraphData {
  nodes: CloudGraphNode[];
  edges: CloudGraphEdge[];
}

export interface CloudChatSessionSummary {
  id: string;
  workspaceId: string;
  legacyId: string | null;
  title: string;
  model: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CloudChatMessage {
  id: string;
  sessionId: string;
  legacyId: string | null;
  role: CloudChatMessageRole;
  content: string;
  tokens: number | null;
  attachments: JsonValue[];
  mediaArtifacts: JsonValue[];
  noteActions: JsonValue[];
  replyContext: JsonObject | null;
  composerPins: JsonValue[];
  createdAt: string;
}

export interface CloudMemoryItem {
  id: string;
  workspaceId: string;
  legacyId: string | null;
  kind: string;
  content: string;
  sourceMessageIds: string[];
  linkedNoteSlug: string | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface CloudThought {
  id: string;
  workspaceId: string;
  legacyId: string | null;
  content: string;
  sourceType: string;
  status: string;
  backingNoteSlug: string | null;
  relatedThoughtIds: string[];
  extractedEntities: string[];
  tags: string[];
  enrichment: JsonObject | null;
  enrichmentError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudSourceDocument {
  id: string;
  workspaceId: string;
  legacyId: string | null;
  sourceType: "pdf" | "web" | "text";
  title: string;
  sourcePath: string | null;
  storagePath: string | null;
  mimeType: string | null;
  byteSize: number | null;
  sha256: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudAttachment {
  id: string;
  workspaceId: string;
  legacyId: string | null;
  chatSessionId: string | null;
  noteId: string | null;
  sourceDocumentId: string | null;
  bucket: "note-assets" | "source-files" | "exports";
  storagePath: string;
  mimeType: string | null;
  byteSize: number | null;
  sha256: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudBootstrapResponse {
  /** When true (web cloud bootstrap), workspace sync is withheld until deletion is resolved / recovered. */
  accountPendingDeletion?: boolean;
  deletedAt?: string | null;
  workspaces: CloudWorkspace[];
  activeWorkspaceId: string;
  preferences: CloudUserPreferences;
  providerCredentialStatuses: CloudProviderCredentialStatus[];
  chatSessions: CloudChatSessionSummary[];
  folderPaths: string[];
  notes: CloudNoteSummary[];
  graph: CloudGraphData;
}

export type CloudStrandRevisionActor = "user" | "trellis" | "import" | "system";

export interface CloudUpsertNoteInput {
  workspaceId: string;
  slug?: string;
  title: string;
  markdownBody: string;
  frontmatter?: JsonObject;
  noteType?: ExtractionNoteType;
  folderPath?: string;
  sourceCount?: number;
  url?: string | null;
  createdAt?: string;
  updatedAt?: string;
  legacyId?: string | null;
  /** When set, a row is stored in `note_revisions` if the body changed (cloud). */
  strandRevision?: {
    actor: CloudStrandRevisionActor;
    sessionId?: string | null;
  } | null;
}

export interface CloudChatRetrievalRequest {
  workspaceId: string;
  mode: "auto" | "off" | "local";
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  sessionTitle?: string | null;
  activeNoteSlug?: string | null;
  currentSessionId?: string | null;
  pinnedNoteSlugs?: string[];
}

/** Shape returned by Edge `chat-retrieval` (matches desktop chat context packets). */
export interface CloudChatContextReference {
  type: "note" | "memory";
  title: string;
  excerpt: string;
  content: string;
  tags?: string[];
  slug?: string;
  linkedNoteSlug?: string | null;
  isExplicitMatch?: boolean;
}

export interface CloudChatRetrievalResponse {
  mode: "auto" | "off" | "local";
  references: CloudChatContextReference[];
  sourceLabels: string[];
}

export interface CloudNoteRevisionSummary {
  id: string;
  createdAt: string;
  actor: CloudStrandRevisionActor;
  sessionId: string | null;
  sessionTitle: string | null;
  contentSha256: string;
  /** Wiki-relative path for UI parity (e.g. `folder/slug.md`). */
  file: string;
}

export interface CloudDeleteNoteInput {
  workspaceId: string;
  slug: string;
}

export interface CloudProviderCredentialWriteInput {
  provider: CloudChatProvider;
  apiKey: string;
}

export interface CloudUpsertChatSessionInput {
  workspaceId: string;
  id: string;
  title: string;
  model: string;
  messageCount?: number;
  createdAt?: string;
  updatedAt?: string;
  legacyId?: string | null;
}

export interface CloudChatMessageWriteInput {
  id: string;
  role: CloudChatMessageRole;
  content: string;
  tokens?: number | null;
  attachments?: JsonValue[];
  mediaArtifacts?: JsonValue[];
  noteActions?: JsonValue[];
  replyContext?: JsonObject | null;
  composerPins?: JsonValue[];
  createdAt: string;
  legacyId?: string | null;
}

export interface CloudReplaceChatMessagesInput {
  workspaceId: string;
  sessionId: string;
  messages: CloudChatMessageWriteInput[];
}

export interface CloudCreateFolderInput {
  workspaceId: string;
  name: string;
  parentPath?: string | null;
}

export interface CloudRenameFolderInput {
  workspaceId: string;
  path: string;
  name: string;
  parentPath?: string | null;
}

export interface CloudDeleteFolderInput {
  workspaceId: string;
  path: string;
}

export interface CloudMigrationImportedNoteInput {
  legacyId: string;
  slug: string;
  title: string;
  markdownBody: string;
  frontmatter?: JsonObject;
  noteType?: ExtractionNoteType;
  folderPath?: string;
  sourceCount?: number;
  url?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CloudMigrationImportedChatMessageInput {
  legacyId: string;
  role: CloudChatMessageRole;
  content: string;
  tokens?: number | null;
  attachments?: JsonValue[];
  mediaArtifacts?: JsonValue[];
  noteActions?: JsonValue[];
  replyContext?: JsonObject | null;
  composerPins?: JsonValue[];
  createdAt?: string;
}

export interface CloudMigrationImportedChatSessionInput {
  legacyId: string;
  title: string;
  model: string;
  createdAt?: string;
  updatedAt?: string;
  messages: CloudMigrationImportedChatMessageInput[];
}

export interface CloudMigrationImportedMemoryItemInput {
  legacyId: string;
  kind: string;
  content: string;
  sourceMessageIds?: string[];
  linkedNoteSlug?: string | null;
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CloudMigrationImportedThoughtInput {
  legacyId: string;
  content: string;
  sourceType: string;
  status: string;
  backingNoteSlug?: string | null;
  relatedThoughtIds?: string[];
  extractedEntities?: string[];
  tags?: string[];
  enrichment?: JsonObject | null;
  enrichmentError?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CloudMigrationImportedSourceDocumentInput {
  legacyId: string;
  sourceType: "pdf" | "web" | "text";
  title: string;
  sourcePath?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  sha256?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CloudMigrationImportedAttachmentInput {
  legacyId: string;
  chatSessionLegacyId?: string | null;
  noteLegacyId?: string | null;
  sourceDocumentLegacyId?: string | null;
  bucket: "note-assets" | "source-files" | "exports";
  storagePath: string;
  mimeType?: string | null;
  byteSize?: number | null;
  sha256?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CloudMigrationImportRequest {
  workspaceId?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  importDigest: string;
  importSummary?: JsonObject;
  notes?: CloudMigrationImportedNoteInput[];
  chatSessions?: CloudMigrationImportedChatSessionInput[];
  memoryItems?: CloudMigrationImportedMemoryItemInput[];
  thoughts?: CloudMigrationImportedThoughtInput[];
  sourceDocuments?: CloudMigrationImportedSourceDocumentInput[];
  attachments?: CloudMigrationImportedAttachmentInput[];
}

export interface CloudMigrationImportResponse {
  workspace: CloudWorkspace;
  imported: {
    notes: number;
    chatSessions: number;
    chatMessages: number;
    memoryItems: number;
    thoughts: number;
    sourceDocuments: number;
    attachments: number;
  };
}
