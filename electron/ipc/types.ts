import type {
  ExtractionResponse,
  ExtractionContextNote,
  ExtractionIndexEntry,
  ExtractionNoteType,
  ExtractionOperation,
  ExtractionSourceType
} from "@shared/extraction/contracts";
import type { ExtractionInstallProgressEvent } from "@shared/extraction/localModelInstall";
import type { ReadAloudSpeedTier } from "@shared/media/readAloudSpeed";

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
  vaultImportFromObsidian: "vault:import:obsidian",
  vaultExportToObsidian: "vault:export:obsidian",
  vaultAppendChatImage: "vault:append:chat-image",
  vaultImportNoteImage: "vault:import-note-image",
  vaultReadNoteAssetDataUrl: "vault:read-note-asset-data-url",
  retrievalSearchNotes: "retrieval:search:notes",
  retrievalRebuildIndex: "retrieval:rebuild:index",
  ingestParsePdf: "ingest:parse:pdf",
  ingestClipUrl: "ingest:clip:url",
  chatPickAttachment: "chat:pick:attachment",
  chatBuildContext: "chat:build:context",
  chatStoreMemory: "chat:store:memory",
  chatProposeNoteActions: "chat:propose-note-actions",
  chatApplyTemplateInstance: "chat:apply-template-instance",
  chatApplyVaultOrganize: "chat:apply-vault-organize",
  chatRunLocalReply: "chat:run:local-reply",
  chatStream: "chat:stream",
  chatStreamEvent: "chat:stream:event",
  providerKeysGet: "provider-keys:get",
  providerKeysSet: "provider-keys:set",
  providerKeysDelete: "provider-keys:delete",
  billingCreateCheckoutSession: "billing:create:checkout-session",
  shellOpenPath: "shell:open:path",
  shellOpenExternal: "shell:open:external",
  mediaCacheWrite: "media:cache:write",
  mediaCacheReadDataUrl: "media:cache:read-data-url",
  mediaPickImage: "media:pick:image",
  mediaTranscribe: "media:transcribe",
  mediaSynthesizeSpeech: "media:synthesize-speech",
  mediaSynthesizeSpeechStream: "media:synthesize-speech-stream",
  mediaSynthesizeSpeechStreamCancel: "media:synthesize-speech-stream:cancel",
  mediaSpeechStreamChunk: "media:speech-stream:chunk",
  mediaGenerateImage: "media:generate-image"
} as const;

export const chatModelIds = [
  "gpt-4.1-nano",
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-4.1",
  "gpt-4o",
  "gpt-5.4",
  "claude-3-5-haiku-latest",
  "claude-haiku-4-5",
  "claude-3-7-sonnet-latest",
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-6",
  "claude-opus-4-6"
] as const;

export type ChatModel = (typeof chatModelIds)[number];
export type ChatProvider = "openai" | "anthropic";
export type ChatModelTier = "cheap" | "premium";
export type SubscriptionTier = "trial" | "byok" | "pro";
export type CheckoutPlanCode = Exclude<SubscriptionTier, "trial">;
export type ProviderKeyPersistenceMode = "encrypted" | "session";
export type ChatBillingMode = "hosted" | "byok";
export type ChatPrivacyMode = "auto" | "off" | "local";
export type ChatContextReferenceType = "note" | "memory";
export type MemoryKind = "preference" | "project" | "open_loop" | "fact" | "task";
export type ExtractionMode = "local";
export type ExtractionProviderId = "embedded";
export type ExtractionJobStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type ExtractionJobTrigger = "idle" | "session-switch" | "manual" | "startup";
export type ExtractionDebugStatus = "queued" | "running" | "completed" | "failed" | "skipped";
export type ExtractionDebugScope = "job" | "direct";
export type AppWorkspaceId = "personal" | "preview" | "preview-heavy";

export function isAppPreviewWorkspace(workspaceId: AppWorkspaceId): boolean {
  return workspaceId === "preview" || workspaceId === "preview-heavy";
}

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
  | "high-contrast"
  | "twilight"
  | "dawn"
  | "graphite"
  | "cream"
  | "ember"
  | "fog";

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

/** Binary media stored under app userData (not the vault). */
export type ChatMediaArtifactKind = "image" | "generated_image";

export interface ChatMediaArtifact {
  kind: ChatMediaArtifactKind;
  /** Stable id matching a file under the Trellis media cache directory. */
  fileId: string;
  mimeType: string;
  label: string;
  /** Set for generated images. */
  prompt?: string;
  /** Inline image generation in progress; no cache file for `fileId` yet. */
  pendingGeneration?: boolean;
}

export type ChatNoteActionKind =
  | "create_note"
  | "update_note"
  | "create_template"
  | "update_template";

export type ChatNoteActionStatus = "pending" | "approved" | "rejected" | "failed";

export interface ChatNoteActionProposal {
  id: string;
  kind: ChatNoteActionKind;
  status: ChatNoteActionStatus;
  targetTitle: string;
  targetSlug: string;
  targetFolderPath: string;
  beforeMarkdown: string;
  afterMarkdown: string;
  frontmatter: Partial<NoteFrontmatter>;
  rationale: string;
  sourceMessageIds: string[];
  createdAt: number;
  appliedAt?: number;
  errorMessage?: string;
}

export type ChatTemplateInstanceStatus = "active" | "completed" | "failed";

export interface ChatTemplateInstanceState {
  templateSlug: string;
  templateTitle: string;
  instanceSlug: string;
  instanceTitle: string;
  status: ChatTemplateInstanceStatus;
  sourceUserMessageIds: string[];
  answerUserMessageIds: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  tokens: number | null;
  attachments?: ChatAttachment[];
  mediaArtifacts?: ChatMediaArtifact[];
  noteActions?: ChatNoteActionProposal[];
  templateInstance?: ChatTemplateInstanceState;
}

export interface ChatAttachmentPickResult {
  name: string;
  text: string;
}

export interface ChatReference extends ChatContextReference {}

export interface ChatContextReference {
  type: ChatContextReferenceType;
  title: string;
  excerpt: string;
  content: string;
  tags?: string[];
  slug?: string;
  linkedNoteSlug?: string | null;
  isExplicitMatch?: boolean;
}

export interface ChatContextPacket {
  mode: ChatPrivacyMode;
  references: ChatContextReference[];
  sourceLabels: string[];
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
  url?: string;
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
  /** 0–1: tag overlap and mutual links; drives link distance/strength in the graph view. */
  association?: number;
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

/** Default wiki note slug for saving generated chat images when the user does not pick a specific note. */
export const TRELLIS_DEFAULT_CHAT_IMAGE_NOTE_SLUG = "trellis-captures";

/** Appends a chat media cache image into a wiki note as markdown. Uses {@link TRELLIS_DEFAULT_CHAT_IMAGE_NOTE_SLUG} when `slug` is omitted. */
export interface VaultAppendChatImageInput {
  vaultId?: string;
  fileId: string;
  slug?: string;
  alt?: string;
}

export interface VaultImportNoteImageInput {
  vaultId?: string;
  fileId: string;
  noteRelativePath: string;
  alt?: string;
}

export interface VaultImportNoteImageResult {
  markdownPath: string;
  alt: string;
}

export interface VaultReadNoteAssetDataUrlInput {
  vaultId?: string;
  noteRelativePath: string;
  assetPath: string;
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

export interface SelectDirectoryInput {
  title?: string;
  buttonLabel?: string;
}

export interface ImportFromObsidianInput {
  sourcePath: string;
  vaultId?: string;
}

export interface ImportFromObsidianResult {
  sourcePath: string;
  targetPath: string;
  targetFolder: string;
  importedNoteCount: number;
  folderCount: number;
}

export interface ExportToObsidianInput {
  targetPath: string;
  vaultId?: string;
}

export interface ExportToObsidianResult {
  targetPath: string;
  exportRootPath: string;
  exportedNoteCount: number;
  folderCount: number;
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

export interface MemoryItem {
  id: string;
  vaultId: string;
  kind: MemoryKind;
  content: string;
  sourceMessageIds: string[];
  linkedNoteSlug: string | null;
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

export interface BuildChatContextInput {
  mode: ChatPrivacyMode;
  vaultId?: string;
  activeNoteSlug?: string | null;
  sessionTitle?: string | null;
  /** When set, excluded from “recent sessions” summaries so the current chat isn’t counted as “past”. */
  currentSessionId?: string | null;
  messages: Array<Pick<MessageRecord, "role" | "content">>;
}

export interface StoreChatMemoryInput {
  vaultId?: string;
  sessionId?: string;
  messages: Array<Pick<MessageRecord, "id" | "role" | "content">>;
  references?: ChatContextReference[];
}

export interface ProposeChatNoteActionsInput {
  mode: ChatPrivacyMode;
  phase?: "pre_response" | "post_response";
  vaultId?: string;
  activeNoteSlug?: string | null;
  messages: Array<Pick<MessageRecord, "id" | "role" | "content" | "attachments" | "mediaArtifacts" | "noteActions">>;
}

export interface ProposeChatNoteActionsResult {
  actions: ChatNoteActionProposal[];
  clarification: string | null;
}

export interface ApplyChatTemplateInstanceInput {
  vaultId?: string;
  sessionId: string;
  userMessageId: string;
  messages: Array<Pick<MessageRecord, "id" | "role" | "content" | "templateInstance">>;
}

export interface ApplyChatTemplateInstanceResult {
  applied: boolean;
  action: "created" | "updated" | "completed" | "none";
  state: ChatTemplateInstanceState | null;
  note?: {
    slug: string;
    title: string;
  };
  message: string | null;
}

export interface ApplyVaultOrganizeInput {
  vaultId: string;
  userMessage: string;
}

/** Shown in toasts as links to the Notes shell */
export interface ToastNoteLink {
  label: string;
  noteSlug: string;
}

export interface ApplyVaultOrganizeResult {
  applied: boolean;
  message: string | null;
  /** Set when at least one note was moved into a new folder */
  movedNote?: { slug: string; title: string };
}

export interface LocalChatRunInput {
  model: ChatModel;
  messages: Array<Pick<MessageRecord, "role" | "content">>;
  references?: ChatContextReference[];
}

export interface LocalChatRunResult {
  text: string;
  sessionTitle: string;
  tokenCount: number;
  provider: "embedded";
  model: string | null;
}

export interface ProviderKeyStatus {
  provider: ChatProvider;
  configured: boolean;
  lastFour: string | null;
  updatedAt: number | null;
}

export interface ProviderKeyStatusSnapshot {
  statuses: ProviderKeyStatus[];
  secureStorageAvailable: boolean;
  persistenceMode: ProviderKeyPersistenceMode;
}

export interface SetProviderKeyInput {
  provider: ChatProvider;
  apiKey: string;
}

export interface DeleteProviderKeyInput {
  provider: ChatProvider;
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
  /**
   * Present on completion notifications from the main process (not persisted in SQLite).
   * Slugs/titles of notes that were written during this job.
   */
  appliedNotes?: Array<{ slug: string; title: string }>;
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

export interface ChatSettings {
  privacyMode: ChatPrivacyMode;
  /** When true, assistant replies are read aloud automatically after streaming. Default false. */
  readAloudAutoPlay?: boolean;
  /**
   * OpenAI TTS speed tier for read-aloud (1–5: slowest … fastest; default tier 3 Medium).
   */
  readAloudSpeed?: ReadAloudSpeedTier;
  /**
   * When true (default), the chat view scrolls with streaming replies while you stay near the bottom;
   * scrolling up pauses following until you scroll back down.
   */
  scrollWithResponse?: boolean;
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
  chat: ChatSettings;
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
  providerKeys: ProviderKeyStatusSnapshot;
  needsWorkspaceChoice: boolean;
  authSession: AuthSessionSnapshot | null;
  sessions: ChatSessionSummary[];
  notes: NoteSummary[];
  folders: FolderSummary[];
  graph: GraphData;
}

/** One turn for the chat edge function; `imageFileIds` resolved to base64 in the main process. */
export interface ChatStreamPayloadMessage {
  role: MessageRole;
  content: string;
  imageFileIds?: string[];
}

export interface ChatStreamRequest {
  requestId: string;
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  model: ChatModel;
  sessionId: string;
  messages: ChatStreamPayloadMessage[];
  references?: ChatReference[];
  /** When true, main process also treats the request as preview (redundant with workspace id). */
  previewWorkspace?: boolean;
}

export interface ChatStreamEvent {
  requestId: string;
  type: "status" | "token" | "title" | "done";
  payload: string;
}

export interface ChatStreamInput {
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  model: ChatModel;
  sessionId: string;
  messages: ChatStreamPayloadMessage[];
  references?: ChatReference[];
  /** Seeded preview workspace: must not consume trial message allowance. */
  previewWorkspace?: boolean;
  onToken: (token: string) => void;
  onStatus: (message: string) => void | Promise<void>;
  onTitle: (title: string) => void | Promise<void>;
}

export interface CreateCheckoutSessionInput {
  accessToken: string;
  plan: CheckoutPlanCode;
}

export interface CreateCheckoutSessionResult {
  url: string;
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
  appendChatImageToNote: (input: VaultAppendChatImageInput) => Promise<SaveNoteResult>;
  importNoteImage: (input: VaultImportNoteImageInput) => Promise<VaultImportNoteImageResult>;
  readNoteAssetDataUrl: (input: VaultReadNoteAssetDataUrlInput) => Promise<string | null>;
  createStub: (input: CreateStubInput) => Promise<SaveNoteResult>;
  deleteNote: (input: DeleteNoteInput) => Promise<VaultSnapshot>;
  createFolder: (input: CreateFolderInput) => Promise<VaultSnapshot>;
  renameFolder: (input: RenameFolderInput) => Promise<VaultSnapshot>;
  deleteFolder: (input: DeleteFolderInput) => Promise<VaultSnapshot>;
  selectDirectory: (input?: SelectDirectoryInput) => Promise<string | null>;
  importFromObsidian: (input: ImportFromObsidianInput) => Promise<ImportFromObsidianResult>;
  exportToObsidian: (input: ExportToObsidianInput) => Promise<ExportToObsidianResult>;
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
  getRuntimeStatus: (input?: { mode?: ExtractionMode }) => Promise<ExtractionRuntimeStatus>;
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
  buildContext: (input: BuildChatContextInput) => Promise<ChatContextPacket>;
  storeMemory: (input: StoreChatMemoryInput) => Promise<MemoryItem[]>;
  proposeNoteActions: (input: ProposeChatNoteActionsInput) => Promise<ProposeChatNoteActionsResult>;
  applyTemplateInstance: (input: ApplyChatTemplateInstanceInput) => Promise<ApplyChatTemplateInstanceResult>;
  applyVaultOrganize: (input: ApplyVaultOrganizeInput) => Promise<ApplyVaultOrganizeResult>;
  runLocalReply: (input: LocalChatRunInput) => Promise<LocalChatRunResult>;
  stream: (input: ChatStreamInput) => Promise<void>;
  getProviderKeyStatus: () => Promise<ProviderKeyStatusSnapshot>;
  setProviderKey: (input: SetProviderKeyInput) => Promise<ProviderKeyStatusSnapshot>;
  deleteProviderKey: (input: DeleteProviderKeyInput) => Promise<ProviderKeyStatusSnapshot>;
}

export interface MediaCacheWriteInput {
  base64: string;
  mimeType: string;
}

export interface MediaCacheWriteResult {
  fileId: string;
}

export interface MediaPickImageResult {
  fileId: string;
  name: string;
  mimeType: string;
}

export interface MediaTranscribeInput {
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  audioBase64: string;
  mimeType: string;
}

export interface MediaTranscribeResult {
  text: string;
}

export interface MediaSpeechInput {
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  text: string;
  readAloudSpeed: ReadAloudSpeedTier;
}

export interface MediaSpeechResult {
  audioBase64: string;
  mimeType: string;
}

export interface MediaImageGenerateInput {
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  prompt: string;
}

export interface MediaImageGenerateResult {
  imageBase64: string;
  revisedPrompt?: string;
}

export interface MediaBridge {
  writeCache: (input: MediaCacheWriteInput) => Promise<MediaCacheWriteResult>;
  readDataUrl: (fileId: string) => Promise<string | null>;
  pickImage: () => Promise<MediaPickImageResult | null>;
  transcribe: (input: MediaTranscribeInput) => Promise<MediaTranscribeResult>;
  synthesizeSpeech: (input: MediaSpeechInput) => Promise<MediaSpeechResult>;
  /**
   * Streams PCM chunks from the edge TTS proxy (24 kHz mono s16le). Same input billing as
   * `synthesizeSpeech`; resolves when the stream completes.
   */
  synthesizeSpeechStream: (
    input: MediaSpeechInput,
    onChunk: (chunk: Uint8Array) => void
  ) => Promise<void>;
  /** Aborts the in-flight speech stream fetch (no-op if none). */
  cancelSynthesizeSpeechStream: () => Promise<void>;
  generateImage: (input: MediaImageGenerateInput) => Promise<MediaImageGenerateResult>;
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

export interface BillingBridge {
  createCheckoutSession: (input: CreateCheckoutSessionInput) => Promise<CreateCheckoutSessionResult>;
}

export interface ShellBridge {
  openPath: (targetPath: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
}

export interface TrellisBridge {
  app: AppBridge;
  auth: AuthBridge;
  billing: BillingBridge;
  db: DatabaseBridge;
  extraction: ExtractionBridge;
  vault: VaultBridge;
  retrieval: RetrievalBridge;
  ingest: IngestBridge;
  chat: ChatBridge;
  media: MediaBridge;
  shell: ShellBridge;
}
