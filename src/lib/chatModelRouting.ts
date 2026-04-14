import type { ChatModel, MessageRecord, ProviderKeyStatus, SubscriptionTier } from "@electron/ipc/types";
import {
  inferChatComplexity,
  type ChatModelRoutingSignals
} from "@shared/chat/inferChatComplexity";
import { formatMessageForApi } from "./chatAttachments";
import {
  canUseChatModel,
  getFirstAccessibleChatModel,
  type ChatModelAccessOptions
} from "./chatModels";

export type { ChatModelRoutingSignals };
export { inferChatComplexity };

function pickFirstAllowed(
  tier: SubscriptionTier,
  keys: ProviderKeyStatus[],
  options: ChatModelAccessOptions | undefined,
  order: ChatModel[]
): ChatModel {
  for (const id of order) {
    if (canUseChatModel(id, tier, keys, options)) {
      return id;
    }
  }

  return getFirstAccessibleChatModel(tier, keys, options);
}

/**
 * Picks a chat model from tier, BYOK keys, and request signals. Does not persist; callers store on the session per reply.
 */
export function selectChatModelForRequest(
  tier: SubscriptionTier,
  keys: ProviderKeyStatus[],
  signals: ChatModelRoutingSignals,
  options?: ChatModelAccessOptions
): ChatModel {
  const complexity = inferChatComplexity(signals);
  const premiumOk = tier === "pro" || options?.previewWorkspace || options?.isAdmin;

  if (signals.hasVisionInTurn) {
    if (complexity === "high" && premiumOk) {
      return pickFirstAllowed(tier, keys, options, [
        "gpt-5.4",
        "gpt-4o",
        "claude-sonnet-4-6",
        "claude-3-7-sonnet-latest",
        "gpt-5.4-mini",
        "gpt-4o-mini",
        "claude-haiku-4-5"
      ]);
    }

    if (complexity === "medium") {
      return pickFirstAllowed(tier, keys, options, [
        "gpt-5.4-mini",
        "gpt-4o-mini",
        "claude-haiku-4-5",
        "gpt-5.4-nano",
        "gpt-5.4",
        "gpt-4o"
      ]);
    }

    return pickFirstAllowed(tier, keys, options, [
      "gpt-5.4-mini",
      "gpt-4o-mini",
      "gpt-5.4-nano",
      "claude-haiku-4-5",
      "claude-3-5-haiku-latest"
    ]);
  }

  if (complexity === "high" && premiumOk) {
    return pickFirstAllowed(tier, keys, options, [
      "gpt-5.4",
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "gpt-4.1",
      "gpt-5.4-mini"
    ]);
  }

  if (complexity === "medium") {
    return pickFirstAllowed(tier, keys, options, [
      "gpt-5.4-mini",
      "gpt-4.1-mini",
      "claude-haiku-4-5",
      "gpt-5.4-nano"
    ]);
  }

  return pickFirstAllowed(tier, keys, options, [
    "gpt-5.4-nano",
    "gpt-4.1-nano",
    "gpt-5.4-mini",
    "claude-haiku-4-5"
  ]);
}

export function routingSignalsFromUserMessage(
  baseMessages: MessageRecord[],
  userMessage: MessageRecord
): ChatModelRoutingSignals {
  const hasVisionInTurn =
    userMessage.mediaArtifacts?.some((artifact) => artifact.kind === "image") ?? false;

  return {
    userTextLength: formatMessageForApi(userMessage).length,
    transcriptMessageCount: baseMessages.length,
    hasVisionInTurn,
    nonImageAttachmentCount: userMessage.attachments?.length ?? 0
  };
}

/** OpenAI image generation — requires an image-capable GPT chat model id for session metadata. */
export function selectChatModelForImageGeneration(
  tier: SubscriptionTier,
  keys: ProviderKeyStatus[],
  options?: ChatModelAccessOptions
): ChatModel {
  return pickFirstAllowed(tier, keys, options, ["gpt-5.4", "gpt-4o"]);
}
