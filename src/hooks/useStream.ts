import { useCallback } from "react";
import type { ChatModel, MessageRecord } from "@electron/ipc/types";
import { streamChat, type ChatNoteReference } from "@/lib/api";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";

interface UseStreamInput {
  accessToken: string | null;
  model: ChatModel;
}

interface StreamResult {
  assistantMessage: MessageRecord | null;
  failureMessage: string | null;
}

function getToastCopy(message: string): string {
  if (message.includes("session expired")) {
    return "Your session expired. Your local notes are still safe. Sign in again from Settings to resume chatting.";
  }

  if (message.includes("cloud session")) {
    return message;
  }

  if (message.includes("trial has ended")) {
    return message;
  }

  if (
    message.includes("not configured") ||
    message.includes("placeholder") ||
    message.includes("Switch to") ||
    message.includes("available on Pro") ||
    message.includes("premium models") ||
    message.includes("Upgrade to use premium models") ||
    message.includes("OpenAI") ||
    message.includes("Anthropic") ||
    message.includes("empty response")
  ) {
    return message;
  }

  if (message.includes("not available for this build")) {
    return "Chat is not available in this build yet.";
  }

  return "Trellis couldn’t reach chat right now. Your local notes are still safe.";
}

export function useStream({ accessToken, model }: UseStreamInput) {
  const setStreaming = useChatStore((state) => state.setStreaming);
  const setAwaitingFirstToken = useChatStore((state) => state.setAwaitingFirstToken);
  const addMessage = useChatStore((state) => state.addMessage);
  const removeMessage = useChatStore((state) => state.removeMessage);
  const patchAssistantDraft = useChatStore((state) => state.patchAssistantDraft);
  const upsertSession = useChatStore((state) => state.upsertSession);
  const pushToast = useUiStore((state) => state.pushToast);

  return useCallback(
    async (
      sessionId: string,
      messages: Array<Pick<MessageRecord, "role" | "content">>,
      references: ChatNoteReference[] = []
    ): Promise<StreamResult> => {
      if (!accessToken) {
        throw new Error("Please sign in before starting a chat.");
      }

      const assistantDraft: MessageRecord = {
        id: crypto.randomUUID(),
        sessionId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        tokens: null
      };

      addMessage(assistantDraft);
      setStreaming(true);
      setAwaitingFirstToken(true);

      try {
        await streamChat({
          accessToken,
          model,
          sessionId,
          messages,
          references,
          onStatus: () => undefined,
          onTitle: async (title) => {
            const updatedSession = await window.trellis.db.updateSession({
              id: sessionId,
              title,
              model
            });
            upsertSession(updatedSession);
          },
          onToken: (token) => {
            setAwaitingFirstToken(false);
            assistantDraft.content += token;
            patchAssistantDraft(sessionId, assistantDraft.content);
          }
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Trellis couldn’t reach the AI service right now.";
        pushToast({
          title: getToastCopy(message),
          tone: "warning"
        });
        if (assistantDraft.content.length === 0) {
          removeMessage(sessionId, assistantDraft.id);
          return {
            assistantMessage: null,
            failureMessage: message
          };
        }
      } finally {
        setStreaming(false);
        setAwaitingFirstToken(false);
      }

      return {
        assistantMessage: assistantDraft,
        failureMessage: null
      };
    },
    [
      accessToken,
      addMessage,
      model,
      patchAssistantDraft,
      pushToast,
      removeMessage,
      setAwaitingFirstToken,
      setStreaming,
      upsertSession
    ]
  );
}
