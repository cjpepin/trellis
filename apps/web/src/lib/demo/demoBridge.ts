import type {
  TrellisBridge,
  ChatModel,
  ChatContextPacket,
  MessageRecord,
  ProviderKeyStatusSnapshot,
  QueueSessionExtractionResult,
  SaveNoteInput,
  CreateStubInput,
  DeleteNoteInput,
  BuildChatContextInput,
} from "@trellis/contracts";
import {
  createDemoSession,
  deleteDemoSession,
  getDemoMessages,
  listDemoSessions,
  replaceDemoMessages,
  updateDemoSession,
} from "./localWorkspace";
import {
  createDemoWorkspaceStub,
  deleteDemoWorkspaceNote,
  listDemoWorkspaceIndex,
  readDemoWorkspaceNote,
  writeDemoWorkspaceNote,
} from "./demoWorkspaceStore";

export const TRELLIS_DEMO_BRIDGE_MARK = Symbol.for("trellis.demoBridge");

const demoUnavailable = (feature: string) => (): never => {
  throw new Error(`${feature} is not available in the portfolio demo.`);
};

const emptyProviderKeys: ProviderKeyStatusSnapshot = {
  statuses: [
    { provider: "openai", configured: false, lastFour: null, updatedAt: null },
    { provider: "anthropic", configured: false, lastFour: null, updatedAt: null },
  ],
  secureStorageAvailable: false,
  persistenceMode: "encrypted",
};

export function attachDemoBridgeIfNeeded(): void {
  if (import.meta.env.VITE_DEMO_MODE !== "true") {
    return;
  }

  const globalWindow = window as unknown as {
    trellis?: TrellisBridge & { [TRELLIS_DEMO_BRIDGE_MARK]?: boolean };
  };

  if (globalWindow.trellis?.[TRELLIS_DEMO_BRIDGE_MARK]) {
    return;
  }

  const skippedExtraction: QueueSessionExtractionResult = {
    state: "ineligible",
    job: null,
  };

  const idleExtractionStatus = {
    mode: "local" as const,
    selectedProvider: null,
    providers: [],
  };

  globalWindow.trellis = {
    [TRELLIS_DEMO_BRIDGE_MARK]: true,
    db: {
      listSessions: () => listDemoSessions(),
      getMessages: (sessionId: string) => getDemoMessages(sessionId),
      replaceMessages: (input: { sessionId: string; messages: MessageRecord[] }) =>
        replaceDemoMessages(input),
      createSession: (input: { model: ChatModel; bucketId: string }) => createDemoSession(input),
      updateSession: (payload: Parameters<typeof updateDemoSession>[0]) => updateDemoSession(payload),
      deleteSession: (sessionId: string) => deleteDemoSession(sessionId),
      listThoughts: async () => [],
      getThought: async () => {
        throw new Error("Thoughts are not available in the portfolio demo.");
      },
      createThought: async () => {
        throw new Error("Thoughts are not available in the portfolio demo.");
      },
      retryThoughtEnrichment: async () => undefined,
      getSessionNoteSlugs: async () => [],
      recordWikiOps: async () => undefined,
      listWikiTouchSessions: async () => [],
      getStrandProvenanceForFile: async () => null,
      listStrandRevisions: async () => [],
      getStrandRevisionBody: async () => ({ body: "" }),
    },
    bucket: {
      listIndex: (bucketId: string) => listDemoWorkspaceIndex(bucketId),
      readNote: (slug: string, bucketId: string) => readDemoWorkspaceNote(slug, bucketId),
      writeNote: (input: SaveNoteInput) => writeDemoWorkspaceNote(input),
      createStub: (input: CreateStubInput) => createDemoWorkspaceStub(input),
      deleteNote: (input: DeleteNoteInput) => deleteDemoWorkspaceNote(input),
      createFolder: async () => {
        throw new Error("Folder changes are disabled in the portfolio demo.");
      },
      renameFolder: async () => {
        throw new Error("Folder changes are disabled in the portfolio demo.");
      },
      deleteFolder: async () => {
        throw new Error("Folder changes are disabled in the portfolio demo.");
      },
      selectDirectory: async () => null,
      importFromObsidian: async () => {
        throw new Error("Imports are disabled in the portfolio demo.");
      },
      exportToObsidian: async () => {
        throw new Error("Exports are disabled in the portfolio demo.");
      },
      appendChatImageToNote: async () => {
        throw new Error("Image append is disabled in the portfolio demo.");
      },
      importNoteImage: async () => {
        throw new Error("Image import is disabled in the portfolio demo.");
      },
      readNoteAssetDataUrl: async () => null,
    },
    extraction: {
      getRuntimeStatus: async () => idleExtractionStatus,
      run: demoUnavailable("Extraction"),
      queueSession: async () => skippedExtraction,
      installLocalModel: async () => idleExtractionStatus,
      cancelInstallLocalModel: async () => undefined,
      onInstallProgress: () => () => undefined,
      removeLocalModel: async () => idleExtractionStatus,
      listDebugRuns: async () => [],
      onJobUpdate: () => () => undefined,
    },
    chat: {
      pickAttachment: async () => null,
      buildContext: async (input: BuildChatContextInput): Promise<ChatContextPacket> => ({
        mode: input.mode,
        references: [],
        sourceLabels: [],
      }),
      storeMemory: async () => [],
      proposeNoteActions: async () => ({ actions: [], clarification: null }),
      applyBucketOrganize: async () => ({ applied: false, message: "Not available in demo." }),
      runLocalReply: demoUnavailable("Local chat"),
      streamLocal: async () => undefined,
      stream: async () => undefined,
      getProviderKeyStatus: async () => emptyProviderKeys,
      setProviderKey: async () => emptyProviderKeys,
      deleteProviderKey: async () => emptyProviderKeys,
    },
    media: {
      writeCache: demoUnavailable("Media cache"),
      readDataUrl: async () => null,
      pickImage: async () => null,
      transcribe: demoUnavailable("Speech-to-text"),
      synthesizeSpeech: demoUnavailable("Read aloud"),
      synthesizeSpeechStream: async () => undefined,
      cancelSynthesizeSpeechStream: async () => undefined,
      generateImage: demoUnavailable("Image generation"),
    },
  } as unknown as TrellisBridge;
}

export function isDemoBridge(bridge: TrellisBridge | undefined): boolean {
  if (!bridge) return false;
  return (bridge as TrellisBridge & { [TRELLIS_DEMO_BRIDGE_MARK]?: boolean })[TRELLIS_DEMO_BRIDGE_MARK] === true;
}
