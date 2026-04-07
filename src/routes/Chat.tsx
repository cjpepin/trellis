import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { defaultChatModel, type AppSettings, type MessageRecord } from "@electron/ipc/types";
import { InputBar } from "@/components/chat/InputBar";
import { MessageList } from "@/components/chat/MessageList";
import { extractTranscript, type ChatNoteReference } from "@/lib/api";
import { canUseChatModel } from "@/lib/chatModels";
import { selectRelevantReferenceSlugs } from "@/lib/chatReferences";
import { buildExtractionIndex } from "@/lib/extractionIndex";
import { useApplyExtraction } from "@/hooks/useApplyExtraction";
import { useStream } from "@/hooks/useStream";
import { getActiveVault, getVaultById } from "@/lib/settings";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";

interface Props {
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
}

export function Chat({ settings, onUpdateSettings }: Props) {
  const chatColumnClassName = "max-w-[1020px]";
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const accessToken = useAuthStore((state) => state.accessToken);
  const authStatus = useAuthStore((state) => state.status);
  const subscriptionTier = useAuthStore((state) => state.subscriptionTier);
  const graph = useWikiStore((state) => state.graph);
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
  const applyExtraction = useApplyExtraction();
  const streamAssistant = useStream({
    accessToken,
    model: activeModel
  });
  const extractionQueue = useRef<Set<string>>(new Set());
  const previousSessionId = useRef<string | null>(activeSessionId);
  const activeVault = getActiveVault(settings);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );
  const existingSlugs = useMemo(() => notes.map((note) => note.slug), [notes]);
  const extractionIndex = useMemo(() => buildExtractionIndex(graph), [graph]);
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
  }, [activeSessionId]);

  useEffect(() => {
    if (canUseChatModel(activeModel, subscriptionTier)) {
      return;
    }

    setActiveModel(defaultChatModel);
  }, [activeModel, setActiveModel, subscriptionTier]);

  const runExtraction = useCallback(
    async (sessionId: string) => {
      if (!accessToken || extractionQueue.current.has(sessionId)) {
        return;
      }

      const messages = useChatStore.getState().messagesBySession[sessionId] ?? [];
      const usableMessages = messages.filter(
        (message) => useChatStore.getState().messageMetaById[message.id]?.status !== "failed"
      );
      const lastExtracted = useChatStore.getState().lastExtractedMessageCount[sessionId] ?? 0;
      const extractionStartIndex = lastExtracted > 0 ? Math.max(0, lastExtracted - 2) : 0;
      const extractionMessages = usableMessages.slice(extractionStartIndex);

      if (usableMessages.length < 2 || usableMessages.length === lastExtracted) {
        return;
      }

      extractionQueue.current.add(sessionId);
      const session = useChatStore.getState().sessions.find((item) => item.id === sessionId);

      try {
        const response = await extractTranscript({
          accessToken,
          sessionId,
          transcript: extractionMessages.map((message) => ({
            role: message.role,
            content: message.content
          })),
          index: extractionIndex
        });

        await applyExtraction(response, {
          sessionId,
          messageCount: usableMessages.length,
          vaultId: session?.vaultId
        });
      } catch (error) {
        pushToast({
          title:
            error instanceof Error
              ? error.message
              : "Trellis couldn’t update the wiki for that session.",
          tone: "warning"
        });
      } finally {
        extractionQueue.current.delete(sessionId);
      }
    },
    [accessToken, applyExtraction, extractionIndex, pushToast]
  );

  useEffect(() => {
    if (previousSessionId.current && previousSessionId.current !== activeSessionId) {
      void runExtraction(previousSessionId.current);
    }

    previousSessionId.current = activeSessionId;
  }, [activeSessionId, runExtraction]);

  useEffect(() => {
    if (!activeSessionId || isStreaming || currentMessages.length < 2) {
      return;
    }

    const timer = window.setTimeout(() => {
      void runExtraction(activeSessionId);
    }, 60_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeSessionId, currentMessages.length, isStreaming, runExtraction]);

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
    targetMessageId?: string,
    nextContent?: string
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
        tokens: null
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
    const baseMessages = [...sessionMessages.slice(0, targetIndex), updatedUserMessage];

    return {
      baseMessages,
      userMessage: updatedUserMessage
    };
  }

  async function sendMessage(value: string, targetMessageId?: string): Promise<void> {
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

      const { baseMessages, userMessage } = buildRetryTranscript(sessionId, targetMessageId, value);
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
          content: message.content
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
      const updatedSession = await window.trellis.db.updateSession({
        id: sessionId,
        model: activeModel
      });
      upsertSession(updatedSession);
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
    await sendMessage(value, editingMessageId ?? undefined);
  }

  function handleEditMessage(messageId: string): void {
    const message = currentMessages.find((item) => item.id === messageId);

    if (!message || message.role !== "user") {
      return;
    }

    setEditingMessageId(messageId);
    setDraft(message.content);
  }

  async function handleRetryMessage(messageId: string): Promise<void> {
    const message = currentMessages.find((item) => item.id === messageId);

    if (!message || message.role !== "user") {
      return;
    }

    await sendMessage(message.content, messageId);
  }

  function cancelEditing(): void {
    setEditingMessageId(null);
    setDraft("");
  }

  function handleStartNewChat(): void {
    setEditingMessageId(null);
    setDraft("");
    setActiveSession(null);
    navigate("/chat");
  }

  return (
    <div className="flex h-full flex-col">
      {authStatus !== "authenticated" && (
        <div className={`trellis-accent-surface mx-auto mt-6 w-full ${chatColumnClassName} rounded-panel border border-trellis-accent/20 px-4 py-3 text-sm text-trellis-text`}>
          Sign in from Settings to start chatting with Trellis and grow what you know.
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
        {!activeSessionId && (
          <div className={`mx-auto mb-4 flex w-full ${chatColumnClassName} items-center justify-between gap-4 rounded-field border border-trellis-border bg-trellis-surface px-4 py-3`}>
            <div>
              <p className="text-sm text-trellis-text">New conversation vault</p>
              <p className="mt-1 text-xs text-trellis-muted">
                This conversation will update notes in {activeVault.name}.
              </p>
            </div>
            <select
              value={activeVault.id}
              className="trellis-input max-w-[220px]"
              onChange={(event) => {
                void onUpdateSettings({
                  ...settings,
                  activeVaultId: event.target.value
                });
              }}
            >
              {settings.vaults.map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {editingMessage && (
          <div className={`mx-auto mb-4 w-full ${chatColumnClassName} rounded-field border border-trellis-accent/20 bg-trellis-surface px-4 py-3 text-sm text-trellis-text`}>
            Editing an earlier message will regenerate the conversation from that point.
          </div>
        )}
        <div className={`mx-auto flex w-full ${chatColumnClassName} flex-col gap-3 sm:flex-row sm:items-end`}>
          <div className="min-w-0 flex-1">
            <InputBar
              disabled={authStatus !== "authenticated"}
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
            />
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full border border-trellis-border bg-trellis-surface px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35 hover:text-trellis-accent"
            onClick={handleStartNewChat}
          >
            New chat
          </button>
        </div>
        {sessions.length > 0 && currentMessages.length > 0 && (
          <p className={`mx-auto mt-3 ${chatColumnClassName} text-xs text-trellis-muted`}>
            {activeSession && (
              <>
                This conversation is writing to {getVaultById(settings, activeSession.vaultId).name}.{" "}
              </>
            )}
            After 60 seconds of inactivity, Trellis will extract durable notes from this
            session and update your graph in the background.
          </p>
        )}
      </div>
    </div>
  );
}
