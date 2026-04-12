import { create } from "zustand";
import {
  defaultChatModel,
  normalizeChatModel,
  type AppWorkspaceId,
  type ChatModel,
  type ChatSessionSummary,
  type MessageRecord
} from "@electron/ipc/types";
import {
  canStartChatRun,
  filterChatRunsBySessionIds,
  getRunningChatRunCount,
  type ChatRunAttention,
  type ChatRunState
} from "@/lib/chatRunState";
import { readWorkspaceLocalStorage, writeWorkspaceLocalStorage } from "@/lib/workspace";

export interface MessageMeta {
  status: "pending" | "failed";
  errorMessage?: string;
}

interface ChatState {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  messagesBySession: Record<string, MessageRecord[]>;
  messageMetaById: Record<string, MessageMeta>;
  chatRunsBySession: Record<string, ChatRunState>;
  chatRunNotificationsBySession: Record<string, ChatRunAttention>;
  activeModel: ChatModel;
  lastExtractedMessageCount: Record<string, number>;
  workspaceId: AppWorkspaceId;
  hydrateWorkspace: (workspaceId: AppWorkspaceId, sessions: ChatSessionSummary[]) => void;
  hydrateSessions: (sessions: ChatSessionSummary[]) => void;
  setActiveSession: (sessionId: string | null) => void;
  setSessionMessages: (sessionId: string, messages: MessageRecord[]) => void;
  replaceSessionMessages: (sessionId: string, messages: MessageRecord[]) => void;
  upsertSession: (session: ChatSessionSummary) => void;
  addMessage: (message: MessageRecord) => void;
  removeMessage: (sessionId: string, messageId: string) => void;
  setMessageMeta: (messageId: string, meta: MessageMeta) => void;
  clearMessageMeta: (messageId: string) => void;
  patchAssistantDraft: (sessionId: string, messageId: string, content: string) => void;
  canStartChatRun: (sessionId: string) => boolean;
  getRunningChatRunCount: () => number;
  startChatRun: (run: {
    sessionId: string;
    assistantMessageId?: string | null;
    startedAt?: number;
  }) => boolean;
  markChatRunAssistant: (sessionId: string, assistantMessageId: string) => void;
  markChatRunFirstToken: (sessionId: string) => void;
  finishChatRun: (sessionId: string, attention?: ChatRunAttention | null) => void;
  acknowledgeChatRunNotification: (sessionId: string) => void;
  setActiveModel: (model: ChatModel) => void;
  markExtracted: (sessionId: string, messageCount: number) => void;
}

function getStoredModel(): ChatModel | null {
  const value = readWorkspaceLocalStorage("model");

  return value ? normalizeChatModel(value) : null;
}

const storedModel = getStoredModel();

function sortSessions(sessions: ChatSessionSummary[]): ChatSessionSummary[] {
  return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt);
}

function filterMessageMetaByCurrentMessages(
  messageMetaById: Record<string, MessageMeta>,
  messagesBySession: Record<string, MessageRecord[]>
): Record<string, MessageMeta> {
  const validMessageIds = new Set(
    Object.values(messagesBySession)
      .flat()
      .map((message) => message.id)
  );

  return Object.fromEntries(
    Object.entries(messageMetaById).filter(([messageId]) => validMessageIds.has(messageId))
  );
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messagesBySession: {},
  messageMetaById: {},
  chatRunsBySession: {},
  chatRunNotificationsBySession: {},
  activeModel: storedModel ?? defaultChatModel,
  lastExtractedMessageCount: {},
  workspaceId: "personal",
  hydrateWorkspace: (workspaceId, sessions) =>
    set(() => {
      const sortedSessions = sortSessions(sessions);

      return {
        workspaceId,
        sessions: sortedSessions,
        activeSessionId: sortedSessions[0]?.id ?? null,
        messagesBySession: {},
        messageMetaById: {},
        chatRunsBySession: {},
        chatRunNotificationsBySession: {},
        lastExtractedMessageCount: {},
        activeModel: normalizeChatModel(
          readWorkspaceLocalStorage("model", workspaceId) ?? defaultChatModel
        )
      };
    }),
  hydrateSessions: (sessions) =>
    set((state) => {
      const sortedSessions = sortSessions(sessions);
      const activeSessionStillExists = sortedSessions.some(
        (session) => session.id === state.activeSessionId
      );
      const allowedSessionIds = new Set(sortedSessions.map((session) => session.id));
      const nextMessagesBySession = Object.fromEntries(
        Object.entries(state.messagesBySession).filter(([sessionId]) =>
          allowedSessionIds.has(sessionId)
        )
      );
      const nextActiveSessionId = activeSessionStillExists
        ? state.activeSessionId
        : (sortedSessions[0]?.id ?? null);

      return {
        sessions: sortedSessions,
        activeSessionId: nextActiveSessionId,
        messagesBySession: nextMessagesBySession,
        messageMetaById: filterMessageMetaByCurrentMessages(
          state.messageMetaById,
          nextMessagesBySession
        ),
        chatRunsBySession: filterChatRunsBySessionIds(
          state.chatRunsBySession,
          allowedSessionIds
        ),
        chatRunNotificationsBySession: Object.fromEntries(
          Object.entries(state.chatRunNotificationsBySession).filter(
            ([sessionId]) =>
              allowedSessionIds.has(sessionId) && sessionId !== nextActiveSessionId
          )
        ),
        lastExtractedMessageCount: Object.fromEntries(
          Object.entries(state.lastExtractedMessageCount).filter(([sessionId]) =>
            allowedSessionIds.has(sessionId)
          )
        )
      };
    }),
  setActiveSession: (sessionId) =>
    set((state) => {
      if (!sessionId) {
        return { activeSessionId: sessionId };
      }

      return {
        activeSessionId: sessionId,
        chatRunNotificationsBySession: Object.fromEntries(
          Object.entries(state.chatRunNotificationsBySession).filter(
            ([id]) => id !== sessionId
          )
        )
      };
    }),
  setSessionMessages: (sessionId, messages) =>
    set((state) => {
      const nextMessagesBySession = {
        ...state.messagesBySession,
        [sessionId]: messages
      };

      return {
        messagesBySession: nextMessagesBySession,
        messageMetaById: filterMessageMetaByCurrentMessages(
          state.messageMetaById,
          nextMessagesBySession
        )
      };
    }),
  replaceSessionMessages: (sessionId, messages) =>
    set((state) => {
      const nextMessagesBySession = {
        ...state.messagesBySession,
        [sessionId]: messages
      };

      return {
        messagesBySession: nextMessagesBySession,
        messageMetaById: filterMessageMetaByCurrentMessages(
          state.messageMetaById,
          nextMessagesBySession
        )
      };
    }),
  upsertSession: (session) =>
    set((state) => {
      const sessions = state.sessions.filter((item) => item.id !== session.id);
      sessions.push(session);

      return {
        sessions: sortSessions(sessions),
        activeSessionId: state.activeSessionId ?? session.id
      };
    }),
  addMessage: (message) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [message.sessionId]: [...(state.messagesBySession[message.sessionId] ?? []), message]
      }
    })),
  removeMessage: (sessionId, messageId) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: (state.messagesBySession[sessionId] ?? []).filter(
          (message) => message.id !== messageId
        )
      },
      messageMetaById: Object.fromEntries(
        Object.entries(state.messageMetaById).filter(([id]) => id !== messageId)
      )
    })),
  setMessageMeta: (messageId, meta) =>
    set((state) => ({
      messageMetaById: {
        ...state.messageMetaById,
        [messageId]: meta
      }
    })),
  clearMessageMeta: (messageId) =>
    set((state) => ({
      messageMetaById: Object.fromEntries(
        Object.entries(state.messageMetaById).filter(([id]) => id !== messageId)
      )
    })),
  patchAssistantDraft: (sessionId, messageId, content) =>
    set((state) => {
      const messages = [...(state.messagesBySession[sessionId] ?? [])];
      const messageIndex = messages.findIndex((message) => message.id === messageId);
      const message = messageIndex >= 0 ? messages[messageIndex] : undefined;

      if (!message || message.role !== "assistant") {
        return state;
      }

      messages[messageIndex] = {
        ...message,
        content
      };

      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages
        }
      };
    }),
  canStartChatRun: (sessionId) => {
    return canStartChatRun(get().chatRunsBySession, sessionId).allowed;
  },
  getRunningChatRunCount: () => getRunningChatRunCount(get().chatRunsBySession),
  startChatRun: (run) => {
    const state = get();
    if (!canStartChatRun(state.chatRunsBySession, run.sessionId).allowed) {
      return false;
    }

    set((current) => ({
      chatRunsBySession: {
        ...current.chatRunsBySession,
        [run.sessionId]: {
          sessionId: run.sessionId,
          assistantMessageId: run.assistantMessageId ?? null,
          startedAt: run.startedAt ?? Date.now(),
          awaitingFirstToken: true
        }
      },
      chatRunNotificationsBySession: Object.fromEntries(
        Object.entries(current.chatRunNotificationsBySession).filter(
          ([sessionId]) => sessionId !== run.sessionId
        )
      )
    }));
    return true;
  },
  markChatRunAssistant: (sessionId, assistantMessageId) =>
    set((state) => {
      const run = state.chatRunsBySession[sessionId];
      if (!run) {
        return state;
      }

      return {
        chatRunsBySession: {
          ...state.chatRunsBySession,
          [sessionId]: {
            ...run,
            assistantMessageId
          }
        }
      };
    }),
  markChatRunFirstToken: (sessionId) =>
    set((state) => {
      const run = state.chatRunsBySession[sessionId];
      if (!run || !run.awaitingFirstToken) {
        return state;
      }

      return {
        chatRunsBySession: {
          ...state.chatRunsBySession,
          [sessionId]: {
            ...run,
            awaitingFirstToken: false
          }
        }
      };
    }),
  finishChatRun: (sessionId, attention) =>
    set((state) => {
      const { [sessionId]: _finished, ...remainingRuns } = state.chatRunsBySession;
      const { [sessionId]: _previousNotification, ...remainingNotifications } =
        state.chatRunNotificationsBySession;

      return {
        chatRunsBySession: remainingRuns,
        chatRunNotificationsBySession:
          attention && state.activeSessionId !== sessionId
            ? {
                ...remainingNotifications,
                [sessionId]: attention
              }
            : remainingNotifications
      };
    }),
  acknowledgeChatRunNotification: (sessionId) =>
    set((state) => ({
      chatRunNotificationsBySession: Object.fromEntries(
        Object.entries(state.chatRunNotificationsBySession).filter(
          ([id]) => id !== sessionId
        )
      )
    })),
  setActiveModel: (model) => {
    set((state) => {
      writeWorkspaceLocalStorage("model", model, state.workspaceId);
      return { activeModel: model };
    });
  },
  markExtracted: (sessionId, messageCount) =>
    set((state) => ({
      lastExtractedMessageCount: {
        ...state.lastExtractedMessageCount,
        [sessionId]: messageCount
      }
    }))
}));
