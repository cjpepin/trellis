import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  defaultChatModel,
  type AppSettings,
  type WorkspaceInfo,
  type ChatAttachment,
  type MessageRecord,
  type QueueSessionExtractionResult
} from "@electron/ipc/types";
import { ChatVaultSelect } from "@/components/chat/ChatVaultSelect";
import { InputBar } from "@/components/chat/InputBar";
import { MessageList } from "@/components/chat/MessageList";
import {
  getOptionalExtractionCloudConfig,
  type ChatNoteReference
} from "@/lib/api";
import { canUseChatModel } from "@/lib/chatModels";
import { selectRelevantReferenceSlugs } from "@/lib/chatReferences";
import {
  formatMessageForApi,
  toChatAttachments,
  type PendingChatAttachment
} from "@/lib/chatAttachments";
import { useStream } from "@/hooks/useStream";
import { getActiveVault, getVaultById } from "@/lib/settings";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";

interface Props {
  settings: AppSettings;
  workspace: WorkspaceInfo;
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
  onSwitchWorkspace: (workspaceId: WorkspaceInfo["id"]) => Promise<void>;
}

export function Chat({ settings, workspace, onUpdateSettings, onSwitchWorkspace }: Props) {
  const chatColumnClassName = "max-w-[1020px]";
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const accessToken = useAuthStore((state) => state.accessToken);
  const authStatus = useAuthStore((state) => state.status);
  const subscriptionTier = useAuthStore((state) => state.subscriptionTier);
  const notes = useWikiStore((state) => state.notes);
  const setNote = useWikiStore((state) => state.setNote);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
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
  const streamAssistant = useStream({
    accessToken,
    model: activeModel
  });
  const previousSessionId = useRef<string | null>(activeSessionId);
  const activeVault = getActiveVault(settings);
  const isPreviewWorkspace = workspace.localOnly;
  const chatDisabled = isPreviewWorkspace || authStatus !== "authenticated";
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
  }, [activeSessionId]);

  useEffect(() => {
    if (canUseChatModel(activeModel, subscriptionTier)) {
      return;
    }

    setActiveModel(defaultChatModel);
  }, [activeModel, setActiveModel, subscriptionTier]);

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
          mode: settings.extraction.mode,
          cloud: getOptionalExtractionCloudConfig(accessToken),
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
    [accessToken, pushToast, settings.extraction.mode, settings.extraction.preferredLocalModelId]
  );

  useEffect(() => {
    if (previousSessionId.current && previousSessionId.current !== activeSessionId) {
      void queueExtraction(previousSessionId.current, "session-switch");
    }

    previousSessionId.current = activeSessionId;
  }, [activeSessionId, queueExtraction]);

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
        navigate(`/wiki?note=${encodeURIComponent(slug)}`);
      } catch (error) {
        pushToast({
          title: error instanceof Error ? error.message : "Could not open that note.",
          tone: "warning"
        });
      }
    },
    [activeSession?.vaultId, activeVault.id, loadNote, navigate, notes, pushToast, setActiveNote]
  );

  const buildChatReferences = useCallback(
    async (
      messages: Array<Pick<MessageRecord, "role" | "content">>,
      vaultId: string
    ): Promise<ChatNoteReference[]> => {
      const referencedSlugs = selectRelevantReferenceSlugs(messages, notes);

      const references = await Promise.all(
        referencedSlugs.map(async (slug) => {
          const note = await loadNote(slug, vaultId);

          return {
            slug,
            title: note.title,
            excerpt: note.excerpt,
            content: note.content.slice(0, 6_000)
          } satisfies ChatNoteReference;
        })
      );

      return references;
    },
    [loadNote, notes]
  );

  function buildRetryTranscript(
    sessionId: string,
    targetMessageId: string | undefined,
    nextContent: string | undefined,
    nextAttachments: ChatAttachment[] | undefined
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
        ...(nextAttachments && nextAttachments.length > 0 ? { attachments: nextAttachments } : {})
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
    const baseMessages = [...sessionMessages.slice(0, targetIndex), updatedUserMessage];

    return {
      baseMessages,
      userMessage: updatedUserMessage
    };
  }

  async function sendMessage(
    value: string,
    targetMessageId?: string,
    attachmentPayload?: ChatAttachment[]
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
        attachmentPayload
      );
      optimisticUserMessage = userMessage;
      replaceSessionMessages(sessionId, baseMessages);
      clearMessageMeta(userMessage.id);
      setMessageMeta(userMessage.id, { status: "pending" });
      setDraft("");
      if (targetMessageId) {
        setEditingMessageId(null);
      }
      const references = await buildChatReferences(baseMessages, sessionVaultId);

      const streamResult = await streamAssistant(
        sessionId,
        baseMessages.map((message) => ({
          role: message.role,
          content: formatMessageForApi(message)
        })),
        references
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
      await window.trellis.db.replaceMessages({
        sessionId,
        messages: nextMessages
      });
      setPendingAttachments([]);
      const updatedSession = await window.trellis.db.updateSession({
        id: sessionId,
        model: activeModel
      });
      upsertSession(updatedSession);
      void queueExtraction(sessionId, "idle");
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

    if (!trimmed && payload.length === 0) {
      return;
    }

    await sendMessage(trimmed, editingMessageId ?? undefined, payload);
  }

  async function handleAttachFile(): Promise<void> {
    if (pendingAttachments.length >= 12) {
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

  async function handleAttachLink(): Promise<void> {
    if (pendingAttachments.length >= 12) {
      pushToast({
        title: "You can attach up to 12 items per message.",
        tone: "warning"
      });
      return;
    }

    const raw = window.prompt("Paste a public https URL to clip");

    if (raw === null) {
      return;
    }

    const url = raw.trim();

    if (!url) {
      return;
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
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not clip that URL.",
        tone: "warning"
      });
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
  }

  async function handleRetryMessage(messageId: string): Promise<void> {
    const message = currentMessages.find((item) => item.id === messageId);

    if (!message || message.role !== "user") {
      return;
    }

    await sendMessage(message.content, messageId, message.attachments);
  }

  function cancelEditing(): void {
    setEditingMessageId(null);
    setDraft("");
    setPendingAttachments([]);
  }

  function handleStartNewChat(): void {
    setEditingMessageId(null);
    setDraft("");
    setPendingAttachments([]);
    setActiveSession(null);
    navigate("/chat");
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
    <div className="flex h-full flex-col">
      {(isPreviewWorkspace || authStatus !== "authenticated") && (
        <div className={`trellis-accent-surface mx-auto mt-6 w-full ${chatColumnClassName} rounded-panel border border-trellis-accent/20 px-4 py-3 text-sm text-trellis-text`}>
          {isPreviewWorkspace ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Preview stays local and browseable. Switch to your personal workspace for live
                cloud chat.
              </span>
              <button
                type="button"
                className="rounded-full border border-trellis-accent/25 px-3 py-1.5 text-xs text-trellis-accent transition hover:border-trellis-accent/45"
                onClick={() => {
                  void onSwitchWorkspace("personal");
                }}
              >
                Switch to personal
              </button>
            </div>
          ) : (
            "Sign in from Settings to start chatting with Trellis and grow what you know."
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList
          messages={currentMessages}
          columnClassName={chatColumnClassName}
          existingSlugs={existingSlugs}
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
        />
      </div>
      <div className="trellis-overlay-surface border-t border-trellis-border px-5 py-4 backdrop-blur">
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
              onAttachLink={() => {
                void handleAttachLink();
              }}
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
