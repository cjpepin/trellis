import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, LoaderCircle, MessageSquarePlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  type AppFeatureFlags,
  type AppSettings,
  type ChatContextPacket,
  type WorkspaceInfo,
  type ChatAttachment,
  type ChatMediaArtifact,
  type ChatModel,
  type ChatNoteActionProposal,
  type ExtractionJobNotification,
  type IngestedDraft,
  type MessageRecord,
  type QueueSessionExtractionResult
} from "@electron/ipc/types";
import { getChatModelMediaCapabilities } from "@shared/chat/capabilities";
import { messageLikelyExpectsVaultContextForChat } from "@shared/chat/privacyVaultIntent";
import { buildChatReplyContext } from "@shared/chat/replyContext";
import { normalizeReadAloudSpeedTier } from "@shared/media/readAloudSpeed";
import { ChatContextGraphPanel } from "@/components/chat/ChatContextGraphPanel";
import { ChatVaultSelect } from "@/components/chat/ChatVaultSelect";
import { ChatTranscriptFindBar } from "@/components/chat/ChatTranscriptFindBar";
import { InputBar } from "@/components/chat/InputBar";
import { MessageList } from "@/components/chat/MessageList";
import { useApplyExtraction } from "@/hooks/useApplyExtraction";
import { extractIngestedSource, type ChatNoteReference } from "@/lib/api";
import {
  routingSignalsFromUserMessage,
  selectChatModelForImageGeneration,
  selectChatModelForRequest,
  type ChatModelRoutingSignals
} from "@/lib/chatModelRouting";
import {
  collectIngestDrafts,
  formatMessageForApi,
  maxChatComposerAttachments,
  toChatAttachments,
  type PendingChatAttachment,
  type PendingImageAttachment
} from "@/lib/chatAttachments";
import { buildTranscriptFindMatches } from "@/lib/chatTranscriptFind";
import { buildExtractionIndex } from "@/lib/extractionIndex";
import { relatedNotesRetrievalDefaultLimit } from "@shared/extraction/config";
import { useChatScrollFollow } from "@/hooks/useChatScrollFollow";
import { getChatStreamToastCopy, useStream } from "@/hooks/useStream";
import {
  maxParallelChatRuns,
  parallelChatLimitMessage,
  type ChatRunAttention
} from "@/lib/chatRunState";
import {
  getActiveVault,
  getVaultById,
  resolveExtractionModeForSubscription
} from "@/lib/settings";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { notesRoutePath } from "@/lib/noteRoutes";
import { formatChatTranscriptForClipboard } from "@/lib/chatClipboard";
import { cn } from "@/lib/utils";
import { buildContextSubgraph, collectChatContextNoteSlugs } from "@/lib/chatContextGraph";
import { useWikiStore } from "@/store/wikiStore";
import { PcmStreamPlayback } from "@/lib/pcmStreamPlayback";

/** IPC may deserialize errors without preserving `instanceof Error` / `.name`. */
function isReadAloudUserCancelError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return true;
    }
    if (error.message.includes("Read aloud was stopped")) {
      return true;
    }
  }
  if (typeof error === "object" && error !== null) {
    const rec = error as { name?: unknown; message?: unknown };
    if (rec.name === "AbortError") {
      return true;
    }
    if (typeof rec.message === "string" && rec.message.includes("Read aloud was stopped")) {
      return true;
    }
  }
  return false;
}

function formatExtractionJobStatus(job: ExtractionJobNotification): string {
  switch (job.status) {
    case "pending":
      return "Queued";
    case "running":
      return "Adding";
    case "completed":
      if (job.appliedNotes && job.appliedNotes.length > 0) {
        return `${job.appliedNotes.length} note${job.appliedNotes.length === 1 ? "" : "s"}`;
      }
      if (job.appliedUpdateCount > 0) {
        return `${job.appliedUpdateCount} update${job.appliedUpdateCount === 1 ? "" : "s"}`;
      }
      return "Up to date";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return job.status;
  }
}

function formatExtractionJobTrigger(job: ExtractionJobNotification): string {
  switch (job.trigger) {
    case "manual":
      return "Manual save";
    case "session-switch":
      return "Session switch";
    case "startup":
      return "Resumed";
    case "idle":
    default:
      return "Background sync";
  }
}

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
  /** Wiki notes explicitly pinned in the composer for stronger retrieval (session-local). */
  const [pinnedWikiNotes, setPinnedWikiNotes] = useState<Array<{ slug: string; title: string }>>([]);
  /** Mini context graph rail: collapsed by default per session. */
  const [contextGraphCollapsed, setContextGraphCollapsed] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [readAloudActiveMessageId, setReadAloudActiveMessageId] = useState<string | null>(null);
  /** True until the first PCM chunk arrives for the current read-aloud session (loading state). */
  const [readAloudAwaitingFirstChunk, setReadAloudAwaitingFirstChunk] = useState(false);
  const readAloudPlaybackRef = useRef<PcmStreamPlayback | null>(null);
  const readAloudStreamGenRef = useRef(0);
  const [busyNoteActionId, setBusyNoteActionId] = useState<string | null>(null);
  const [extractionJobsBySession, setExtractionJobsBySession] = useState<
    Record<string, ExtractionJobNotification>
  >({});
  const [extractionRecentJobs, setExtractionRecentJobs] = useState<ExtractionJobNotification[]>([]);
  const [extractionQueueOpen, setExtractionQueueOpen] = useState(false);
  const extractionQueuePopoverRef = useRef<HTMLDivElement | null>(null);
  const [transcriptFindOpen, setTranscriptFindOpen] = useState(false);
  const [transcriptFindQuery, setTranscriptFindQuery] = useState("");
  const [transcriptFindMatchIdx, setTranscriptFindMatchIdx] = useState(0);
  const accessToken = useAuthStore((state) => state.accessToken);
  const authStatus = useAuthStore((state) => state.status);
  const subscriptionTier = useAuthStore((state) => state.subscriptionTier);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const providerKeys = useAuthStore((state) => state.providerKeys);
  const notes = useWikiStore((state) => state.notes);
  const graph = useWikiStore((state) => state.graph);
  const activeNoteSlug = useWikiStore((state) => state.activeNoteSlug);
  const setNote = useWikiStore((state) => state.setNote);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
  const replaceWikiIndex = useWikiStore((state) => state.replaceIndex);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const setActiveSession = useChatStore((state) => state.setActiveSession);
  const messagesBySession = useChatStore((state) => state.messagesBySession);
  const setSessionMessages = useChatStore((state) => state.setSessionMessages);
  const chatRunsBySession = useChatStore((state) => state.chatRunsBySession);
  const startChatRun = useChatStore((state) => state.startChatRun);
  const finishChatRun = useChatStore((state) => state.finishChatRun);
  const upsertSession = useChatStore((state) => state.upsertSession);
  const messageMetaById = useChatStore((state) => state.messageMetaById);
  const replaceSessionMessages = useChatStore((state) => state.replaceSessionMessages);
  const setMessageMeta = useChatStore((state) => state.setMessageMeta);
  const clearMessageMeta = useChatStore((state) => state.clearMessageMeta);
  const pushToast = useUiStore((state) => state.pushToast);
  const stopReadAloud = useCallback(async () => {
    readAloudStreamGenRef.current += 1;
    await window.trellis.media.cancelSynthesizeSpeechStream();
    const playback = readAloudPlaybackRef.current;
    readAloudPlaybackRef.current = null;
    if (playback) {
      await playback.stop();
    }
    setReadAloudActiveMessageId(null);
    setReadAloudAwaitingFirstChunk(false);
  }, []);
  const streamAssistant = useStream({
    accessToken,
    privacyMode: settings.chat.privacyMode,
    subscriptionTier,
    previewWorkspace: workspace.isPreview
  });
  const previousSessionId = useRef<string | null>(activeSessionId);
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
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
  const activeSessionChatRun = activeSessionId ? chatRunsBySession[activeSessionId] ?? null : null;
  const activeSessionRunning = Boolean(activeSessionChatRun);
  const activeExtractionJobs = useMemo(
    () =>
      Object.values(extractionJobsBySession)
        .filter((job) => job.status === "pending" || job.status === "running")
        .sort((left, right) => left.createdAt - right.createdAt),
    [extractionJobsBySession]
  );
  const extractionSessionTitleById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session.title] as const)),
    [sessions]
  );
  const sessionExtractionBusy = Boolean(
    activeSessionId &&
      activeExtractionJobs.some((job) => job.sessionId === activeSessionId)
  );
  const extractionQueueTooltip = sessionExtractionBusy
    ? activeExtractionJobs.filter((job) => job.sessionId === activeSessionId).length > 1
      ? `${activeExtractionJobs.filter((job) => job.sessionId === activeSessionId).length} Strand jobs for this chat`
      : activeExtractionJobs.find((job) => job.sessionId === activeSessionId)?.status === "pending"
        ? "Queued for Strands"
        : "Adding to Strands"
    : "Recent Strands activity — click to view";
  const awaitingFirstToken = Boolean(activeSessionChatRun?.awaitingFirstToken);
  const runningChatCount = Object.keys(chatRunsBySession).length;
  const parallelChatLimitReached = runningChatCount >= maxParallelChatRuns;
  const composerBusyForLimit = parallelChatLimitReached && !activeSessionRunning;
  const composerBusyReason = composerBusyForLimit ? parallelChatLimitMessage : undefined;
  const newChatDisabled = parallelChatLimitReached;
  const chatScrollContentSignature = useMemo(() => {
    const lastMessage = currentMessages.at(-1);

    return `${lastMessage?.id ?? "none"}:${lastMessage?.content.length ?? 0}:${awaitingFirstToken ? "1" : "0"}`;
  }, [currentMessages, awaitingFirstToken]);
  const { onScroll: onChatScrollContainerScroll } = useChatScrollFollow({
    scrollRef: chatScrollContainerRef,
    contentSignature: chatScrollContentSignature,
    followResponsesEnabled: settings.chat.scrollWithResponse ?? true,
    sessionKey: activeSessionId
  });
  const editingMessage = useMemo(
    () => currentMessages.find((message) => message.id === editingMessageId) ?? null,
    [currentMessages, editingMessageId]
  );

  useEffect(() => {
    setPinnedWikiNotes([]);
    setContextGraphCollapsed(true);
  }, [activeSessionId]);

  useEffect(() => {
    if (activeExtractionJobs.length === 0) {
      setExtractionQueueOpen(false);
    }
  }, [activeExtractionJobs.length]);

  useEffect(() => {
    if (!extractionQueueOpen || !features.localExtraction) {
      return;
    }

    const root = extractionQueuePopoverRef.current;

    if (!root) {
      return;
    }

    function onFocusOut(event: FocusEvent): void {
      const anchor = extractionQueuePopoverRef.current;
      const next = event.relatedTarget;

      if (!anchor) {
        return;
      }

      if (next instanceof Node && anchor.contains(next)) {
        return;
      }

      setExtractionQueueOpen(false);
    }

    function onPointerDown(event: PointerEvent): void {
      const anchor = extractionQueuePopoverRef.current;

      if (!anchor || anchor.contains(event.target as Node)) {
        return;
      }

      setExtractionQueueOpen(false);
    }

    root.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [extractionQueueOpen, features.localExtraction]);

  useEffect(() => {
    setTranscriptFindOpen(false);
    setTranscriptFindQuery("");
    setTranscriptFindMatchIdx(0);
  }, [activeSessionId]);

  const transcriptFindMatches = useMemo(
    () => buildTranscriptFindMatches(currentMessages, transcriptFindQuery),
    [currentMessages, transcriptFindQuery]
  );

  const transcriptFindSafeIdx =
    transcriptFindMatches.length === 0
      ? 0
      : Math.min(transcriptFindMatchIdx, transcriptFindMatches.length - 1);

  const transcriptFindActive =
    transcriptFindMatches.length > 0 ? transcriptFindMatches[transcriptFindSafeIdx] : null;

  useEffect(() => {
    if (transcriptFindMatches.length === 0) {
      return;
    }
    if (transcriptFindMatchIdx > transcriptFindMatches.length - 1) {
      setTranscriptFindMatchIdx(transcriptFindMatches.length - 1);
    }
  }, [transcriptFindMatchIdx, transcriptFindMatches.length]);

  useEffect(() => {
    if (!transcriptFindOpen || !transcriptFindActive) {
      return;
    }

    const el = document.querySelector(
      `[data-chat-message-id="${CSS.escape(transcriptFindActive.messageId)}"]`
    );

    if (!(el instanceof HTMLElement)) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }, [
    transcriptFindOpen,
    transcriptFindActive?.messageId,
    transcriptFindActive?.start,
    transcriptFindActive?.end
  ]);

  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "f") {
        e.preventDefault();
        setTranscriptFindOpen(true);
        return;
      }

      if (e.key === "Escape" && transcriptFindOpen) {
        e.preventDefault();
        setTranscriptFindOpen(false);
        return;
      }

      if (transcriptFindOpen && mod && e.key === "g") {
        e.preventDefault();
        if (transcriptFindMatches.length === 0) {
          return;
        }
        setTranscriptFindMatchIdx((current) => {
          if (transcriptFindMatches.length === 0) {
            return 0;
          }
          if (e.shiftKey) {
            return (current - 1 + transcriptFindMatches.length) % transcriptFindMatches.length;
          }
          return (current + 1) % transcriptFindMatches.length;
        });
      }
    }

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", onGlobalKeyDown);
    };
  }, [transcriptFindOpen, transcriptFindMatches]);

  const chatContextNoteSlugs = useMemo(
    () =>
      collectChatContextNoteSlugs({
        messages: currentMessages,
        notes,
        pinnedWikiNotes
      }),
    [currentMessages, notes, pinnedWikiNotes]
  );

  const chatContextSubgraph = useMemo(
    () => buildContextSubgraph(graph, chatContextNoteSlugs),
    [chatContextNoteSlugs, graph]
  );

  const showChatContextGraph = chatContextSubgraph.nodes.length > 0;

  const toggleWikiComposerPin = useCallback((slug: string, title: string) => {
    setPinnedWikiNotes((current) => {
      const exists = current.some((note) => note.slug === slug);

      if (exists) {
        return current.filter((note) => note.slug !== slug);
      }

      return [...current, { slug, title }];
    });
  }, []);

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

  const chatModelAccessOptions = useMemo(
    () => ({
      previewWorkspace: workspace.isPreview && isAdmin,
      isAdmin
    }),
    [isAdmin, workspace.isPreview]
  );

  const composerRoutingSignals: ChatModelRoutingSignals = useMemo(() => {
    const hasVision =
      pendingImageAttachments.length > 0 ||
      Boolean(editingMessage?.mediaArtifacts?.some((artifact) => artifact.kind === "image"));

    return {
      userTextLength: draft.trim().length,
      transcriptMessageCount: editingMessageId ? currentMessages.length : currentMessages.length + 1,
      hasVisionInTurn: hasVision,
      nonImageAttachmentCount: pendingAttachments.length
    };
  }, [
    currentMessages.length,
    draft,
    editingMessage,
    editingMessageId,
    pendingAttachments.length,
    pendingImageAttachments.length
  ]);

  const composerRoutedModel = useMemo(
    () =>
      selectChatModelForRequest(
        subscriptionTier,
        providerKeys.statuses,
        composerRoutingSignals,
        chatModelAccessOptions
      ),
    [chatModelAccessOptions, composerRoutingSignals, providerKeys.statuses, subscriptionTier]
  );

  useEffect(() => {
    return window.trellis.extraction.onJobUpdate((notification) => {
      setExtractionJobsBySession((current) => {
        if (notification.status === "pending" || notification.status === "running") {
          return {
            ...current,
            [notification.sessionId]: notification
          };
        }

        const { [notification.sessionId]: _done, ...rest } = current;
        return rest;
      });

      if (
        notification.status === "completed" ||
        notification.status === "failed" ||
        notification.status === "skipped"
      ) {
        setExtractionRecentJobs((hist) => {
          const next = [notification, ...hist.filter((job) => job.id !== notification.id)];
          return next.slice(0, 12);
        });
      }
    });
  }, []);

  const queueExtraction = useCallback(
    async (
      sessionId: string,
      trigger: "idle" | "session-switch",
      options?: { force?: boolean }
    ): Promise<QueueSessionExtractionResult | null> => {
      try {
        const result = await window.trellis.extraction.queueSession({
          sessionId,
          trigger,
          mode: resolveExtractionModeForSubscription(settings.extraction.mode, subscriptionTier),
          preferredLocalModelId: settings.extraction.preferredLocalModelId ?? undefined,
          force: options?.force ?? false
        });

        const queuedJob = result.job;

        if (
          queuedJob &&
          (queuedJob.status === "pending" || queuedJob.status === "running")
        ) {
          setExtractionJobsBySession((current) => ({
            ...current,
            [queuedJob.sessionId]: queuedJob
          }));
        }

        return result;
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

  /** Skips IPC when on-device extraction is disabled. */
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

  const queueIdleExtraction = useCallback(
    (sessionId: string) => {
      void maybeQueueSessionExtraction(sessionId, "idle");
    },
    [maybeQueueSessionExtraction]
  );

  const applyExtractionComposer = useApplyExtraction();
  const flushComposerSourceIngest = useCallback(
    async (drafts: IngestedDraft[], sessionId: string | null, vaultId: string) => {
      if (drafts.length === 0) {
        return;
      }

      for (const draft of drafts) {
        try {
          const relatedNotes = await window.trellis.retrieval.searchNotes({
            query: draft.content,
            limit: relatedNotesRetrievalDefaultLimit
          });
          const index = buildExtractionIndex(useWikiStore.getState().graph);
          const response = await extractIngestedSource({
            accessToken,
            index,
            transcript: [],
            relatedNotes,
            mode: resolveExtractionModeForSubscription(settings.extraction.mode, subscriptionTier),
            preferredLocalModelId: settings.extraction.preferredLocalModelId,
            sourceType: draft.sourceType,
            sourceTitle: draft.title,
            sourcePath: draft.sourcePath,
            sourceContent: draft.content,
            onProgress: () => {}
          });
          await applyExtractionComposer(response, { sessionId: sessionId ?? undefined, vaultId });
        } catch (error) {
          pushToast({
            title:
              error instanceof Error
                ? error.message
                : "Trellis couldn’t process an attached source.",
            tone: "error"
          });
        }
      }
    },
    [
      accessToken,
      applyExtractionComposer,
      pushToast,
      settings.extraction.mode,
      settings.extraction.preferredLocalModelId,
      subscriptionTier
    ]
  );

  useEffect(() => {
    if (
      previousSessionId.current &&
      previousSessionId.current !== activeSessionId &&
      !useChatStore.getState().chatRunsBySession[previousSessionId.current]
    ) {
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
          title: "That Strand is not available in this vault yet.",
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
          title: error instanceof Error ? error.message : "Could not open that Strand.",
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
      options?: { currentSessionId?: string | null; activeNoteSlug?: string | null }
    ): Promise<ChatContextPacket> => {
      const contextActiveNoteSlug =
        options?.activeNoteSlug !== undefined ? options.activeNoteSlug : activeNoteSlug;

      return window.trellis.chat.buildContext({
        mode: settings.chat.privacyMode,
        vaultId,
        activeNoteSlug: contextActiveNoteSlug,
        sessionTitle: activeSession?.title ?? null,
        currentSessionId: options?.currentSessionId ?? null,
        pinnedNoteSlugs: pinnedWikiNotes.map((note) => note.slug),
        messages
      });
    },
    [activeNoteSlug, activeSession?.title, pinnedWikiNotes, settings.chat.privacyMode]
  );

  function buildRetryTranscript(
    sessionId: string,
    targetMessageId: string | undefined,
    nextContent: string | undefined,
    nextAttachments: ChatAttachment[] | undefined,
    nextMediaArtifacts: ChatMediaArtifact[] | undefined,
    composerPins?: Array<{ slug: string; title: string }>
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
          : {}),
        ...(composerPins && composerPins.length > 0 ? { composerPins } : {})
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
      createdAt: Date.now(),
      ...(composerPins && composerPins.length > 0 ? { composerPins } : {})
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
    mediaPayload?: ChatMediaArtifact[],
    ingestDrafts: IngestedDraft[] = []
  ): Promise<void> {
    let optimisticUserMessage: MessageRecord | null = null;
    let sessionId = activeSessionId;
    let createdSessionThisSend = false;
    let runStarted = false;
    let finishAttention: ChatRunAttention | null = null;
    const sessionVaultId = activeSession?.vaultId || activeVault.id;

    try {
      if (!sessionId && useChatStore.getState().getRunningChatRunCount() >= maxParallelChatRuns) {
        pushToast({
          title: parallelChatLimitMessage,
          tone: "warning"
        });
        return;
      }

      const priorForEstimate = activeSessionId
        ? useChatStore.getState().messagesBySession[activeSessionId] ?? []
        : [];
      const estimateSignals: ChatModelRoutingSignals = {
        userTextLength: value.trim().length,
        transcriptMessageCount: targetMessageId
          ? priorForEstimate.length
          : priorForEstimate.length + 1,
        hasVisionInTurn: mediaPayload?.some((artifact) => artifact.kind === "image") ?? false,
        nonImageAttachmentCount: attachmentPayload?.length ?? 0
      };
      const sessionSeedModel = selectChatModelForRequest(
        subscriptionTier,
        providerKeys.statuses,
        estimateSignals,
        chatModelAccessOptions
      );

      if (!sessionId) {
        const session = await window.trellis.db.createSession({
          model: sessionSeedModel,
          vaultId: activeVault.id
        });
        sessionId = session.id;
        createdSessionThisSend = true;
        setActiveSession(session.id);
        upsertSession(session);
      }

      const priorMessages = useChatStore.getState().messagesBySession[sessionId] ?? [];
      const omitActiveNoteForFirstTurn =
        !targetMessageId && priorMessages.length === 0 && pinnedWikiNotes.length === 0;

      let { baseMessages, userMessage } = buildRetryTranscript(
        sessionId,
        targetMessageId,
        value,
        attachmentPayload,
        mediaPayload,
        targetMessageId ? undefined : pinnedWikiNotes
      );
      const runModel = selectChatModelForRequest(
        subscriptionTier,
        providerKeys.statuses,
        routingSignalsFromUserMessage(baseMessages, userMessage),
        chatModelAccessOptions
      );

      if (createdSessionThisSend && runModel !== sessionSeedModel) {
        const updatedSession = await window.trellis.db.updateSession({
          id: sessionId,
          model: runModel
        });
        upsertSession(updatedSession);
      }

      const existingRuns = useChatStore.getState().chatRunsBySession;
      if (existingRuns[sessionId]) {
        pushToast({
          title: "Wait for this chat to finish before sending another message.",
          tone: "warning"
        });
        return;
      }

      if (Object.keys(existingRuns).length >= maxParallelChatRuns) {
        pushToast({
          title: parallelChatLimitMessage,
          tone: "warning"
        });
        return;
      }

      runStarted = startChatRun({ sessionId });
      if (!runStarted) {
        pushToast({
          title: parallelChatLimitMessage,
          tone: "warning"
        });
        return;
      }

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
            activeNoteSlug: omitActiveNoteForFirstTurn ? null : activeNoteSlug,
            pinnedNoteSlugs: pinnedWikiNotes.map((note) => note.slug),
            messages: baseMessages.map((message) => ({
              id: message.id,
              role: message.role,
              content: formatMessageForApi(message)
            }))
          });

          const isChatNoteActionReview =
            proposal.actions.length > 0 &&
            proposal.actions.every(
              (action) => action.kind === "create_note" || action.kind === "update_note"
            );

          if (isChatNoteActionReview || proposal.clarification) {
            const defaultReviewCopy =
              "Here’s a proposed wiki note change. Review the diff and approve to save it to your vault.";
            const assistantMessage: MessageRecord = {
              id: crypto.randomUUID(),
              sessionId,
              role: "assistant",
              content: proposal.clarification ?? defaultReviewCopy,
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
              model: runModel
            });
            upsertSession(updatedSession);
            setPendingAttachments([]);
            setPendingImageAttachments([]);
            queueIdleExtraction(sessionId);
            finishAttention = "ready";
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
          {
            currentSessionId: sessionId,
            ...(omitActiveNoteForFirstTurn ? { activeNoteSlug: null } : {})
          }
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

      if (settings.chat.privacyMode === "off") {
        const userTextForIntent = formatMessageForApi(userMessage);
        const likelyWantsVault =
          messageLikelyExpectsVaultContextForChat(userTextForIntent) || pinnedWikiNotes.length > 0;

        if (likelyWantsVault) {
          pushToast({
            title:
              "Chat privacy is Off, so wiki excerpts and pinned notes are not sent to the cloud model. Replies may miss your vault. Set Chat privacy to Auto or Local in Settings when you want answers grounded in your notes.",
            tone: "warning",
            durationMs: 5200
          });
        }
      }

      const streamResult = await streamAssistant(
        sessionId,
        baseMessages,
        contextPacket.references as ChatNoteReference[],
        runModel,
        {
          onFirstAssistantToken: () => clearMessageMeta(userMessage.id)
        }
      );

      if (!streamResult.assistantMessage) {
        setMessageMeta(userMessage.id, {
          status: "failed",
          errorMessage: streamResult.failureMessage ?? "Not sent"
        });
        finishAttention = "needs_attention";
        return;
      }

      if (streamResult.failureMessage) {
        setMessageMeta(userMessage.id, {
          status: "failed",
          errorMessage: streamResult.failureMessage
        });
      } else {
        clearMessageMeta(userMessage.id);
      }
      const replyContextForAssistant = buildChatReplyContext(
        contextPacket,
        pinnedWikiNotes.map((note) => note.slug),
        { activeNoteSlug: omitActiveNoteForFirstTurn ? null : activeNoteSlug }
      );

      const assistantForPersistence: MessageRecord = replyContextForAssistant
        ? { ...streamResult.assistantMessage, replyContext: replyContextForAssistant }
        : streamResult.assistantMessage;
      const nextMessages = [...baseMessages, assistantForPersistence];
      let persistedMessages = nextMessages;

      if (!targetMessageId) {
        try {
          const proposal = await window.trellis.chat.proposeNoteActions({
            mode: settings.chat.privacyMode,
            phase: "post_response",
            vaultId: sessionVaultId,
            activeNoteSlug,
            pinnedNoteSlugs: pinnedWikiNotes.map((note) => note.slug),
            messages: nextMessages.map((message) => ({
              id: message.id,
              role: message.role,
              content: formatMessageForApi(message)
            }))
          });

          const isPostWikiNoteActionReview =
            proposal.actions.length > 0 &&
            proposal.actions.every(
              (action) => action.kind === "create_note" || action.kind === "update_note"
            );

          if (isPostWikiNoteActionReview) {
            persistedMessages = nextMessages.map((message) =>
              message.id === streamResult.assistantMessage?.id
                ? {
                    ...message,
                    content:
                      "I drafted a wiki note update and queued it for review. Make any final edits below, then approve to save it to your vault.",
                    noteActions: proposal.actions
                  }
                : message
            );
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

      replaceSessionMessages(sessionId, persistedMessages);
      const persistedAssistantMessage =
        persistedMessages.find((message) => message.id === streamResult.assistantMessage?.id) ??
        streamResult.assistantMessage;
      if (
        settings.chat.readAloudAutoPlay &&
        persistedAssistantMessage.content.trim().length > 0 &&
        settings.chat.privacyMode !== "local" &&
        accessToken &&
        useChatStore.getState().activeSessionId === sessionId
      ) {
        const assistantId = persistedAssistantMessage.id;
        const myGen = ++readAloudStreamGenRef.current;
        try {
          const previousPlayback = readAloudPlaybackRef.current;
          readAloudPlaybackRef.current = null;
          if (previousPlayback) {
            await previousPlayback.stop();
          }
          setReadAloudActiveMessageId(assistantId);
          setReadAloudAwaitingFirstChunk(true);
          const playback = new PcmStreamPlayback();
          readAloudPlaybackRef.current = playback;
          await playback.ensureRunning();
          const text = persistedAssistantMessage.content.slice(0, 4096);
          let heardFirstChunk = false;
          await window.trellis.media.synthesizeSpeechStream(
            {
              accessToken,
              subscriptionTier,
              text,
              readAloudSpeed: normalizeReadAloudSpeedTier(settings.chat.readAloudSpeed)
            },
            (chunk) => {
              if (myGen !== readAloudStreamGenRef.current) {
                return;
              }
              if (!heardFirstChunk) {
                heardFirstChunk = true;
                setReadAloudAwaitingFirstChunk(false);
              }
              playback.append(chunk);
            }
          );
          playback.finish();
        } catch (error: unknown) {
          if (!isReadAloudUserCancelError(error)) {
            // Optional: ignore other auto read-aloud failures
          }
          // Do not return: persistence and background extraction must still run below.
        } finally {
          setReadAloudActiveMessageId((id) => (id === assistantId ? null : id));
          setReadAloudAwaitingFirstChunk(false);
        }
      }
      await window.trellis.db.replaceMessages({
        sessionId,
        messages: persistedMessages
      });
      void window.trellis.chat.storeMemory({
        vaultId: sessionVaultId,
        sessionId,
        messages: persistedMessages
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
        model: runModel
      });
      upsertSession(updatedSession);
      queueIdleExtraction(sessionId);
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
      finishAttention = streamResult.failureMessage ? "needs_attention" : "ready";
    } catch (error) {
      finishAttention = "needs_attention";
      if (optimisticUserMessage && sessionId) {
        setMessageMeta(optimisticUserMessage.id, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Not sent"
        });
      }
      if (!optimisticUserMessage || !sessionId) {
        pushToast({
          title: error instanceof Error ? error.message : "Could not send that message.",
          tone: "error"
        });
      }
    } finally {
      if (ingestDrafts.length > 0 && sessionId && optimisticUserMessage) {
        void flushComposerSourceIngest(ingestDrafts, sessionId, sessionVaultId);
      }
      if (runStarted && sessionId) {
        const finishedInBackground =
          finishAttention !== null && useChatStore.getState().activeSessionId !== sessionId;
        finishChatRun(sessionId, finishAttention);

        if (finishedInBackground) {
          pushToast({
            title:
              finishAttention === "ready"
                ? "A background chat is ready."
                : `A background chat needs attention. ${
                    getChatStreamToastCopy(
                      optimisticUserMessage
                        ? useChatStore.getState().messageMetaById[optimisticUserMessage.id]
                            ?.errorMessage ?? ""
                        : ""
                    )
                  }`.trim(),
            tone: finishAttention === "ready" ? "success" : "warning"
          });
        }
      }
    }
  }

  async function handleSubmit(value: string): Promise<void> {
    const trimmed = value.trim();
    const ingestDrafts = collectIngestDrafts(pendingAttachments);
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

    if (composerBusyForLimit) {
      pushToast({
        title: parallelChatLimitMessage,
        tone: "warning"
      });
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
      !getChatModelMediaCapabilities(composerRoutedModel).visionInput
    ) {
      pushToast({
        title:
          "Images are not available for this composer state or plan. Remove images or adjust attachments.",
        tone: "warning"
      });
      return;
    }

    const mediaForSend = editingMessageId
      ? mediaFromImages
      : mediaFromImages.length > 0
        ? mediaFromImages
        : undefined;

    await sendMessage(trimmed, editingMessageId ?? undefined, payload, mediaForSend, ingestDrafts);
  }

  async function handleAttachFile(): Promise<void> {
    if (pendingAttachments.length + pendingImageAttachments.length >= maxChatComposerAttachments) {
      pushToast({
        title: `You can attach up to ${maxChatComposerAttachments} items per message.`,
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
          text: result.text,
          ...(result.ingestDraft ? { ingestDraft: result.ingestDraft } : {})
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
    if (pendingAttachments.length + pendingImageAttachments.length >= maxChatComposerAttachments) {
      pushToast({
        title: `You can attach up to ${maxChatComposerAttachments} items per message.`,
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
          sourceUrl: clipped.sourcePath,
          ingestDraft: {
            title: clipped.title,
            content: clipped.content,
            sourcePath: clipped.sourcePath,
            sourceType: "web" as const
          }
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
      message.mediaArtifacts?.filter((artifact) => artifact.kind === "image"),
      []
    );
  }

  function cancelEditing(): void {
    setEditingMessageId(null);
    setDraft("");
    setPendingAttachments([]);
    setPendingImageAttachments([]);
  }

  async function handleCopyChatToClipboard(): Promise<void> {
    if (!activeSessionId || currentMessages.length === 0) {
      return;
    }

    const text = formatChatTranscriptForClipboard(currentMessages, activeSession?.title ?? null);

    try {
      await navigator.clipboard.writeText(text);
      pushToast({
        title: "Chat copied to clipboard.",
        tone: "success"
      });
    } catch (error: unknown) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not copy to clipboard.",
        tone: "warning"
      });
    }
  }

  function handleStartNewChat(): void {
    if (useChatStore.getState().getRunningChatRunCount() >= maxParallelChatRuns) {
      pushToast({
        title: parallelChatLimitMessage,
        tone: "warning"
      });
      return;
    }

    setEditingMessageId(null);
    setDraft("");
    setPendingAttachments([]);
    setPendingImageAttachments([]);
    setActiveSession(null);
    navigate("/chat");
  }

  async function handlePasteImage(input: { base64: string; mimeType: string }): Promise<void> {
    if (pendingAttachments.length + pendingImageAttachments.length >= maxChatComposerAttachments) {
      pushToast({
        title: `You can attach up to ${maxChatComposerAttachments} items per message.`,
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
    if (pendingAttachments.length + pendingImageAttachments.length >= maxChatComposerAttachments) {
      pushToast({
        title: `You can attach up to ${maxChatComposerAttachments} items per message.`,
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

    const imageRouteModel = selectChatModelForImageGeneration(
      subscriptionTier,
      providerKeys.statuses,
      chatModelAccessOptions
    );

    if (!getChatModelMediaCapabilities(imageRouteModel).imageGeneration) {
      pushToast({
        title: "Image generation is not available for your current plan or provider setup.",
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
          model: imageRouteModel,
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
        model: imageRouteModel
      });
      upsertSession(updatedSession);
      queueIdleExtraction(sessionId);
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
        frontmatter: action.frontmatter,
        strandRevision: { actor: "trellis", sessionId: activeSessionId }
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
          action: action.kind === "create_note" ? "create" : "rewrite"
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
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="order-2 flex min-h-0 min-w-0 flex-1 flex-col lg:order-1">
          <ChatTranscriptFindBar
            open={transcriptFindOpen}
            columnClassName={chatColumnClassName}
            query={transcriptFindQuery}
            onQueryChange={(value) => {
              setTranscriptFindQuery(value);
              setTranscriptFindMatchIdx(0);
            }}
            onClose={() => {
              setTranscriptFindOpen(false);
            }}
            matchIndex={transcriptFindSafeIdx}
            matchCount={transcriptFindMatches.length}
            onNext={() => {
              if (transcriptFindMatches.length === 0) {
                return;
              }
              setTranscriptFindMatchIdx((i) => (i + 1) % transcriptFindMatches.length);
            }}
            onPrevious={() => {
              if (transcriptFindMatches.length === 0) {
                return;
              }
              setTranscriptFindMatchIdx(
                (i) => (i - 1 + transcriptFindMatches.length) % transcriptFindMatches.length
              );
            }}
          />
          <div
            ref={chatScrollContainerRef}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={onChatScrollContainerScroll}
          >
        <MessageList
          messages={currentMessages}
          columnClassName={chatColumnClassName}
          existingSlugs={existingSlugs}
          vaultId={activeSession?.vaultId ?? activeVault.id}
          notes={notes}
          messageMetaById={messageMetaById}
          awaitingFirstToken={awaitingFirstToken}
          isStreaming={activeSessionRunning}
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

            if (readAloudActiveMessageId === messageId) {
              await stopReadAloud();
              return;
            }

            const myGen = ++readAloudStreamGenRef.current;
            setReadAloudActiveMessageId(messageId);
            setReadAloudAwaitingFirstChunk(true);

            try {
              const previousPlayback = readAloudPlaybackRef.current;
              readAloudPlaybackRef.current = null;
              if (previousPlayback) {
                await previousPlayback.stop();
              }
              const playback = new PcmStreamPlayback();
              readAloudPlaybackRef.current = playback;
              await playback.ensureRunning();
              let heardFirstChunk = false;
              await window.trellis.media.synthesizeSpeechStream(
                {
                  accessToken,
                  subscriptionTier,
                  text: text.slice(0, 4096),
                  readAloudSpeed: normalizeReadAloudSpeedTier(settings.chat.readAloudSpeed)
                },
                (chunk) => {
                  if (myGen !== readAloudStreamGenRef.current) {
                    return;
                  }
                  if (!heardFirstChunk) {
                    heardFirstChunk = true;
                    setReadAloudAwaitingFirstChunk(false);
                  }
                  playback.append(chunk);
                }
              );
              playback.finish();
            } catch (error: unknown) {
              if (isReadAloudUserCancelError(error)) {
                return;
              }
              pushToast({
                title: error instanceof Error ? error.message : "Could not play audio.",
                tone: "warning"
              });
            } finally {
              setReadAloudActiveMessageId((id) => (id === messageId ? null : id));
              setReadAloudAwaitingFirstChunk(false);
            }
          }}
          readAloudActiveMessageId={readAloudActiveMessageId}
          readAloudAwaitingFirstChunk={readAloudAwaitingFirstChunk}
          readAloudDisabled={
            chatDisabled || settings.chat.privacyMode === "local" || !accessToken
          }
          onApproveNoteAction={handleApproveNoteAction}
          onRejectNoteAction={handleRejectNoteAction}
          onNoteActionDraftChange={handleNoteActionDraftChange}
          busyNoteActionId={busyNoteActionId}
          transcriptFindActive={transcriptFindOpen ? transcriptFindActive : null}
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
              isStreaming={activeSessionRunning || composerBusyForLimit}
              busyReason={composerBusyReason}
              routedModel={composerRoutedModel}
              subscriptionTier={subscriptionTier}
              providerKeys={providerKeys.statuses}
              notes={notes}
              value={draft}
              submitLabel={editingMessage ? "Save & retry" : "Send"}
              onChange={setDraft}
              onCancel={editingMessage ? cancelEditing : undefined}
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
                if (!getChatModelMediaCapabilities(composerRoutedModel).visionInput) {
                  pushToast({
                    title:
                      "Images are not available for this composer state or plan. Try a shorter message or fewer attachments.",
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
              onGenerateImageWithPrompt={(prompt) => handleGenerateImageWithPrompt(prompt)}
              privacyLocal={settings.chat.privacyMode === "local"}
              cloudMediaAllowed={!chatDisabled && settings.chat.privacyMode !== "local"}
              visionAllowed={getChatModelMediaCapabilities(composerRoutedModel).visionInput}
              speechAllowed={getChatModelMediaCapabilities(composerRoutedModel).speechToText}
              imageGenAllowed={getChatModelMediaCapabilities(composerRoutedModel).imageGeneration}
              accessToken={accessToken}
              previewWorkspace={workspace.isPreview && isAdmin}
              isAdmin={isAdmin}
              contextRetrievalEnabled={settings.chat.privacyMode !== "off"}
              pinnedWikiNotes={pinnedWikiNotes}
              onToggleWikiComposerPin={toggleWikiComposerPin}
            />
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 self-end sm:w-auto">
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
            <div className="relative flex shrink-0 items-center justify-end gap-1.5 self-end">
              <span
                title={newChatDisabled ? parallelChatLimitMessage : undefined}
                className={cn("inline-flex", newChatDisabled && "cursor-not-allowed")}
              >
                <button
                  type="button"
                  disabled={newChatDisabled}
                  title={newChatDisabled ? parallelChatLimitMessage : "Start a new chat"}
                  aria-label={
                    newChatDisabled ? parallelChatLimitMessage : "Start a new chat"
                  }
                  data-testid="chat-new-chat"
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-trellis-border bg-trellis-surface transition",
                    newChatDisabled
                      ? "text-trellis-faint"
                      : "text-trellis-text hover:border-trellis-accent/35 hover:text-trellis-accent"
                  )}
                  onClick={() => {
                    if (newChatDisabled) {
                      return;
                    }
                    handleStartNewChat();
                  }}
                >
                  <MessageSquarePlus className="h-4 w-4" aria-hidden />
                </button>
              </span>
              {activeSessionId && currentMessages.length > 0 ? (
                <button
                  type="button"
                  data-testid="chat-copy-clipboard"
                  title="Copy this conversation as plain text"
                  aria-label="Copy this conversation as plain text"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-trellis-border bg-trellis-surface text-trellis-text transition hover:border-trellis-accent/35 hover:text-trellis-accent"
                  onClick={() => {
                    void handleCopyChatToClipboard();
                  }}
                >
                  <ClipboardCopy className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
              <div ref={extractionQueuePopoverRef} className="relative inline-flex">
                <button
                  type="button"
                  title={
                    features.localExtraction
                      ? extractionQueueTooltip
                      : "On-device Strands processing is off"
                  }
                  aria-label={
                    features.localExtraction
                      ? extractionQueueTooltip
                      : "On-device Strands processing is off"
                  }
                  aria-expanded={extractionQueueOpen}
                  aria-busy={sessionExtractionBusy && features.localExtraction}
                  disabled={!features.localExtraction}
                  data-testid="chat-extraction-sync-indicator"
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-trellis-border bg-trellis-surface outline-none ring-trellis-accent/40 transition focus-visible:ring-2",
                    features.localExtraction
                      ? "text-trellis-accent hover:border-trellis-accent/35 hover:text-trellis-text"
                      : "cursor-not-allowed text-trellis-faint opacity-50"
                  )}
                  onClick={() => {
                    if (!features.localExtraction) {
                      return;
                    }
                    setExtractionQueueOpen((open) => !open);
                  }}
                >
                  {features.localExtraction && sessionExtractionBusy ? (
                    <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden />
                  )}
                </button>
                {extractionQueueOpen && features.localExtraction ? (
                  <div
                    className="trellis-elevated absolute bottom-full right-0 z-50 mb-2 w-[min(100vw-2rem,320px)] rounded-field border border-trellis-border bg-trellis-surface p-2 text-left shadow-lg"
                    role="dialog"
                    aria-label={
                      sessionExtractionBusy ? "Strands sync queue" : "Recent Strands activity"
                    }
                  >
                    <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-trellis-faint">
                      {sessionExtractionBusy ? "Strands queue" : "Recent Strands"}
                    </p>
                    <div className="max-h-48 overflow-y-auto">
                      {sessionExtractionBusy ? (
                        activeExtractionJobs.length > 0 ? (
                          activeExtractionJobs.map((job) => {
                            const title =
                              extractionSessionTitleById.get(job.sessionId) ?? "Untitled chat";
                            const turnCount = Math.max(
                              0,
                              job.transcriptEndIndex - job.transcriptStartIndex
                            );

                            return (
                              <div
                                key={job.id}
                                className="rounded-field px-2 py-2 text-xs text-trellis-text"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="min-w-0 truncate font-medium">{title}</span>
                                  <span className="shrink-0 text-trellis-accent">
                                    {formatExtractionJobStatus(job)}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-trellis-muted">
                                  {formatExtractionJobTrigger(job)}
                                  {turnCount > 0 ? ` · ${turnCount} turns` : ""}
                                </p>
                              </div>
                            );
                          })
                        ) : (
                          <p className="px-2 py-3 text-xs text-trellis-muted">
                            No active jobs — if this spinner persists, try switching chats or check
                            Settings.
                          </p>
                        )
                      ) : extractionRecentJobs.length > 0 ? (
                        extractionRecentJobs.map((job) => {
                          const title =
                            job.sessionTitle ??
                            extractionSessionTitleById.get(job.sessionId) ??
                            "Untitled chat";
                          const turnCount = Math.max(
                            0,
                            job.transcriptEndIndex - job.transcriptStartIndex
                          );

                          return (
                            <div
                              key={job.id}
                              className="rounded-field px-2 py-2 text-xs text-trellis-text"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="min-w-0 truncate font-medium">{title}</span>
                                <span
                                  className={cn(
                                    "shrink-0",
                                    job.status === "failed" ? "text-trellis-error" : "text-trellis-accent"
                                  )}
                                >
                                  {formatExtractionJobStatus(job)}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-trellis-muted">
                                {formatExtractionJobTrigger(job)}
                                {turnCount > 0 ? ` · ${turnCount} turns` : ""}
                                {job.status === "failed" && job.errorMessage
                                  ? ` · ${job.errorMessage}`
                                  : ""}
                              </p>
                            </div>
                          );
                        })
                      ) : (
                        <p className="px-2 py-3 text-xs text-trellis-muted">
                          No recent Strands runs yet. After each assistant reply, Trellis extracts
                          notes in the background.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
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
        {showChatContextGraph ? (
          <ChatContextGraphPanel
            workspaceId={workspace.id}
            graph={chatContextSubgraph}
            collapsed={contextGraphCollapsed}
            onToggleCollapsed={() => {
              setContextGraphCollapsed((current) => !current);
            }}
            onOpenNote={(slug) => {
              void openReferencedNote(slug);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
