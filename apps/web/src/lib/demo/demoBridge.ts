import type { TrellisBridge, ChatModel, MessageRecord } from "@trellis/contracts";
import {
  createDemoSession,
  deleteDemoSession,
  getDemoMessages,
  listDemoSessions,
  replaceDemoMessages,
  updateDemoSession,
} from "./localWorkspace";
import { listDemoVaultIndex, readDemoVaultNote } from "./demoVault";

export const TRELLIS_DEMO_BRIDGE_MARK = Symbol.for("trellis.demoBridge");

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
      getStrandRevisionBody: async () => ({ body: "" }),
    },
    bucket: {
      listIndex: (bucketId: string) => listDemoVaultIndex(bucketId),
      readNote: (slug: string, bucketId: string) => readDemoVaultNote(slug, bucketId),
      writeNote: async () => {
        throw new Error("Note editing is read-only in the portfolio demo.");
      },
      createStub: async () => {
        throw new Error("Creating notes is disabled in the portfolio demo.");
      },
      deleteNote: async () => {
        throw new Error("Deleting notes is disabled in the portfolio demo.");
      },
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
  } as unknown as TrellisBridge;
}

export function isDemoBridge(bridge: TrellisBridge | undefined): boolean {
  if (!bridge) return false;
  return (bridge as TrellisBridge & { [TRELLIS_DEMO_BRIDGE_MARK]?: boolean })[TRELLIS_DEMO_BRIDGE_MARK] === true;
}
