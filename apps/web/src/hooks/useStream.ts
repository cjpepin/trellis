import { useCallback } from "react";
import type { ChatModel, ChatPrivacyMode, MessageRecord, SubscriptionTier } from "@trellis/contracts";
import { streamChat, streamLocalChat, type ChatNoteReference } from "@/lib/api";
import { formatMessageForApi } from "@/lib/chatAttachments";
import { updateChatSession } from "@/lib/cloud/chat";
import { messageRecordsToStreamPayload } from "@/lib/chatStreamMessages";
import { isUnsetChatSessionTitle } from "@trellis/shared/chat/chatSessionTitle";
import { useChatStore } from "@/store/chatStore";

interface UseStreamInput {
  accessToken: string | null;
  privacyMode: ChatPrivacyMode;
  subscriptionTier: SubscriptionTier;
  previewWorkspace?: boolean;
}

interface StreamResult {
  assistantMessage: MessageRecord | null;
  failureMessage: string | null;
}

export interface StreamAssistantOptions {
  /** Called once when the first assistant token arrives (message reached the model and a reply started). */
  onFirstAssistantToken?: () => void;
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
    message.includes("subscription is no longer active") ||
    message.includes("trial or free message allowance")
  ) {
    return message;
  }

  if (
    message.includes("24-hour window") ||
    message.includes("free message allowance for this")
  ) {
    return "Daily free message limit reached.";
  }

  if (
    message.includes("Local-only") ||
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

export function useStream({
  accessToken,
  privacyMode,
  subscriptionTier,
  previewWorkspace = false
}: UseStreamInput) {
  const addMessage = useChatStore((state) => state.addMessage);
  const removeMessage = useChatStore((state) => state.removeMessage);
  const patchAssistantDraft = useChatStore((state) => state.patchAssistantDraft);
  const markChatRunAssistant = useChatStore((state) => state.markChatRunAssistant);
  const markChatRunFirstToken = useChatStore((state) => state.markChatRunFirstToken);
  const upsertSession = useChatStore((state) => state.upsertSession);

  return useCallback(
    async (
      sessionId: string,
      messages: MessageRecord[],
      references: ChatNoteReference[] = [],
      model: ChatModel,
      streamOptions?: StreamAssistantOptions
    ): Promise<StreamResult> => {
      if (privacyMode !== "local" && !accessToken) {
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
      markChatRunAssistant(sessionId, assistantDraft.id);
      let failureMessage: string | null = null;
      let firstAssistantTokenNotified = false;

      try {
        const handleTitle = async (title: string) => {
          const current = useChatStore.getState().sessions.find((s) => s.id === sessionId);
          if (current && !isUnsetChatSessionTitle(current.title)) {
            return;
          }
          const updatedSession = await updateChatSession({
            id: sessionId,
            title,
            model
          });
          upsertSession(updatedSession);
        };
        const handleToken = (token: string) => {
          markChatRunFirstToken(sessionId);
          if (!firstAssistantTokenNotified) {
            firstAssistantTokenNotified = true;
            streamOptions?.onFirstAssistantToken?.();
          }
          assistantDraft.content += token;
          patchAssistantDraft(sessionId, assistantDraft.id, assistantDraft.content);
        };

        const streamPayload = messageRecordsToStreamPayload(messages);

        if (
          privacyMode === "local" &&
          streamPayload.some((message) => (message.imageFileIds?.length ?? 0) > 0)
        ) {
          throw new Error(
            "Local-only chat cannot send images to the on-device model. Switch privacy to Auto or Off in Settings, or remove the image."
          );
        }

        if (privacyMode === "local") {
          await streamLocalChat({
            accessToken: accessToken ?? "",
            subscriptionTier,
            model,
            sessionId,
            messages: streamPayload,
            references,
            ...(previewWorkspace ? { previewWorkspace: true } : {}),
            onStatus: () => undefined,
            onTitle: handleTitle,
            onToken: handleToken
          });
        } else {
          await streamChat({
            accessToken: accessToken ?? "",
            subscriptionTier,
            model,
            sessionId,
            messages: streamPayload,
            messageRecords: messages,
            references,
            ...(previewWorkspace ? { previewWorkspace: true } : {}),
            onStatus: () => undefined,
            onTitle: handleTitle,
            onToken: handleToken
          });
        }
      } catch (error) {
        failureMessage =
          error instanceof Error
            ? error.message
            : "Trellis couldn’t reach the AI service right now.";
        if (assistantDraft.content.length === 0) {
          removeMessage(sessionId, assistantDraft.id);
          return {
            assistantMessage: null,
            failureMessage
          };
        }
      }

      return {
        assistantMessage: assistantDraft,
        failureMessage
      };
    },
    [
      accessToken,
      addMessage,
      markChatRunAssistant,
      markChatRunFirstToken,
      patchAssistantDraft,
      previewWorkspace,
      privacyMode,
      removeMessage,
      subscriptionTier,
      upsertSession
    ]
  );
}

export { getToastCopy as getChatStreamToastCopy };
