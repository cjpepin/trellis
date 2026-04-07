import {
  defaultChatModel,
  type ChatModel,
  type ChatModelTier,
  type ChatProvider
} from "@electron/ipc/types";

export interface ChatModelOption {
  id: ChatModel;
  label: string;
  provider: ChatProvider;
  tier: ChatModelTier;
  summary: string;
}

export const chatModelOptions: ChatModelOption[] = [
  {
    id: "gpt-4.1-nano",
    label: "GPT-4.1 Nano",
    provider: "openai",
    tier: "cheap",
    summary: "Fastest and cheapest OpenAI option for lightweight chats."
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "openai",
    tier: "cheap",
    summary: "Balanced default for everyday conversations."
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    tier: "cheap",
    summary: "Affordable omni model for quick, focused responses."
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    provider: "openai",
    tier: "premium",
    summary: "Stronger OpenAI model for more capable answers."
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    tier: "premium",
    summary: "Higher-end omni model for richer, more capable chat."
  },
  {
    id: "claude-3-5-haiku-latest",
    label: "Claude 3.5 Haiku",
    provider: "anthropic",
    tier: "cheap",
    summary: "Fast and low-cost Claude model for everyday use."
  },
  {
    id: "claude-3-7-sonnet-latest",
    label: "Claude 3.7 Sonnet",
    provider: "anthropic",
    tier: "premium",
    summary: "Stronger reasoning model with a more premium Claude feel."
  },
  {
    id: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    provider: "anthropic",
    tier: "premium",
    summary: "Current high-performance Claude option for deeper chat quality."
  }
];

export function getChatModelOption(model: ChatModel): ChatModelOption {
  const matchedOption = chatModelOptions.find((option) => option.id === model);

  if (matchedOption) {
    return matchedOption;
  }

  const fallbackOption = chatModelOptions.find((option) => option.id === defaultChatModel);

  if (!fallbackOption) {
    throw new Error(`Missing fallback chat model definition for ${defaultChatModel}.`);
  }

  return fallbackOption;
}

export function getChatModelLabel(model: ChatModel): string {
  return getChatModelOption(model).label;
}

export function getChatModelProviderLabel(model: ChatModel): "OpenAI" | "Claude" {
  return getChatModelOption(model).provider === "openai" ? "OpenAI" : "Claude";
}

export function isPremiumChatModel(model: ChatModel): boolean {
  return getChatModelOption(model).tier === "premium";
}

export function canUseChatModel(model: ChatModel, subscriptionTier: "trial" | "pro"): boolean {
  return subscriptionTier === "pro" || !isPremiumChatModel(model);
}
