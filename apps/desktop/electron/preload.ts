import { contextBridge, ipcRenderer } from "electron";
import {
  ipcChannels,
  type AppBootstrap,
  type AppSettings,
  type ApplyBucketOrganizeInput,
  type AuthSessionSnapshot,
  type ChatModel,
  type ChatStreamEvent,
  type ChatStreamInput,
  type CreateFolderInput,
  type CreateStubInput,
  type CreateCheckoutSessionInput,
  type CreateCheckoutSessionResult,
  type CreateThoughtInput,
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
  type ThoughtRecord,
  type ThoughtUpdatedPayload,
  type TrellisBridge,
  type ParsePdfInput,
  type RecordWikiOpInput,
  type SaveNoteInput,
  type SelectDirectoryInput,
  type SetProviderKeyInput,
  type BucketAppendChatImageInput,
  type BucketImportNoteImageInput,
  type BucketReadNoteAssetDataUrlInput
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
    createSession: (payload: { model: ChatModel; bucketId: string }) =>
      ipcRenderer.invoke(ipcChannels.dbCreateSession, payload),
    getMessages: (sessionId: string) =>
      ipcRenderer.invoke(ipcChannels.dbGetMessages, sessionId),
    appendMessages: (messages: MessageRecord[]) =>
      ipcRenderer.invoke(ipcChannels.dbAppendMessages, messages),
    replaceMessages: (payload) => ipcRenderer.invoke(ipcChannels.dbReplaceMessages, payload),
    deleteSession: (sessionId: string) => ipcRenderer.invoke(ipcChannels.dbDeleteSession, sessionId),
    updateSession: (payload) => ipcRenderer.invoke(ipcChannels.dbUpdateSession, payload),
    getSessionNoteSlugs: (sessionId: string) =>
      ipcRenderer.invoke(ipcChannels.dbGetSessionNoteSlugs, sessionId),
    recordWikiOps: (ops: RecordWikiOpInput[]) =>
      ipcRenderer.invoke(ipcChannels.dbRecordWikiOps, ops),
    listWikiTouchSessions: (bucketId: string) =>
      ipcRenderer.invoke(ipcChannels.dbListWikiTouchSessions, bucketId),
    getStrandProvenanceForFile: (input: { bucketId: string; fileName: string }) =>
      ipcRenderer.invoke(ipcChannels.dbGetStrandProvenanceForFile, input),
    listStrandRevisions: (input: { bucketId: string; file: string }) =>
      ipcRenderer.invoke(ipcChannels.dbListStrandRevisions, input),
    getStrandRevisionBody: (input: { bucketId: string; revisionId: string }) =>
      ipcRenderer.invoke(ipcChannels.dbGetStrandRevisionBody, input),
    createThought: (input: CreateThoughtInput) =>
      ipcRenderer.invoke(ipcChannels.dbCreateThought, input) as Promise<ThoughtRecord>,
    listThoughts: (bucketId: string) =>
      ipcRenderer.invoke(ipcChannels.dbListThoughts, bucketId) as Promise<ThoughtRecord[]>,
    getThought: (thoughtId: string) =>
      ipcRenderer.invoke(ipcChannels.dbGetThought, thoughtId) as Promise<ThoughtRecord | null>,
    retryThoughtEnrichment: (thoughtId: string) =>
      ipcRenderer.invoke(ipcChannels.dbRetryThoughtEnrichment, thoughtId) as Promise<void>
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
  bucket: {
    listIndex: (bucketId?: string) => ipcRenderer.invoke(ipcChannels.bucketListIndex, bucketId),
    readNote: (slug: string, bucketId?: string) =>
      ipcRenderer.invoke(ipcChannels.bucketReadNote, { slug, bucketId }),
    writeNote: (input: SaveNoteInput) => ipcRenderer.invoke(ipcChannels.bucketWriteNote, input),
    appendChatImageToNote: (input: BucketAppendChatImageInput) =>
      ipcRenderer.invoke(ipcChannels.bucketAppendChatImage, input),
    importNoteImage: (input: BucketImportNoteImageInput) =>
      ipcRenderer.invoke(ipcChannels.bucketImportNoteImage, input),
    readNoteAssetDataUrl: (input: BucketReadNoteAssetDataUrlInput) =>
      ipcRenderer.invoke(ipcChannels.bucketReadNoteAssetDataUrl, input),
    createStub: (input: CreateStubInput) =>
      ipcRenderer.invoke(ipcChannels.bucketCreateStub, input),
    deleteNote: (input: DeleteNoteInput) =>
      ipcRenderer.invoke(ipcChannels.bucketDeleteNote, input),
    createFolder: (input: CreateFolderInput) =>
      ipcRenderer.invoke(ipcChannels.bucketCreateFolder, input),
    renameFolder: (input: RenameFolderInput) =>
      ipcRenderer.invoke(ipcChannels.bucketRenameFolder, input),
    deleteFolder: (input: DeleteFolderInput) =>
      ipcRenderer.invoke(ipcChannels.bucketDeleteFolder, input),
    selectDirectory: (input?: SelectDirectoryInput) =>
      ipcRenderer.invoke(ipcChannels.bucketSelectDirectory, input ?? {}),
    importFromObsidian: (input: ImportFromObsidianInput) =>
      ipcRenderer.invoke(
        ipcChannels.bucketImportFromObsidian,
        input
      ) as Promise<ImportFromObsidianResult>,
    exportToObsidian: (input: ExportToObsidianInput) =>
      ipcRenderer.invoke(
        ipcChannels.bucketExportToObsidian,
        input
      ) as Promise<ExportToObsidianResult>
  },
  retrieval: {
    searchNotes: (input) => ipcRenderer.invoke(ipcChannels.retrievalSearchNotes, input),
    rebuildIndex: (bucketId?: string) =>
      ipcRenderer.invoke(ipcChannels.retrievalRebuildIndex, bucketId)
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
    proposeNoteActions: (input) =>
      ipcRenderer.invoke(ipcChannels.chatProposeNoteActions, input),
    applyBucketOrganize: (input: ApplyBucketOrganizeInput) =>
      ipcRenderer.invoke(ipcChannels.chatApplyBucketOrganize, input),
    runLocalReply: (input) => ipcRenderer.invoke(ipcChannels.chatRunLocalReply, input),
    streamLocal: async (input: ChatStreamInput) => {
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

        void ipcRenderer
          .invoke(ipcChannels.chatStreamLocal, {
            requestId,
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
          references: input.references ?? [],
          ...(input.previewWorkspace ? { previewWorkspace: true } : {})
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
    synthesizeSpeechStream: (input, onChunk) =>
      new Promise((resolve, reject) => {
        const onData = (_evt: unknown, chunk: Uint8Array) => {
          onChunk(chunk);
        };
        ipcRenderer.on(ipcChannels.mediaSpeechStreamChunk, onData);
        ipcRenderer
          .invoke(ipcChannels.mediaSynthesizeSpeechStream, input)
          .then(() => {
            ipcRenderer.removeListener(ipcChannels.mediaSpeechStreamChunk, onData);
            resolve();
          })
          .catch((error: unknown) => {
            ipcRenderer.removeListener(ipcChannels.mediaSpeechStreamChunk, onData);
            reject(error);
          });
      }),
    cancelSynthesizeSpeechStream: () =>
      ipcRenderer.invoke(ipcChannels.mediaSynthesizeSpeechStreamCancel) as Promise<void>,
    generateImage: (input) => ipcRenderer.invoke(ipcChannels.mediaGenerateImage, input)
  },
  shell: {
    openPath: (targetPath: string) => ipcRenderer.invoke(ipcChannels.shellOpenPath, targetPath),
    openExternal: (url: string) => ipcRenderer.invoke(ipcChannels.shellOpenExternal, url)
  },
  thoughts: {
    onThoughtUpdated: (listener: (payload: ThoughtUpdatedPayload) => void) => {
      const channel = ipcChannels.thoughtUpdated;
      const handler = (_event: unknown, payload: ThoughtUpdatedPayload) => {
        listener(payload);
      };
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    }
  }
};

contextBridge.exposeInMainWorld("trellis", trellis);
