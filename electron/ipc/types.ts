import type {
  ExtractionResponse,
  ExtractionContextNote,
  ExtractionIndexEntry,
  ExtractionNoteType,
  ExtractionOperation,
  ExtractionSourceType
} from "@shared/extraction/contracts";
import type { ExtractionInstallProgressEvent } from "@shared/extraction/localModelInstall";

export type { ExtractionInstallProgressEvent };

export const ipcChannels = {
  appBootstrap: "app:get:bootstrap",
  settingsGet: "settings:get:app",
  settingsSet: "settings:set:app",
  workspaceGet: "workspace:get:current",
  workspaceList: "workspace:list",
  workspaceSwitch: "workspace:switch",
  workspaceResetPreview: "workspace:reset:preview",
  authGet: "auth:get:session",
  authSet: "auth:set:session",
  authClear: "auth:clear:session",
  dbListSessions: "db:list:sessions",
  dbCreateSession: "db:create:session",
  dbGetMessages: "db:get:messages",
  dbAppendMessages: "db:append:messages",
  dbReplaceMessages: "db:replace:messages",
  dbUpdateSession: "db:update:session",
  dbRecordWikiOps: "db:record:wiki-ops",
  extractionGetRuntimeStatus: "extraction:get:runtime-status",
  extractionRun: "extraction:run",
  extractionQueueSession: "extraction:queue:session",
  extractionInstallLocalModel: "extraction:install:local-model",
  extractionCancelInstallLocalModel: "extraction:install:local-model:cancel",
  extractionInstallProgress: "extraction:install:progress",
  extractionRemoveLocalModel: "extraction:remove:local-model",
  extractionListDebugRuns: "extraction:list:debug-runs",
  extractionJobUpdated: "extraction:job:updated",
  vaultListIndex: "vault:list:index",
  vaultReadNote: "vault:read:note",
  vaultWriteNote: "vault:write:note",
  vaultCreateStub: "vault:create:stub",
  vaultDeleteNote: "vault:delete:note",
  vaultCreateFolder: "vault:create:folder",
  vaultRenameFolder: "vault:rename:folder",
  vaultDeleteFolder: "vault:delete:folder",
  vaultSelectDirectory: "vault:select:directory",
  retrievalSearchNotes: "retrieval:search:notes",
  retrievalRebuildIndex: "retrieval:rebuild:index",
  ingestParsePdf: "ingest:parse:pdf",
  ingestClipUrl: "ingest:clip:url",
  chatPickAttachment: "chat:pick:attachment",
  shellOpenPath: "shell:open:path",
  shellOpenExternal: "shell:open:external"
} as const;

export const chatModelIds = [
  "gpt-4.1-nano",
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4o",
  "claude-3-5-haiku-latest",
  "claude-3-7-sonnet-latest",
  "claude-sonnet-4-20250514"
] as const;

export type ChatModel = (typeof chatModelIds)[number];
export type ChatProvider = "openai" | "anthropic";
export type ChatModelTier = "cheap" | "premium";
export type ExtractionMode = "auto" | "cloud" | "local";
export type ExtractionProviderId = "cloud" | "embedded";
export type ExtractionJobStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type ExtractionJobTrigger = "idle" | "session-switch" | "manual" | "startup";
export type ExtractionDebugStatus = "queued" | "running" | "completed" | "failed" | "skipped";
export type ExtractionDebugScope = "job" | "direct";
export type AppWorkspaceId = "personal" | "preview";

const legacyChatModelMap = {
  "claude-sonnet-4": "claude-sonnet-4-20250514",
  "ollama-local-stub": "gpt-4.1-mini"
} as const satisfies Record<string, ChatModel>;

export const defaultChatModel: ChatModel = "gpt-4.1-mini";
export type MessageRole = "user" | "assistant";
export type NoteType = ExtractionNoteType;
export type IngestSourceType = ExtractionSourceType;
export type ThemeName =
  | "dark"
  | "light"
  | "nature-dark"
  | "nature-light"
  | "ocean-dark"
  | "ocean-light"
  | "high-contrast";

export function isChatModel(value: string): value is ChatModel {
  return (chatModelIds as readonly string[]).includes(value);
}

export function normalizeChatModel(value: string | null | undefined): ChatModel {
  if (!value) {
    return defaultChatModel;
  }

  if (isChatModel(value)) {
    return value;
  }

  return legacyChatModelMap[value as keyof typeof legacyChatModelMap] ?? defaultChatModel;
}

export interface VaultDefinition {
  id: string;
  name: string;
  path: string;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: ChatModel;
  messageCount: number;
  vaultId: string;
}

/** Text clipped from a file or public URL, sent to the model and extraction as context. */
export interface ChatAttachment {
  kind: "file" | "url";
  label: string;
  text: string;
  sourceUrl?: string;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  tokens: number | null;
  attachments?: ChatAttachment[];
}

export interface ChatAttachmentPickResult {
  name: string;
  text: string;
}

export interface NoteFrontmatter {
  title: string;
  created: string;
  updated: string;
  sources: number;
  tags: string[];
  type: NoteType;
  url?: string;
}

export interface NoteSummary {
  slug: string;
  title: string;
  updated: string;
  tags: string[];
  type: NoteType;
  excerpt: string;
  inboundCount: number;
  folderPath: string;
  relativePath: string;
}

export interface WikiNote extends NoteSummary {
  content: string;
  links: string[];
  sources: number;
}

export interface FolderSummary {
  path: string;
  name: string;
  noteCount: number;
}

export interface GraphNode {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  type: NoteType;
  size: number;
  inboundCount: number;
  cluster?: string;
  isPlaceholder?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VaultSnapshot {
  vaultId: string;
  vaultName: string;
  vaultPath: string;
  notes: NoteSummary[];
  folders: FolderSummary[];
  graph: GraphData;
}

export interface SaveNoteInput {
  vaultId?: string;
  slug?: string;
  relativePath?: string;
  folderPath?: string | null;
  title: string;
  content: string;
  frontmatter?: Partial<NoteFrontmatter>;
}

export interface SaveNoteResult {
  note: WikiNote;
  graph: GraphData;
}

export interface CreateStubInput {
  title: string;
  folderPath?: string | null;
  vaultId?: string;
}

export interface DeleteNoteInput {
  slug: string;
  relativePath?: string;
  vaultId?: string;
}

export interface CreateFolderInput {
  name: string;
  parentPath?: string | null;
  vaultId?: string;
}

export interface RenameFolderInput {
  path: string;
  name: string;
  parentPath?: string | null;
  vaultId?: string;
}

export interface DeleteFolderInput {
  path: string;
  vaultId?: string;
}

export interface RecordWikiOpInput {
  sessionId?: string;
  file: string;
  action: Exclude<ExtractionOperation, "noop">;
}

export interface IngestedDraft {
  title: string;
  content: string;
  sourcePath: string;
  sourceType: IngestSourceType;
}

export interface RetrievalSearchInput {
  query: string;
  explicitSlugs?: string[];
  vaultId?: string;
  limit?: number;
}

export interface ExtractionCloudConfig {
  functionsBaseUrl: string;
  publishableKey: string;
  accessToken?: string | null;
}

export interface LocalExtractionModelInfo {
  id: string;
  label: string;
  runtime: "embedded";
  purpose: "extraction" | "embedding";
  installed: boolean;
  available: boolean;
  recommended: boolean;
  sizeBytes?: number;
  variant?: string;
  parameterSize?: string;
}

export interface ExtractionProviderStatus {
  id: ExtractionProviderId;
  label: string;
  available: boolean;
  reason?: string;
  selectedModel?: string | null;
  models?: LocalExtractionModelInfo[];
}

export interface ExtractionRuntimeStatus {
  mode: ExtractionMode;
  selectedProvider: ExtractionProviderId | null;
  providers: ExtractionProviderStatus[];
}

export interface ExtractionRunInput {
  mode?: ExtractionMode;
  cloud?: ExtractionCloudConfig;
  sessionId?: string;
  transcript: Array<Pick<MessageRecord, "role" | "content">>;
  index: ExtractionIndexEntry[];
  relatedNotes?: ExtractionContextNote[];
  sourceType?: ExtractionSourceType;
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
  preferredLocalModelId?: string;
}

export interface ExtractionRunResult {
  response: ExtractionResponse;
  provider: ExtractionProviderId;
  model: string | null;
}

export interface QueueSessionExtractionInput {
  sessionId: string;
  trigger?: ExtractionJobTrigger;
  mode?: ExtractionMode;
  cloud?: ExtractionCloudConfig;
  preferredLocalModelId?: string;
  force?: boolean;
}

export interface ExtractionJobSnapshot {
  id: string;
  sessionId: string;
  vaultId: string;
  status: ExtractionJobStatus;
  trigger: ExtractionJobTrigger;
  mode: ExtractionMode;
  provider: ExtractionProviderId | null;
  model: string | null;
  transcriptStartIndex: number;
  transcriptEndIndex: number;
  transcriptDigest: string;
  attemptCount: number;
  appliedUpdateCount: number;
  sessionTitle: string | null;
  errorMessage: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface QueueSessionExtractionResult {
  state: "queued" | "duplicate" | "ineligible";
  job: ExtractionJobSnapshot | null;
}

export type ExtractionJobNotification = ExtractionJobSnapshot;

export interface ExtractionDebugProviderAttempt {
  id: ExtractionProviderId;
  outcome: "unavailable" | "failed" | "success";
  reason?: string;
  durationMs?: number;
}

export interface ExtractionDebugRun {
  id: string;
  scope: ExtractionDebugScope;
  status: ExtractionDebugStatus;
  mode: ExtractionMode;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  jobId: string | null;
  sessionId: string | null;
  vaultId: string | null;
  trigger: ExtractionJobTrigger | null;
  transcriptMessageCount: number;
  transcriptStartIndex: number | null;
  transcriptEndIndex: number | null;
  relatedNoteCount: number | null;
  requestedUpdateCount: number | null;
  appliedUpdateCount: number | null;
  guardrailDropCount: number | null;
  requestedProviderOrder: ExtractionProviderId[];
  attemptedProviders: ExtractionDebugProviderAttempt[];
  selectedProvider: ExtractionProviderId | null;
  model: string | null;
  validationIssues: string[];
  errorMessage: string | null;
}

export interface ExtractionSettings {
  mode: ExtractionMode;
  preferredLocalModelId: string | null;
}

export interface AppFeatureFlags {
  localExtraction: boolean;
}

export interface WorkspaceInfo {
  id: AppWorkspaceId;
  label: string;
  description: string;
  localOnly: boolean;
  canReset: boolean;
  isPreview: boolean;
  seedVersion: string | null;
}

export interface RetrievalRebuildResult {
  vaultId: string;
  notesIndexed: number;
  chunkCount: number;
  embeddingModel: string | null;
  usedEmbeddings: boolean;
}

export interface ParsePdfInput {
  fileName: string;
  bytes: number[];
}

export interface ClipUrlInput {
  url: string;
}

export interface AppSettings {
  vaults: VaultDefinition[];
  activeVaultId: string;
  theme: ThemeName;
  rememberSession: boolean;
  extraction: ExtractionSettings;
}

export interface AuthSessionSnapshot {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
  user: {
    id: string;
    email?: string | null;
  };
}

export interface AppBootstrap {
  settings: AppSettings;
  features: AppFeatureFlags;
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  needsWorkspaceChoice: boolean;
  authSession: AuthSessionSnapshot | null;
  sessions: ChatSessionSummary[];
  notes: NoteSummary[];
  folders: FolderSummary[];
  graph: GraphData;
}

export interface SwitchWorkspaceInput {
  workspaceId: AppWorkspaceId;
  completeSelection?: boolean;
}

export interface DatabaseBridge {
  listSessions: () => Promise<ChatSessionSummary[]>;
  createSession: (payload: { model: ChatModel; vaultId: string }) => Promise<ChatSessionSummary>;
  getMessages: (sessionId: string) => Promise<MessageRecord[]>;
  appendMessages: (messages: MessageRecord[]) => Promise<void>;
  replaceMessages: (payload: { sessionId: string; messages: MessageRecord[] }) => Promise<void>;
  updateSession: (payload: Partial<ChatSessionSummary> & { id: string }) => Promise<ChatSessionSummary>;
  recordWikiOps: (ops: RecordWikiOpInput[]) => Promise<void>;
}

export interface VaultBridge {
  listIndex: (vaultId?: string) => Promise<VaultSnapshot>;
  readNote: (slug: string, vaultId?: string) => Promise<WikiNote>;
  writeNote: (input: SaveNoteInput) => Promise<SaveNoteResult>;
  createStub: (input: CreateStubInput) => Promise<SaveNoteResult>;
  deleteNote: (input: DeleteNoteInput) => Promise<VaultSnapshot>;
  createFolder: (input: CreateFolderInput) => Promise<VaultSnapshot>;
  renameFolder: (input: RenameFolderInput) => Promise<VaultSnapshot>;
  deleteFolder: (input: DeleteFolderInput) => Promise<VaultSnapshot>;
  selectDirectory: () => Promise<string | null>;
}

export interface IngestBridge {
  parsePdf: (input: ParsePdfInput) => Promise<IngestedDraft>;
  clipUrl: (input: ClipUrlInput) => Promise<IngestedDraft>;
}

export interface RetrievalBridge {
  searchNotes: (input: RetrievalSearchInput) => Promise<ExtractionContextNote[]>;
  rebuildIndex: (vaultId?: string) => Promise<RetrievalRebuildResult>;
}

export interface ExtractionBridge {
  getRuntimeStatus: (input?: {
    mode?: ExtractionMode;
    cloud?: ExtractionCloudConfig;
  }) => Promise<ExtractionRuntimeStatus>;
  run: (input: ExtractionRunInput) => Promise<ExtractionRunResult>;
  queueSession: (input: QueueSessionExtractionInput) => Promise<QueueSessionExtractionResult>;
  installLocalModel: (modelId: string) => Promise<ExtractionRuntimeStatus>;
  cancelInstallLocalModel: () => Promise<void>;
  onInstallProgress: (
    listener: (event: ExtractionInstallProgressEvent) => void
  ) => () => void;
  removeLocalModel: (modelId: string) => Promise<ExtractionRuntimeStatus>;
  listDebugRuns: (limit?: number) => Promise<ExtractionDebugRun[]>;
  onJobUpdate: (listener: (notification: ExtractionJobNotification) => void) => () => void;
}

export interface ChatBridge {
  /** Opens a file dialog and returns extracted text (UTF-8 or PDF). */
  pickAttachment: () => Promise<ChatAttachmentPickResult | null>;
}

export interface AppBridge {
  bootstrap: () => Promise<AppBootstrap>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: AppSettings) => Promise<AppSettings>;
  getWorkspace: () => Promise<WorkspaceInfo>;
  listWorkspaces: () => Promise<WorkspaceInfo[]>;
  switchWorkspace: (input: SwitchWorkspaceInput) => Promise<AppBootstrap>;
  resetPreviewWorkspace: () => Promise<AppBootstrap>;
}

export interface AuthBridge {
  getSession: () => Promise<AuthSessionSnapshot | null>;
  setSession: (session: AuthSessionSnapshot) => Promise<void>;
  clearSession: () => Promise<void>;
}

export interface ShellBridge {
  openPath: (targetPath: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
}

export interface TrellisBridge {
  app: AppBridge;
  auth: AuthBridge;
  db: DatabaseBridge;
  extraction: ExtractionBridge;
  vault: VaultBridge;
  retrieval: RetrievalBridge;
  ingest: IngestBridge;
  chat: ChatBridge;
  shell: ShellBridge;
}
