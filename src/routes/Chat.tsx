import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  type AppFeatureFlags,
  type AppSettings,
  type ChatContextPacket,
  type WorkspaceInfo,
  type ChatAttachment,
  type ChatMediaArtifact,
  type ChatNoteActionProposal,
  type MessageRecord,
  type QueueSessionExtractionResult
} from "@electron/ipc/types";
import { getChatModelMediaCapabilities } from "@shared/chat/capabilities";
import { ChatVaultSelect } from "@/components/chat/ChatVaultSelect";
import { InputBar } from "@/components/chat/InputBar";
import { MessageList } from "@/components/chat/MessageList";
import type { ChatNoteReference } from "@/lib/api";
import { canUseChatModel, getFirstAccessibleChatModel } from "@/lib/chatModels";
import {
  formatMessageForApi,
  toChatAttachments,
  type PendingChatAttachment,
  type PendingImageAttachment
} from "@/lib/chatAttachments";
import { useStream } from "@/hooks/useStream";
import {
  getActiveVault,
  getVaultById,
  resolveExtractionModeForSubscription
} from "@/lib/settings";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { notesRoutePath } from "@/lib/noteRoutes";
import { cn } from "@/lib/utils";
import { defaultNewTemplateMarkdown, templateTag } from "@/lib/chatTemplates";
import { useWikiStore } from "@/store/wikiStore";

interface Props {
  settings: AppSettings;
  features: AppFeatureFlags;
  workspace: WorkspaceInfo;
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
  onSwitchWorkspace: (workspaceId: WorkspaceInfo["id"]) => Promise<void>;
}

export function Chat({
  settings,
  features,
  workspace,
  onUpdateSettings,
  onSwitchWorkspace
}: Props) {
  const chatColumnClassName = "max-w-[1020px]";
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [pendingImageAttachments, setPendingImageAttachments] = useState<PendingImageAttachment[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [readAloudLoadingMessageId, setReadAloudLoadingMessageId] = useState<string | null>(null);
  const [busyNoteActionId, setBusyNoteActionId] = useState<string | null>(null);
  /** True while queuing manual save or until that extraction job finishes. */
  const [manualNoteCaptureActive, setManualNoteCaptureActive] = useState(false);
  const pendingManualExtractionJobIdRef = useRef<string | null>(null);
  const manualSaveToastIdRef = useRef<string | null>(null);
  const accessToken = useAuthStore((state) => state.accessToken);
  const authStatus = useAuthStore((state) => state.status);
  const subscriptionTier = useAuthStore((state) => state.subscriptionTier);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const providerKeys = useAuthStore((state) => state.providerKeys);
  const notes = useWikiStore((state) => state.notes);
  const activeNoteSlug = useWikiStore((state) => state.activeNoteSlug);
  const setNote = useWikiStore((state) => state.setNote);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
  const replaceWikiIndex = useWikiStore((state) => state.replaceIndex);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const setActiveSession = useChatStore((state) => state.setActiveSession);
  const messagesBySession = useChatStore((state) => state.messagesBySession);
  const setSessionMessages = useChatStore((state) => state.setSessionMessages);
  const activeModel = useChatStore((state) => state.activeModel);
  const setActiveModel = useChatStore((state) => state.setActiveModel);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const awaitingFirstToken = useChatStore((state) => state.awaitingFirstToken);
  const upsertSession = useChatStore((state) => state.upsertSession);
  const messageMetaById = useChatStore((state) => state.messageMetaById);
  const replaceSessionMessages = useChatStore((state) => state.replaceSessionMessages);
  const setMessageMeta = useChatStore((state) => state.setMessageMeta);
  const clearMessageMeta = useChatStore((state) => state.clearMessageMeta);
  const pushToast = useUiStore((state) => state.pushToast);
  const removeToast = useUiStore((state) => state.removeToast);
  const streamAssistant = useStream({
    accessToken,
    model: activeModel,
    privacyMode: settings.chat.privacyMode,
    subscriptionTier
  });
  const previousSessionId = useRef<string | null>(activeSessionId);
  const noteActionDraftDbTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const activeVault = getActiveVault(settings);
  const isPreviewWorkspace = workspace.isPreview;
  const chatDisabled = settings.chat.privacyMode !== "local" && authStatus !== "authenticated";
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );
  const existingSlugs = useMemo(() => notes.map((note) => note.slug), [notes]);
  const currentMessages = useMemo(
    () => (activeSessionId ? messagesBySession[activeSessionId] ?? [] : []),
    [activeSessionId, messagesBySession]
  );
  const editingMessage = useMemo(
    () => currentMessages.find((message) => message.id === editingMessageId) ?? null,
    [currentMessages, editingMessageId]
  );

  useEffect(() => {
    if (!activeSessionId || messagesBySession[activeSessionId]) {
      return;
    }

    void window.trellis.db
      .getMessages(activeSessionId)
      .then((messages) => {
        setSessionMessages(activeSessionId, messages);
      })
      .catch((error) => {
        pushToast({
          title: error instanceof Error ? error.message : "Could not load that session.",
          tone: "warning"
        });
      });
  }, [activeSessionId, messagesBySession, pushToast, setSessionMessages]);

  useEffect(() => {
    setEditingMessageId(null);
    setDraft("");
    setPendingAttachments([]);
    setPendingImageAttachments([]);
  }, [activeSessionId]);

  const previewModelAccess = useMemo(
    () => ({ previewWorkspace: workspace.isPreview && isAdmin }),
    [isAdmin, workspace.isPreview]
  );

  useEffect(() => {
    if (
      canUseChatModel(activeModel, subscriptionTier, providerKeys.statuses, previewModelAccess)
    ) {
      return;
    }

    const fallbackModel = getFirstAccessibleChatModel(
      subscriptionTier,
      providerKeys.statuses,
      previewModelAccess
    );

    if (fallbackModel !== activeModel) {
      setActiveModel(fallbackModel);
    }
  }, [
    activeModel,
    previewModelAccess,
    providerKeys.statuses,
    setActiveModel,
    subscriptionTier
  ]);

  const queueExtraction = useCallback(
    async (
      sessionId: string,
      trigger: "idle" | "session-switch",
      options?: { force?: boolean }
    ): Promise<QueueSessionExtractionResult | null> => {
      try {
        return await window.trellis.extraction.queueSession({
          sessionId,
          trigger,
          mode: resolveExtractionModeForSubscription(settings.extraction.mode, subscriptionTier),
          preferredLocalModelId: settings.extraction.preferredLocalModelId ?? undefined,
          force: options?.force ?? false
        });
      } catch (error) {
        pushToast({
          title:
            error instanceof Error
              ? error.message
              : "Trellis couldn’t queue background note processing for that session.",
          tone: "warning"
        });
        return null;
      }
    },
    [
      accessToken,
      pushToast,
      settings.extraction.mode,
      settings.extraction.preferredLocalModelId,
      subscriptionTier
    ]
  );

  /** Skips IPC when on-device extraction is disabled (matches Save to note / feature flag). */
  const maybeQueueSessionExtraction = useCallback(
    async (
      sessionId: string,
      trigger: "idle" | "session-switch",
      options?: { force?: boolean }
    ): Promise<QueueSessionExtractionResult | null> => {
      if (!features.localExtraction) {
        return null;
      }
      return queueExtraction(sessionId, trigger, options);
    },
    [features.localExtraction, queueExtraction]
  );

  const queueIdleExtractionWithToast = useCallback(
    (sessionId: string) => {
      void maybeQueueSessionExtraction(sessionId, "idle").then((result) => {
        if (result?.state === "queued") {
          pushToast({
            title: "Updating your vault from this chat in the background…",
            tone: "default"
          });
        }
      });
    },
    [maybeQueueSessionExtraction, pushToast]
  );

  const canSaveChatToNote = useMemo(
    () => Boolean(activeSessionId) && currentMessages.length >= 2 && !chatDisabled,
    [activeSessionId, chatDisabled, currentMessages.length]
  );

  const handleSaveChatToNote = useCallback(async () => {
    if (!activeSessionId || manualNoteCaptureActive || !canSaveChatToNote) {
      return;
    }

    setManualNoteCaptureActive(true);
    pendingManualExtractionJobIdRef.current = null;

    const processingToastId = pushToast({
      title: "Processing this chat into notes in the background…",
      tone: "default"
    });
    manualSaveToastIdRef.current = processingToastId;

    try {
      const result = await window.trellis.extraction.queueSession({
        sessionId: activeSessionId,
        trigger: "manual",
        mode: resolveExtractionModeForSubscription(settings.extraction.mode, subscriptionTier),
        preferredLocalModelId: settings.extraction.preferredLocalModelId ?? undefined,
        force: true
      });

      if (result.state === "queued" && result.job) {
        pendingManualExtractionJobIdRef.current = result.job.id;
        return;
      }

      if (result.state === "duplicate" && result.job) {
        pendingManualExtractionJobIdRef.current = result.job.id;
        return;
      }

      removeToast(processingToastId);
      manualSaveToastIdRef.current = null;
      pushToast({
        title: "Add at least one exchange before saving to a note.",
        tone: "warning"
      });
    } catch (error) {
      removeToast(processingToastId);
      manualSaveToastIdRef.current = null;
      pushToast({
        title:
          error instanceof Error ? error.message : "Could not save this chat to your notes.",
        tone: "warning"
      });
    } finally {
      if (!pendingManualExtractionJobIdRef.current) {
        setManualNoteCaptureActive(false);
      }
    }
  }, [
    activeSessionId,
    canSaveChatToNote,
    manualNoteCaptureActive,
    pushToast,
    removeToast,
    settings.extraction.mode,
    settings.extraction.preferredLocalModelId,
    subscriptionTier
  ]);

  useEffect(() => {
    return window.trellis.extraction.onJobUpdate((notification) => {
      const pendingId = pendingManualExtractionJobIdRef.current;
      if (!pendingId || notification.id !== pendingId) {
        return;
      }
      if (
        notification.status === "completed" ||
        notification.status === "failed" ||
        notification.status === "skipped"
      ) {
        const toastId = manualSaveToastIdRef.current;
        if (toastId) {
          useUiStore.getState().removeToast(toastId);
          manualSaveToastIdRef.current = null;
        }
        pendingManualExtractionJobIdRef.current = null;
        setManualNoteCaptureActive(false);

        const push = useUiStore.getState().pushToast;

        if (notification.status === "completed") {
          const applied = notification.appliedNotes ?? [];
          if (applied.length > 0) {
            push({
              title:
                applied.length === 1
                  ? "Chat processed — your note is ready."
                  : `Chat processed — ${applied.length} notes updated.`,
              tone: "success",
              noteLinks: applied.map((note) => ({
                noteSlug: note.slug,
                label: note.title
              }))
            });
          } else {
            push({
              title: "Chat processed — your wiki is up to date.",
              tone: "success"
            });
          }
        } else if (notification.status === "failed") {
          push({
            title:
              notification.errorMessage ?? "Could not finish saving this chat to your notes.",
            tone: "error"
          });
        } else {
          push({
            title:
              notification.errorMessage ?? "Nothing new to save from this chat yet.",
            tone: "warning"
          });
        }
      }
    });
  }, []);

  useEffect(() => {
    const toastId = manualSaveToastIdRef.current;
    if (toastId) {
      removeToast(toastId);
      manualSaveToastIdRef.current = null;
    }
    pendingManualExtractionJobIdRef.current = null;
    setManualNoteCaptureActive(false);
  }, [activeSessionId, removeToast]);

  useEffect(() => {
    if (previousSessionId.current && previousSessionId.current !== activeSessionId) {
      void maybeQueueSessionExtraction(previousSessionId.current, "session-switch");
    }

    previousSessionId.current = activeSessionId;
  }, [activeSessionId, maybeQueueSessionExtraction]);

  const loadNote = useCallback(
    async (slug: string, vaultId: string) => {
      const cachedNote = useWikiStore.getState().noteCache[slug];

      if (cachedNote) {
        return cachedNote;
      }

      const note = await window.trellis.vault.readNote(slug, vaultId);
      setNote(note);
      return note;
    },
    [setNote]
  );

  const openReferencedNote = useCallback(
    async (slug: string) => {
      const vaultId = activeSession?.vaultId || activeVault.id;

      if (!notes.some((note) => note.slug === slug)) {
        pushToast({
          title: "That note is not available in this vault yet.",
          tone: "warning"
        });
        return;
      }

      try {
        await loadNote(slug, vaultId);
        setActiveNote(slug);
        navigate(notesRoutePath(slug));
      } catch (error) {
        pushToast({
          title: error instanceof Error ? error.message : "Could not open that note.",
          tone: "warning"
        });
      }
    },
    [activeSession?.vaultId, activeVault.id, loadNote, navigate, notes, pushToast, setActiveNote]
  );

  const buildChatContext = useCallback(
    async (
      messages: Array<Pick<MessageRecord, "role" | "content">>,
      vaultId: string,
      options?: { currentSessionId?: string | null }
    ): Promise<ChatContextPacket> => {
      return window.trellis.chat.buildContext({
        mode: settings.chat.privacyMode,
        vaultId,
        activeNoteSlug,
        sessionTitle: activeSession?.title ?? null,
        currentSessionId: options?.currentSessionId ?? null,
        messages
      });
    },
    [activeNoteSlug, activeSession?.title, settings.chat.privacyMode]
  );

  function buildRetryTranscript(
    sessionId: string,
    targetMessageId: string | undefined,
    nextContent: string | undefined,
    nextAttachments: ChatAttachment[] | undefined,
    nextMediaArtifacts?: ChatMediaArtifact[]
  ): {
    baseMessages: MessageRecord[];
    userMessage: MessageRecord;
  } {
    const sessionMessages = useChatStore.getState().messagesBySession[sessionId] ?? [];

    if (!targetMessageId) {
      const userMessage: MessageRecord = {
        id: crypto.randomUUID(),
        sessionId,
        role: "user",
        content: nextContent ?? "",
        createdAt: Date.now(),
        tokens: null,
        ...(nextAttachments && nextAttachments.length > 0 ? { attachments: nextAttachments } : {}),
        ...(nextMediaArtifacts && nextMediaArtifacts.length > 0
          ? { mediaArtifacts: nextMediaArtifacts }
          : {})
      };

      return {
        baseMessages: [...sessionMessages, userMessage],
        userMessage
      };
    }

    const targetIndex = sessionMessages.findIndex((message) => message.id === targetMessageId);

    if (targetIndex === -1) {
      throw new Error("Could not find that message to retry.");
    }

    const targetMessage = sessionMessages[targetIndex];

    if (!targetMessage || targetMessage.role !== "user") {
      throw new Error("Only your messages can be retried.");
    }

    const updatedUserMessage: MessageRecord = {
      ...targetMessage,
      content: nextContent ?? targetMessage.content,
      createdAt: Date.now()
    };

    if (nextAttachments !== undefined) {
      if (nextAttachments.length > 0) {
        updatedUserMessage.attachments = nextAttachments;
      } else {
        delete updatedUserMessage.attachments;
      }
    }

    if (nextMediaArtifacts !== undefined) {
      if (nextMediaArtifacts.length > 0) {
        updatedUserMessage.mediaArtifacts = nextMediaArtifacts;
      } else {
        delete updatedUserMessage.mediaArtifacts;
      }
    }

    const baseMessages = [...sessionMessages.slice(0, targetIndex), updatedUserMessage];

    return {
      baseMessages,
      userMessage: updatedUserMessage
    };
  }

  async function sendMessage(
    value: string,
    targetMessageId?: string,
    attachmentPayload?: ChatAttachment[],
    mediaPayload?: ChatMediaArtifact[]
  ): Promise<void> {
    let optimisticUserMessage: MessageRecord | null = null;
    let sessionId = activeSessionId;
    const sessionVaultId = activeSession?.vaultId || activeVault.id;

    try {
      if (!sessionId) {
        const session = await window.trellis.db.createSession({
          model: activeModel,
          vaultId: activeVault.id
        });
        sessionId = session.id;
        setActiveSession(session.id);
        upsertSession(session);
      }

      const { baseMessages, userMessage } = buildRetryTranscript(
        sessionId,
        targetMessageId,
        value,
        attachmentPayload,
        mediaPayload
      );
      optimisticUserMessage = userMessage;
      replaceSessionMessages(sessionId, baseMessages);
      clearMessageMeta(userMessage.id);
      setMessageMeta(userMessage.id, { status: "pending" });
      setDraft("");
      if (targetMessageId) {
        setEditingMessageId(null);
      }

      if (!targetMessageId) {
        try {
          const proposal = await window.trellis.chat.proposeNoteActions({
            mode: settings.chat.privacyMode,
            vaultId: sessionVaultId,
            activeNoteSlug,
            messages: baseMessages.map((message) => ({
              id: message.id,
              role: message.role,
              content: formatMessageForApi(message)
            }))
          });

          const isTemplateCreateReview =
            proposal.actions.length > 0 &&
            proposal.actions.every((action) => action.kind === "create_template");

          if (isTemplateCreateReview || proposal.clarification) {
            const assistantMessage: MessageRecord = {
              id: crypto.randomUUID(),
              sessionId,
              role: "assistant",
              content:
                proposal.clarification ??
                "Here’s a reusable template draft for your vault. Approve when it should be saved under wiki/templates.",
              createdAt: Date.now(),
              tokens: null,
              ...(proposal.actions.length > 0 ? { noteActions: proposal.actions } : {})
            };
            const nextMessages = [...baseMessages, assistantMessage];
            replaceSessionMessages(sessionId, nextMessages);
            clearMessageMeta(userMessage.id);
            await window.trellis.db.replaceMessages({
              sessionId,
              messages: nextMessages
            });
            const updatedSession = await window.trellis.db.updateSession({
              id: sessionId,
              model: activeModel
            });
            upsertSession(updatedSession);
            setPendingAttachments([]);
            setPendingImageAttachments([]);
            queueIdleExtractionWithToast(sessionId);
            return;
          }
        } catch (error) {
          pushToast({
            title:
              error instanceof Error
                ? error.message
                : "Trellis couldn’t prepare a note change for review.",
            tone: "warning"
          });
        }
      }

      let contextPacket: ChatContextPacket = {
        mode: settings.chat.privacyMode,
        references: [],
        sourceLabels: []
      };

      try {
        contextPacket = await buildChatContext(
          baseMessages.map((message) => ({
            role: message.role,
            content: formatMessageForApi(message)
          })),
          sessionVaultId,
          { currentSessionId: sessionId }
        );
      } catch (error) {
        pushToast({
          title:
            error instanceof Error
              ? error.message
              : "Trellis couldn’t gather local note context for that reply.",
          tone: "warning"
        });
      }

      const streamResult = await streamAssistant(
        sessionId,
        baseMessages,
        contextPacket.references as ChatNoteReference[]
      );

      if (!streamResult.assistantMessage) {
        setMessageMeta(userMessage.id, {
          status: "failed",
          errorMessage: streamResult.failureMessage ?? "Not sent"
        });
        return;
      }

      clearMessageMeta(userMessage.id);
      const nextMessages = [...baseMessages, streamResult.assistantMessage];
      replaceSessionMessages(sessionId, nextMessages);
      if (
        settings.chat.readAloudAutoPlay &&
        streamResult.assistantMessage.content.trim().length > 0 &&
        settings.chat.privacyMode !== "local" &&
        accessToken
      ) {
        try {
          const spoken = await window.trellis.media.synthesizeSpeech({
            accessToken,
            subscriptionTier,
            text: streamResult.assistantMessage.content.slice(0, 4096)
          });
          const audio = new Audio(
            `data:${spoken.mimeType};base64,${spoken.audioBase64}`
          );
          void audio.play();
        } catch {
          // Optional: ignore auto read-aloud failures
        }
      }
      await window.trellis.db.replaceMessages({
        sessionId,
        messages: nextMessages
      });
      void window.trellis.chat.storeMemory({
        vaultId: sessionVaultId,
        sessionId,
        messages: nextMessages
          .slice(-2)
          .map((message) => ({
            id: message.id,
            role: message.role,
            content: formatMessageForApi(message)
          })),
        references: contextPacket.references
      }).catch((error) => {
        pushToast({
          title:
            error instanceof Error
              ? error.message
              : "Trellis couldn’t save local memory from that reply.",
          tone: "warning"
        });
      });
      setPendingAttachments([]);
      setPendingImageAttachments([]);
      const updatedSession = await window.trellis.db.updateSession({
        id: sessionId,
        model: activeModel
      });
      upsertSession(updatedSession);
      queueIdleExtractionWithToast(sessionId);
      void window.trellis.chat
        .applyVaultOrganize({
          vaultId: sessionVaultId,
          userMessage: value.trim()
        })
        .then(async (organizeResult) => {
          if (!organizeResult.applied || !organizeResult.message) {
            return;
          }

          pushToast({
            title: organizeResult.message,
            tone: "success",
            noteLinks: organizeResult.movedNote
              ? [
                  {
                    label: organizeResult.movedNote.title,
                    noteSlug: organizeResult.movedNote.slug
                  }
                ]
              : undefined
          });

          try {
            const snapshot = await window.trellis.vault.listIndex(sessionVaultId);
            replaceWikiIndex({
              notes: snapshot.notes,
              folders: snapshot.folders,
              graph: snapshot.graph
            });
          } catch {
            // Non-fatal if the wiki index could not refresh immediately.
          }
        })
        .catch(() => {
          // Heuristic organizer failures should not block chat.
        });
    } catch (error) {
      if (optimisticUserMessage && sessionId) {
        setMessageMeta(optimisticUserMessage.id, {
          status: "failed",
          errorMessage: "Not sent"
        });
      }
      pushToast({
        title: error instanceof Error ? error.message : "Could not send that message.",
        tone: "error"
      });
    }
  }

  async function handleSubmit(value: string): Promise<void> {
    const trimmed = value.trim();
    const payload = toChatAttachments(pendingAttachments);
    const mediaFromImages: ChatMediaArtifact[] = pendingImageAttachments.map((item) => ({
      kind: "image" as const,
      fileId: item.fileId,
      mimeType: item.mimeType,
      label: item.label
    }));

    if (!trimmed && payload.length === 0 && mediaFromImages.length === 0) {
      return;
    }

    if (settings.chat.privacyMode === "local" && mediaFromImages.length > 0) {
      pushToast({
        title:
          "Local-only chat cannot send images to the on-device model. Switch privacy to Auto or Off, or remove images.",
        tone: "warning"
      });
      return;
    }

    if (
      mediaFromImages.length > 0 &&
      !getChatModelMediaCapabilities(activeModel).visionInput
    ) {
      pushToast({
        title:
          "This model does not accept images. Choose GPT-4o Mini, GPT-4o, or a Claude model with vision.",
        tone: "warning"
      });
      return;
    }

    const mediaForSend = editingMessageId
      ? mediaFromImages
      : mediaFromImages.length > 0
        ? mediaFromImages
        : undefined;

    await sendMessage(trimmed, editingMessageId ?? undefined, payload, mediaForSend);
  }

  async function handleAttachFile(): Promise<void> {
    if (pendingAttachments.length + pendingImageAttachments.length >= 12) {
      pushToast({
        title: "You can attach up to 12 items per message.",
        tone: "warning"
      });
      return;
    }

    try {
      const result = await window.trellis.chat.pickAttachment();

      if (!result) {
        return;
      }

      setPendingAttachments((current) => [
        ...current,
        {
          clientId: crypto.randomUUID(),
          kind: "file",
          label: result.name,
          text: result.text
        }
      ]);
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not read that file.",
        tone: "warning"
      });
    }
  }

  async function clipPublicUrl(url: string): Promise<boolean> {
    if (pendingAttachments.length + pendingImageAttachments.length >= 12) {
      pushToast({
        title: "You can attach up to 12 items per message.",
        tone: "warning"
      });
      return false;
    }

    try {
      const draftUrl = new URL(url);

      if (draftUrl.protocol !== "https:" && draftUrl.protocol !== "http:") {
        throw new Error("Use an http or https URL.");
      }

      const clipped = await window.trellis.ingest.clipUrl({ url: draftUrl.toString() });

      setPendingAttachments((current) => [
        ...current,
        {
          clientId: crypto.randomUUID(),
          kind: "url",
          label: clipped.title,
          text: clipped.content,
          sourceUrl: clipped.sourcePath
        }
      ]);
      return true;
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not clip that URL.",
        tone: "warning"
      });
      return false;
    }
  }

  function handleEditMessage(messageId: string): void {
    const message = currentMessages.find((item) => item.id === messageId);

    if (!message || message.role !== "user") {
      return;
    }

    setEditingMessageId(messageId);
    setDraft(message.content);
    setPendingAttachments(
      (message.attachments ?? []).map((attachment) => ({
        ...attachment,
        clientId: crypto.randomUUID()
      }))
    );
    setPendingImageAttachments(
      (message.mediaArtifacts ?? [])
        .filter((artifact) => artifact.kind === "image")
        .map((artifact) => ({
          clientId: crypto.randomUUID(),
          fileId: artifact.fileId,
          mimeType: artifact.mimeType,
          label: artifact.label
        }))
    );
  }

  async function handleRetryMessage(messageId: string): Promise<void> {
    const message = currentMessages.find((item) => item.id === messageId);

    if (!message || message.role !== "user") {
      return;
    }

    await sendMessage(
      message.content,
      messageId,
      message.attachments,
      message.mediaArtifacts?.filter((artifact) => artifact.kind === "image")
    );
  }

  function cancelEditing(): void {
    setEditingMessageId(null);
    setDraft("");
    setPendingAttachments([]);
    setPendingImageAttachments([]);
  }

  function handleStartNewChat(): void {
    setEditingMessageId(null);
    setDraft("");
    setPendingAttachments([]);
    setPendingImageAttachments([]);
    setActiveSession(null);
    navigate("/chat");
  }

  async function handlePasteImage(input: { base64: string; mimeType: string }): Promise<void> {
    if (pendingAttachments.length + pendingImageAttachments.length >= 12) {
      pushToast({
        title: "You can attach up to 12 items per message.",
        tone: "warning"
      });
      return;
    }

    try {
      const { fileId } = await window.trellis.media.writeCache(input);
      setPendingImageAttachments((current) => [
        ...current,
        {
          clientId: crypto.randomUUID(),
          fileId,
          mimeType: input.mimeType,
          label: "Pasted image"
        }
      ]);
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not paste that image.",
        tone: "warning"
      });
    }
  }

  async function handleAttachImage(): Promise<void> {
    if (pendingAttachments.length + pendingImageAttachments.length >= 12) {
      pushToast({
        title: "You can attach up to 12 items per message.",
        tone: "warning"
      });
      return;
    }

    try {
      const picked = await window.trellis.media.pickImage();

      if (!picked) {
        return;
      }

      setPendingImageAttachments((current) => [
        ...current,
        {
          clientId: crypto.randomUUID(),
          fileId: picked.fileId,
          mimeType: picked.mimeType,
          label: picked.name
        }
      ]);
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not add that image.",
        tone: "warning"
      });
    }
  }

  async function handleGenerateImageWithPrompt(prompt: string): Promise<boolean> {
    if (chatDisabled || settings.chat.privacyMode === "local") {
      pushToast({
        title:
          "Image generation needs cloud access. Sign in and switch privacy away from local-only.",
        tone: "warning"
      });
      return false;
    }

    if (!getChatModelMediaCapabilities(activeModel).imageGeneration) {
      pushToast({
        title: "Image generation uses OpenAI. Switch to the GPT-4o chat model first.",
        tone: "warning"
      });
      return false;
    }

    const trimmed = prompt.trim();

    if (!trimmed) {
      return false;
    }

    let sessionId = activeSessionId;

    if (!sessionId) {
      try {
        const session = await window.trellis.db.createSession({
          model: activeModel,
          vaultId: activeVault.id
        });
        sessionId = session.id;
        setActiveSession(session.id);
        upsertSession(session);
      } catch (error) {
        pushToast({
          title: error instanceof Error ? error.message : "Could not start a chat session.",
          tone: "warning"
        });
        return false;
      }
    }

    const priorMessages = useChatStore.getState().messagesBySession[sessionId] ?? [];
    const userMessage: MessageRecord = {
      id: crypto.randomUUID(),
      sessionId,
      role: "user",
      content: `(Image request) ${trimmed}`,
      createdAt: Date.now(),
      tokens: null
    };
    const assistantMessageId = crypto.randomUUID();
    const pendingFileId = crypto.randomUUID();
    const assistantPending: MessageRecord = {
      id: assistantMessageId,
      sessionId,
      role: "assistant",
      content: "Generating image…",
      createdAt: Date.now(),
      tokens: null,
      mediaArtifacts: [
        {
          kind: "generated_image",
          fileId: pendingFileId,
          mimeType: "image/png",
          label: "Generated image",
          prompt: trimmed,
          pendingGeneration: true
        }
      ]
    };

    const optimisticMessages = [...priorMessages, userMessage, assistantPending];
    replaceSessionMessages(sessionId, optimisticMessages);

    try {
      await window.trellis.db.replaceMessages({ sessionId, messages: optimisticMessages });
    } catch (error) {
      replaceSessionMessages(sessionId, priorMessages);
      pushToast({
        title: error instanceof Error ? error.message : "Could not save messages.",
        tone: "warning"
      });
      return false;
    }

    try {
      const result = await window.trellis.media.generateImage({
        accessToken: accessToken ?? "",
        subscriptionTier,
        prompt: trimmed
      });
      const { fileId } = await window.trellis.media.writeCache({
        base64: result.imageBase64,
        mimeType: "image/png"
      });

      const assistantFinal: MessageRecord = {
        id: assistantMessageId,
        sessionId,
        role: "assistant",
        content: result.revisedPrompt
          ? `Generated image.\n\n${result.revisedPrompt}`
          : "Generated image.",
        createdAt: assistantPending.createdAt,
        tokens: null,
        mediaArtifacts: [
          {
            kind: "generated_image",
            fileId,
            mimeType: "image/png",
            label: "Generated image",
            prompt: trimmed
          }
        ]
      };

      const finalMessages = [...priorMessages, userMessage, assistantFinal];
      replaceSessionMessages(sessionId, finalMessages);
      await window.trellis.db.replaceMessages({ sessionId, messages: finalMessages });
      const updatedSession = await window.trellis.db.updateSession({
        id: sessionId,
        model: activeModel
      });
      upsertSession(updatedSession);
      queueIdleExtractionWithToast(sessionId);
      return true;
    } catch (error) {
      replaceSessionMessages(sessionId, priorMessages);
      try {
        await window.trellis.db.replaceMessages({ sessionId, messages: priorMessages });
      } catch {
        // ignore secondary persistence failure after rollback
      }
      pushToast({
        title: error instanceof Error ? error.message : "Could not generate that image.",
        tone: "warning"
      });
      return false;
    }
  }

  async function handleCreateTemplate(input: { title: string; content: string }): Promise<boolean> {
    const title = input.title.trim();

    if (!title) {
      pushToast({
        title: "Name the template before saving it.",
        tone: "warning"
      });
      return false;
    }

    const vaultId = activeSession?.vaultId || activeVault.id;
    const content = input.content.trim() || defaultNewTemplateMarkdown(title);

    try {
      const result = await window.trellis.vault.writeNote({
        vaultId,
        title,
        folderPath: "templates",
        content,
        frontmatter: {
          tags: [templateTag],
          type: "concept",
          sources: 0
        }
      });
      const snapshot = await window.trellis.vault.listIndex(vaultId);
      setNote(result.note);
      replaceWikiIndex({
        notes: snapshot.notes,
        folders: snapshot.folders,
        graph: snapshot.graph
      });
      pushToast({
        title: `${title} saved as a template.`,
        tone: "success",
        noteLinks: [{ label: result.note.title, noteSlug: result.note.slug }]
      });
      return true;
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not save that template.",
        tone: "warning"
      });
      return false;
    }
  }

  function updateNoteActionInMessages(input: {
    sessionId: string;
    messageId: string;
    actionId: string;
    patch: Partial<ChatNoteActionProposal>;
  }): MessageRecord[] {
    const messages = useChatStore.getState().messagesBySession[input.sessionId] ?? [];

    return messages.map((message) => {
      if (message.id !== input.messageId || !message.noteActions) {
        return message;
      }

      return {
        ...message,
        noteActions: message.noteActions.map((action) =>
          action.id === input.actionId
            ? {
                ...action,
                ...input.patch
              }
            : action
        )
      };
    });
  }

  function findNoteAction(messageId: string, actionId: string): ChatNoteActionProposal | null {
    const message = currentMessages.find((item) => item.id === messageId);
    return message?.noteActions?.find((action) => action.id === actionId) ?? null;
  }

  async function persistPatchedNoteAction(input: {
    sessionId: string;
    messageId: string;
    actionId: string;
    patch: Partial<ChatNoteActionProposal>;
  }): Promise<void> {
    const nextMessages = updateNoteActionInMessages(input);
    replaceSessionMessages(input.sessionId, nextMessages);
    await window.trellis.db.replaceMessages({
      sessionId: input.sessionId,
      messages: nextMessages
    });
  }

  function flushNoteActionDraftToDb(sessionId: string): void {
    const messages = useChatStore.getState().messagesBySession[sessionId];
    if (!messages) {
      return;
    }
    void window.trellis.db.replaceMessages({ sessionId, messages });
  }

  function handleNoteActionDraftChange(
    messageId: string,
    actionId: string,
    afterMarkdown: string
  ): void {
    const sessionId = activeSessionId;
    if (!sessionId) {
      return;
    }

    const nextMessages = updateNoteActionInMessages({
      sessionId,
      messageId,
      actionId,
      patch: { afterMarkdown }
    });
    replaceSessionMessages(sessionId, nextMessages);

    const existing = noteActionDraftDbTimersRef.current.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }
    noteActionDraftDbTimersRef.current.set(
      sessionId,
      setTimeout(() => {
        noteActionDraftDbTimersRef.current.delete(sessionId);
        flushNoteActionDraftToDb(sessionId);
      }, 450)
    );
  }

  useEffect(() => {
    return () => {
      const timers = noteActionDraftDbTimersRef.current;
      for (const [sessionId, timerId] of timers) {
        clearTimeout(timerId);
        flushNoteActionDraftToDb(sessionId);
      }
      timers.clear();
    };
  }, []);

  function flushPendingNoteActionDraftForActiveSession(): void {
    if (!activeSessionId) {
      return;
    }
    const pending = noteActionDraftDbTimersRef.current.get(activeSessionId);
    if (pending) {
      clearTimeout(pending);
      noteActionDraftDbTimersRef.current.delete(activeSessionId);
      flushNoteActionDraftToDb(activeSessionId);
    }
  }

  async function handleApproveNoteAction(messageId: string, actionId: string): Promise<void> {
    if (!activeSessionId || busyNoteActionId) {
      return;
    }

    flushPendingNoteActionDraftForActiveSession();

    const action = findNoteAction(messageId, actionId);

    if (!action || action.status !== "pending") {
      return;
    }

    const vaultId = activeSession?.vaultId || activeVault.id;
    setBusyNoteActionId(actionId);

    try {
      const result = await window.trellis.vault.writeNote({
        vaultId,
        slug: action.targetSlug,
        folderPath: action.targetFolderPath,
        title: action.targetTitle,
        content: action.afterMarkdown,
        frontmatter: action.frontmatter
      });
      const snapshot = await window.trellis.vault.listIndex(vaultId);
      setNote(result.note);
      replaceWikiIndex({
        notes: snapshot.notes,
        folders: snapshot.folders,
        graph: snapshot.graph
      });
      await window.trellis.db.recordWikiOps([
        {
          sessionId: activeSessionId,
          file: `${result.note.slug}.md`,
          action: action.kind === "create_note" || action.kind === "create_template"
            ? "create"
            : "rewrite"
        }
      ]);
      await persistPatchedNoteAction({
        sessionId: activeSessionId,
        messageId,
        actionId,
        patch: {
          status: "approved",
          appliedAt: Date.now(),
          errorMessage: undefined
        }
      });
      pushToast({
        title: `${action.targetTitle} saved.`,
        tone: "success",
        noteLinks: [{ label: result.note.title, noteSlug: result.note.slug }]
      });
    } catch (error) {
      await persistPatchedNoteAction({
        sessionId: activeSessionId,
        messageId,
        actionId,
        patch: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Could not save that note."
        }
      });
      pushToast({
        title: error instanceof Error ? error.message : "Could not save that note.",
        tone: "warning"
      });
    } finally {
      setBusyNoteActionId(null);
    }
  }

  async function handleRejectNoteAction(messageId: string, actionId: string): Promise<void> {
    if (!activeSessionId || busyNoteActionId) {
      return;
    }

    flushPendingNoteActionDraftForActiveSession();

    const action = findNoteAction(messageId, actionId);

    if (!action || action.status !== "pending") {
      return;
    }

    setBusyNoteActionId(actionId);

    try {
      await persistPatchedNoteAction({
        sessionId: activeSessionId,
        messageId,
        actionId,
        patch: {
          status: "rejected",
          appliedAt: Date.now()
        }
      });
      pushToast({
        title: "Note change rejected.",
        tone: "success"
      });
    } finally {
      setBusyNoteActionId(null);
    }
  }

  async function handleAddVault(): Promise<void> {
    const entered = window.prompt("Name for the new vault", "");

    if (entered === null) {
      return;
    }

    const trimmed = entered.trim();

    if (!trimmed) {
      pushToast({
        title: "Enter a name for the vault.",
        tone: "warning"
      });
      return;
    }

    try {
      const selectedPath = await window.trellis.vault.selectDirectory();

      if (!selectedPath) {
        return;
      }

      if (settings.vaults.some((vault) => vault.path === selectedPath)) {
        pushToast({
          title: "That folder is already in your vault list.",
          tone: "warning"
        });
        return;
      }

      const nextVault = {
        id: crypto.randomUUID(),
        name: trimmed,
        path: selectedPath
      };

      await onUpdateSettings({
        ...settings,
        vaults: [...settings.vaults, nextVault],
        activeVaultId: nextVault.id
      });

      pushToast({
        title: `${trimmed} added.`,
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not add that vault.",
        tone: "error"
      });
    }
  }

  return (
    <div className="flex h-full flex-col" data-testid="route-chat">
      {chatDisabled && (
        <div
          className={`trellis-accent-surface mx-auto mt-6 w-full ${chatColumnClassName} rounded-panel border border-trellis-accent/20 px-4 py-3 text-sm text-trellis-text`}
          data-testid="chat-auth-banner"
        >
          {isPreviewWorkspace
            ? "Sign in from Settings to continue this seeded workspace with live chat and note extraction."
            : "Sign in from Settings to start chatting with Trellis and grow what you know."}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList
          messages={currentMessages}
          columnClassName={chatColumnClassName}
          existingSlugs={existingSlugs}
          vaultId={activeSession?.vaultId ?? activeVault.id}
          notes={notes}
          messageMetaById={messageMetaById}
          awaitingFirstToken={awaitingFirstToken}
          isStreaming={isStreaming}
          onEditMessage={handleEditMessage}
          onOpenNote={(slug) => {
            void openReferencedNote(slug);
          }}
          onRetryMessage={(messageId) => {
            void handleRetryMessage(messageId);
          }}
          onReadAloud={async (messageId, text) => {
            if (chatDisabled || settings.chat.privacyMode === "local" || !accessToken) {
              return;
            }

            setReadAloudLoadingMessageId(messageId);

            try {
              const spoken = await window.trellis.media.synthesizeSpeech({
                accessToken,
                subscriptionTier,
                text: text.slice(0, 4096)
              });
              const audio = new Audio(
                `data:${spoken.mimeType};base64,${spoken.audioBase64}`
              );
              void audio.play();
            } catch (error) {
              pushToast({
                title: error instanceof Error ? error.message : "Could not play audio.",
                tone: "warning"
              });
            } finally {
              setReadAloudLoadingMessageId(null);
            }
          }}
          readAloudLoadingMessageId={readAloudLoadingMessageId}
          readAloudDisabled={
            chatDisabled || settings.chat.privacyMode === "local" || !accessToken
          }
          onApproveNoteAction={handleApproveNoteAction}
          onRejectNoteAction={handleRejectNoteAction}
          onNoteActionDraftChange={handleNoteActionDraftChange}
          busyNoteActionId={busyNoteActionId}
        />
      </div>
      <div className="trellis-overlay-surface border-t border-trellis-border px-5 pb-4 pt-2 backdrop-blur">
        {editingMessage && (
          <div className={`mx-auto mb-4 w-full ${chatColumnClassName} rounded-field border border-trellis-accent/20 bg-trellis-surface px-4 py-3 text-sm text-trellis-text`}>
            Editing an earlier message will regenerate the conversation from that point.
          </div>
        )}
        <div
          className={`mx-auto flex w-full ${chatColumnClassName} flex-col gap-3 sm:flex-row sm:items-end`}
        >
          <div className="min-w-0 w-full flex-1 sm:min-w-0">
            <InputBar
              disabled={chatDisabled}
              isStreaming={isStreaming}
              model={activeModel}
              subscriptionTier={subscriptionTier}
              providerKeys={providerKeys.statuses}
              notes={notes}
              value={draft}
              submitLabel={editingMessage ? "Save & retry" : "Send"}
              onChange={setDraft}
              onCancel={editingMessage ? cancelEditing : undefined}
              onSelectModel={setActiveModel}
              onSubmit={handleSubmit}
              pendingAttachments={pendingAttachments}
              onRemoveAttachment={(clientId) => {
                setPendingAttachments((current) =>
                  current.filter((attachment) => attachment.clientId !== clientId)
                );
              }}
              onAttachFile={() => {
                void handleAttachFile();
              }}
              onClipPublicUrl={(url) => clipPublicUrl(url)}
              pendingImages={pendingImageAttachments}
              onRemoveImage={(clientId) => {
                setPendingImageAttachments((current) =>
                  current.filter((image) => image.clientId !== clientId)
                );
              }}
              onAttachImage={() => {
                if (!getChatModelMediaCapabilities(activeModel).visionInput) {
                  pushToast({
                    title:
                      "Choose a vision-capable model (for example GPT-4o Mini, GPT-4o, or Claude) to attach images to the chat.",
                    tone: "warning"
                  });
                  return;
                }
                void handleAttachImage();
              }}
              onPasteImage={(input) => {
                void handlePasteImage(input);
              }}
              onAppendDraft={(text) => {
                setDraft((current) => {
                  const separator = current.trim().length === 0
                    ? ""
                    : text.includes("\n") || current.includes("\n")
                      ? "\n\n"
                      : current.endsWith(" ")
                        ? ""
                        : " ";
                  return `${current}${separator}${text}`;
                });
              }}
              onCreateTemplate={handleCreateTemplate}
              onGenerateImageWithPrompt={(prompt) => handleGenerateImageWithPrompt(prompt)}
              privacyLocal={settings.chat.privacyMode === "local"}
              cloudMediaAllowed={!chatDisabled && settings.chat.privacyMode !== "local"}
              visionAllowed={getChatModelMediaCapabilities(activeModel).visionInput}
              speechAllowed={getChatModelMediaCapabilities(activeModel).speechToText}
              imageGenAllowed={getChatModelMediaCapabilities(activeModel).imageGeneration}
              accessToken={accessToken}
              previewWorkspace={workspace.isPreview && isAdmin}
            />
          </div>
          <div className="flex w-full max-w-[200px] shrink-0 flex-col gap-2 self-end sm:w-auto">
            {!activeSessionId && (
              <ChatVaultSelect
                vaults={settings.vaults}
                activeVaultId={settings.activeVaultId}
                disabled={chatDisabled}
                onSelectVault={(vaultId) => {
                  void onUpdateSettings({
                    ...settings,
                    activeVaultId: vaultId
                  });
                }}
                onAddVault={handleAddVault}
              />
            )}
            {features.localExtraction && activeSessionId ? (
              <span
                className={cn(
                  "block w-full",
                  (!canSaveChatToNote || manualNoteCaptureActive) && "cursor-not-allowed"
                )}
              >
                <button
                  type="button"
                  data-testid="chat-save-to-note"
                  disabled={!canSaveChatToNote || manualNoteCaptureActive}
                  aria-busy={manualNoteCaptureActive}
                  title={
                    !canSaveChatToNote
                      ? "Add at least one back-and-forth message before saving to your notes"
                      : manualNoteCaptureActive
                        ? "Processing this chat into notes in the background"
                        : "Turn this conversation into wiki notes now (same as background capture)"
                  }
                  className={cn(
                    "flex w-full shrink-0 items-center justify-center gap-2 rounded-full border px-3 py-2 text-center text-sm transition",
                    canSaveChatToNote && !manualNoteCaptureActive
                      ? "border-trellis-border bg-trellis-surface text-trellis-text hover:border-trellis-accent/35 hover:text-trellis-accent"
                      : "border-trellis-border bg-trellis-surface text-trellis-faint"
                  )}
                  onClick={() => {
                    void handleSaveChatToNote();
                  }}
                >
                  <Sparkles
                    className={cn(
                      "h-4 w-4 shrink-0",
                      manualNoteCaptureActive ? "text-trellis-faint" : "text-trellis-accent"
                    )}
                    aria-hidden
                  />
                  Save to note
                </button>
              </span>
            ) : null}
            <button
              type="button"
              className="w-full shrink-0 rounded-full border border-trellis-border bg-trellis-surface px-3 py-2 text-center text-sm text-trellis-text transition hover:border-trellis-accent/35 hover:text-trellis-accent"
              onClick={handleStartNewChat}
            >
              New chat
            </button>
          </div>
        </div>
        {sessions.length > 0 && currentMessages.length > 0 && (
          <div
            className={`mx-auto mt-3 w-full ${chatColumnClassName} text-xs text-trellis-muted`}
          >
            <p className="min-w-0">
              {activeSession && (
                <>
                  This conversation is writing to {getVaultById(settings, activeSession.vaultId).name}.{" "}
                </>
              )}
              After each assistant reply, Trellis turns this chat into durable notes and
              updates your graph in the background.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
