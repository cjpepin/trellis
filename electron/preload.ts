import { contextBridge, ipcRenderer } from "electron";
import {
  ipcChannels,
  type AppBootstrap,
  type AppSettings,
  type AuthSessionSnapshot,
  type ChatModel,
  type CreateStubInput,
  type MessageRecord,
  type TrellisBridge,
  type ParsePdfInput,
  type RecordWikiOpInput,
  type SaveNoteInput
} from "./ipc/types";

const trellis: TrellisBridge = {
  app: {
    bootstrap: () => ipcRenderer.invoke(ipcChannels.appBootstrap) as Promise<AppBootstrap>,
    getSettings: () => ipcRenderer.invoke(ipcChannels.settingsGet) as Promise<AppSettings>,
    updateSettings: (settings) =>
      ipcRenderer.invoke(ipcChannels.settingsSet, settings) as Promise<AppSettings>
  },
  auth: {
    getSession: () =>
      ipcRenderer.invoke(ipcChannels.authGet) as Promise<AuthSessionSnapshot | null>,
    setSession: (session) => ipcRenderer.invoke(ipcChannels.authSet, session) as Promise<void>,
    clearSession: () => ipcRenderer.invoke(ipcChannels.authClear) as Promise<void>
  },
  db: {
    listSessions: () => ipcRenderer.invoke(ipcChannels.dbListSessions),
    createSession: (payload: { model: ChatModel; vaultId: string }) =>
      ipcRenderer.invoke(ipcChannels.dbCreateSession, payload),
    getMessages: (sessionId: string) =>
      ipcRenderer.invoke(ipcChannels.dbGetMessages, sessionId),
    appendMessages: (messages: MessageRecord[]) =>
      ipcRenderer.invoke(ipcChannels.dbAppendMessages, messages),
    replaceMessages: (payload) => ipcRenderer.invoke(ipcChannels.dbReplaceMessages, payload),
    updateSession: (payload) => ipcRenderer.invoke(ipcChannels.dbUpdateSession, payload),
    recordWikiOps: (ops: RecordWikiOpInput[]) =>
      ipcRenderer.invoke(ipcChannels.dbRecordWikiOps, ops)
  },
  vault: {
    listIndex: (vaultId?: string) => ipcRenderer.invoke(ipcChannels.vaultListIndex, vaultId),
    readNote: (slug: string, vaultId?: string) =>
      ipcRenderer.invoke(ipcChannels.vaultReadNote, { slug, vaultId }),
    writeNote: (input: SaveNoteInput) => ipcRenderer.invoke(ipcChannels.vaultWriteNote, input),
    createStub: (input: CreateStubInput) =>
      ipcRenderer.invoke(ipcChannels.vaultCreateStub, input),
    selectDirectory: () => ipcRenderer.invoke(ipcChannels.vaultSelectDirectory)
  },
  ingest: {
    parsePdf: (input: ParsePdfInput) =>
      ipcRenderer.invoke(ipcChannels.ingestParsePdf, input),
    clipUrl: (input) => ipcRenderer.invoke(ipcChannels.ingestClipUrl, input)
  },
  shell: {
    openPath: (targetPath: string) => ipcRenderer.invoke(ipcChannels.shellOpenPath, targetPath),
    openExternal: (url: string) => ipcRenderer.invoke(ipcChannels.shellOpenExternal, url)
  }
};

contextBridge.exposeInMainWorld("trellis", trellis);
