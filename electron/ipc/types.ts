export const ipcChannels = {
  appBootstrap: "app:get:bootstrap",
  settingsGet: "settings:get:app",
  settingsSet: "settings:set:app",
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
  vaultListIndex: "vault:list:index",
  vaultReadNote: "vault:read:note",
  vaultWriteNote: "vault:write:note",
  vaultCreateStub: "vault:create:stub",
  vaultSelectDirectory: "vault:select:directory",
  ingestParsePdf: "ingest:parse:pdf",
  ingestClipUrl: "ingest:clip:url",
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

const legacyChatModelMap = {
  "claude-sonnet-4": "claude-sonnet-4-20250514",
  "ollama-local-stub": "gpt-4.1-mini"
} as const satisfies Record<string, ChatModel>;

export const defaultChatModel: ChatModel = "gpt-4.1-mini";
export type MessageRole = "user" | "assistant";
export type NoteType = "concept" | "entity" | "source-summary" | "synthesis";
export type IngestSourceType = "pdf" | "web" | "text";
export type ThemeName = "dark" | "light" | "nature" | "high-contrast";

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

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  tokens: number | null;
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
}

export interface WikiNote extends NoteSummary {
  content: string;
  links: string[];
  sources: number;
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
  graph: GraphData;
}

export interface SaveNoteInput {
  vaultId?: string;
  slug?: string;
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
  vaultId?: string;
}

export interface RecordWikiOpInput {
  sessionId?: string;
  file: string;
  action: "create" | "update" | "append";
}

export interface IngestedDraft {
  title: string;
  content: string;
  sourcePath: string;
  sourceType: IngestSourceType;
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
  authSession: AuthSessionSnapshot | null;
  sessions: ChatSessionSummary[];
  notes: NoteSummary[];
  graph: GraphData;
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
  selectDirectory: () => Promise<string | null>;
}

export interface IngestBridge {
  parsePdf: (input: ParsePdfInput) => Promise<IngestedDraft>;
  clipUrl: (input: ClipUrlInput) => Promise<IngestedDraft>;
}

export interface AppBridge {
  bootstrap: () => Promise<AppBootstrap>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: AppSettings) => Promise<AppSettings>;
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
  vault: VaultBridge;
  ingest: IngestBridge;
  shell: ShellBridge;
}
