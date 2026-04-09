import { create } from "zustand";
import {
  defaultChatModel,
  normalizeChatModel,
  type AppWorkspaceId,
  type ChatModel,
  type ChatSessionSummary,
  type MessageRecord
} from "@electron/ipc/types";
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
  isStreaming: boolean;
  awaitingFirstToken: boolean;
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
  patchAssistantDraft: (sessionId: string, content: string) => void;
  setStreaming: (value: boolean) => void;
  setAwaitingFirstToken: (value: boolean) => void;
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

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messagesBySession: {},
  messageMetaById: {},
  isStreaming: false,
  awaitingFirstToken: false,
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

      return {
        sessions: sortedSessions,
        activeSessionId: activeSessionStillExists
          ? state.activeSessionId
          : (sortedSessions[0]?.id ?? null),
        messagesBySession: nextMessagesBySession,
        messageMetaById: filterMessageMetaByCurrentMessages(
          state.messageMetaById,
          nextMessagesBySession
        ),
        lastExtractedMessageCount: Object.fromEntries(
          Object.entries(state.lastExtractedMessageCount).filter(([sessionId]) =>
            allowedSessionIds.has(sessionId)
          )
        )
      };
    }),
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
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
  patchAssistantDraft: (sessionId, content) =>
    set((state) => {
      const messages = [...(state.messagesBySession[sessionId] ?? [])];
      const lastMessage = messages.at(-1);

      if (!lastMessage || lastMessage.role !== "assistant") {
        return state;
      }

      messages[messages.length - 1] = {
        ...lastMessage,
        content
      };

      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages
        }
      };
    }),
  setStreaming: (value) => set({ isStreaming: value }),
  setAwaitingFirstToken: (value) => set({ awaitingFirstToken: value }),
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
