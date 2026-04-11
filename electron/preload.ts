import { contextBridge, ipcRenderer } from "electron";
import {
  ipcChannels,
  type AppBootstrap,
  type AppSettings,
  type AuthSessionSnapshot,
  type ChatModel,
  type ChatStreamEvent,
  type ChatStreamInput,
  type CreateFolderInput,
  type CreateStubInput,
  type CreateCheckoutSessionInput,
  type CreateCheckoutSessionResult,
  type DeleteProviderKeyInput,
  type DeleteFolderInput,
  type DeleteNoteInput,
  type ExportToObsidianInput,
  type ExportToObsidianResult,
  type ExtractionInstallProgressEvent,
  type ExtractionJobNotification,
  type ImportFromObsidianInput,
  type ImportFromObsidianResult,
  type MessageRecord,
  type RenameFolderInput,
  type TrellisBridge,
  type ParsePdfInput,
  type RecordWikiOpInput,
  type SaveNoteInput,
  type SelectDirectoryInput,
  type SetProviderKeyInput,
  type VaultAppendChatImageInput
} from "./ipc/types";

const trellis: TrellisBridge = {
  app: {
    bootstrap: () => ipcRenderer.invoke(ipcChannels.appBootstrap) as Promise<AppBootstrap>,
    getSettings: () => ipcRenderer.invoke(ipcChannels.settingsGet) as Promise<AppSettings>,
    updateSettings: (settings) =>
      ipcRenderer.invoke(ipcChannels.settingsSet, settings) as Promise<AppSettings>,
    getWorkspace: () => ipcRenderer.invoke(ipcChannels.workspaceGet),
    listWorkspaces: () => ipcRenderer.invoke(ipcChannels.workspaceList),
    switchWorkspace: (input) => ipcRenderer.invoke(ipcChannels.workspaceSwitch, input),
    resetPreviewWorkspace: () => ipcRenderer.invoke(ipcChannels.workspaceResetPreview)
  },
  auth: {
    getSession: () =>
      ipcRenderer.invoke(ipcChannels.authGet) as Promise<AuthSessionSnapshot | null>,
    setSession: (session) => ipcRenderer.invoke(ipcChannels.authSet, session) as Promise<void>,
    clearSession: () => ipcRenderer.invoke(ipcChannels.authClear) as Promise<void>
  },
  billing: {
    createCheckoutSession: (input: CreateCheckoutSessionInput) =>
      ipcRenderer.invoke(
        ipcChannels.billingCreateCheckoutSession,
        input
      ) as Promise<CreateCheckoutSessionResult>
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
  extraction: {
    getRuntimeStatus: (input) =>
      ipcRenderer.invoke(ipcChannels.extractionGetRuntimeStatus, input ?? {}),
    run: (input) => ipcRenderer.invoke(ipcChannels.extractionRun, input),
    queueSession: (input) => ipcRenderer.invoke(ipcChannels.extractionQueueSession, input),
    installLocalModel: (modelId: string) =>
      ipcRenderer.invoke(ipcChannels.extractionInstallLocalModel, modelId),
    cancelInstallLocalModel: () =>
      ipcRenderer.invoke(ipcChannels.extractionCancelInstallLocalModel) as Promise<void>,
    onInstallProgress: (listener: (event: ExtractionInstallProgressEvent) => void) => {
      const channel = ipcChannels.extractionInstallProgress;
      const handler = (_event: unknown, payload: ExtractionInstallProgressEvent) => {
        listener(payload);
      };
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },
    removeLocalModel: (modelId: string) =>
      ipcRenderer.invoke(ipcChannels.extractionRemoveLocalModel, modelId),
    listDebugRuns: (limit?: number) =>
      ipcRenderer.invoke(ipcChannels.extractionListDebugRuns, limit),
    onJobUpdate: (listener: (notification: ExtractionJobNotification) => void) => {
      const channel = ipcChannels.extractionJobUpdated;
      const handler = (_event: unknown, notification: ExtractionJobNotification) => {
        listener(notification);
      };
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    }
  },
  vault: {
    listIndex: (vaultId?: string) => ipcRenderer.invoke(ipcChannels.vaultListIndex, vaultId),
    readNote: (slug: string, vaultId?: string) =>
      ipcRenderer.invoke(ipcChannels.vaultReadNote, { slug, vaultId }),
    writeNote: (input: SaveNoteInput) => ipcRenderer.invoke(ipcChannels.vaultWriteNote, input),
    appendChatImageToNote: (input: VaultAppendChatImageInput) =>
      ipcRenderer.invoke(ipcChannels.vaultAppendChatImage, input),
    createStub: (input: CreateStubInput) =>
      ipcRenderer.invoke(ipcChannels.vaultCreateStub, input),
    deleteNote: (input: DeleteNoteInput) =>
      ipcRenderer.invoke(ipcChannels.vaultDeleteNote, input),
    createFolder: (input: CreateFolderInput) =>
      ipcRenderer.invoke(ipcChannels.vaultCreateFolder, input),
    renameFolder: (input: RenameFolderInput) =>
      ipcRenderer.invoke(ipcChannels.vaultRenameFolder, input),
    deleteFolder: (input: DeleteFolderInput) =>
      ipcRenderer.invoke(ipcChannels.vaultDeleteFolder, input),
    selectDirectory: (input?: SelectDirectoryInput) =>
      ipcRenderer.invoke(ipcChannels.vaultSelectDirectory, input ?? {}),
    importFromObsidian: (input: ImportFromObsidianInput) =>
      ipcRenderer.invoke(
        ipcChannels.vaultImportFromObsidian,
        input
      ) as Promise<ImportFromObsidianResult>,
    exportToObsidian: (input: ExportToObsidianInput) =>
      ipcRenderer.invoke(
        ipcChannels.vaultExportToObsidian,
        input
      ) as Promise<ExportToObsidianResult>
  },
  retrieval: {
    searchNotes: (input) => ipcRenderer.invoke(ipcChannels.retrievalSearchNotes, input),
    rebuildIndex: (vaultId?: string) =>
      ipcRenderer.invoke(ipcChannels.retrievalRebuildIndex, vaultId)
  },
  ingest: {
    parsePdf: (input: ParsePdfInput) =>
      ipcRenderer.invoke(ipcChannels.ingestParsePdf, input),
    clipUrl: (input) => ipcRenderer.invoke(ipcChannels.ingestClipUrl, input)
  },
  chat: {
    pickAttachment: () => ipcRenderer.invoke(ipcChannels.chatPickAttachment),
    buildContext: (input) => ipcRenderer.invoke(ipcChannels.chatBuildContext, input),
    storeMemory: (input) => ipcRenderer.invoke(ipcChannels.chatStoreMemory, input),
    runLocalReply: (input) => ipcRenderer.invoke(ipcChannels.chatRunLocalReply, input),
    stream: async (input: ChatStreamInput) => {
      const requestId = crypto.randomUUID();
      const channel = ipcChannels.chatStreamEvent;

      return new Promise<void>((resolve, reject) => {
        const handler = (_event: unknown, payload: ChatStreamEvent) => {
          if (payload.requestId !== requestId) {
            return;
          }

          if (payload.type === "token") {
            input.onToken(payload.payload);
            return;
          }

          if (payload.type === "status") {
            void input.onStatus(payload.payload);
            return;
          }

          if (payload.type === "title") {
            void input.onTitle(payload.payload);
          }
        };

        ipcRenderer.on(channel, handler);

        void ipcRenderer.invoke(ipcChannels.chatStream, {
          requestId,
          accessToken: input.accessToken,
          subscriptionTier: input.subscriptionTier,
          model: input.model,
          sessionId: input.sessionId,
          messages: input.messages,
          references: input.references ?? []
        })
          .then(() => {
            ipcRenderer.removeListener(channel, handler);
            resolve();
          })
          .catch((error) => {
            ipcRenderer.removeListener(channel, handler);
            reject(error);
          });
      });
    },
    getProviderKeyStatus: () => ipcRenderer.invoke(ipcChannels.providerKeysGet),
    setProviderKey: (input: SetProviderKeyInput) =>
      ipcRenderer.invoke(ipcChannels.providerKeysSet, input),
    deleteProviderKey: (input: DeleteProviderKeyInput) =>
      ipcRenderer.invoke(ipcChannels.providerKeysDelete, input)
  },
  media: {
    writeCache: (input) => ipcRenderer.invoke(ipcChannels.mediaCacheWrite, input),
    readDataUrl: (fileId: string) =>
      ipcRenderer.invoke(ipcChannels.mediaCacheReadDataUrl, fileId) as Promise<string | null>,
    pickImage: () => ipcRenderer.invoke(ipcChannels.mediaPickImage),
    transcribe: (input) => ipcRenderer.invoke(ipcChannels.mediaTranscribe, input),
    synthesizeSpeech: (input) => ipcRenderer.invoke(ipcChannels.mediaSynthesizeSpeech, input),
    generateImage: (input) => ipcRenderer.invoke(ipcChannels.mediaGenerateImage, input)
  },
  shell: {
    openPath: (targetPath: string) => ipcRenderer.invoke(ipcChannels.shellOpenPath, targetPath),
    openExternal: (url: string) => ipcRenderer.invoke(ipcChannels.shellOpenExternal, url)
  }
};

contextBridge.exposeInMainWorld("trellis", trellis);
