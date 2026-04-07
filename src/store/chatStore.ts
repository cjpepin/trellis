import { create } from "zustand";
import {
  defaultChatModel,
  normalizeChatModel,
  type ChatModel,
  type ChatSessionSummary,
  type MessageRecord
} from "@electron/ipc/types";

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
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem("trellis:model");

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
  hydrateSessions: (sessions) =>
    set({
      sessions: sortSessions(sessions),
      activeSessionId: sessions[0]?.id ?? null
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
    if (typeof window !== "undefined") {
      window.localStorage.setItem("trellis:model", model);
    }
    set({ activeModel: model });
  },
  markExtracted: (sessionId, messageCount) =>
    set((state) => ({
      lastExtractedMessageCount: {
        ...state.lastExtractedMessageCount,
        [sessionId]: messageCount
      }
    }))
}));
