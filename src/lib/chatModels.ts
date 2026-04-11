import {
  defaultChatModel,
  type ChatModel,
  type ChatModelTier,
  type ChatProvider,
  type ProviderKeyStatus,
  type SubscriptionTier
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
    id: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    provider: "openai",
    tier: "cheap",
    summary: "Newest low-cost OpenAI option; strong for high-volume everyday chat."
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    provider: "openai",
    tier: "cheap",
    summary: "Fast GPT-5.4-class model balanced for daily use and longer context."
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
    id: "gpt-5.4",
    label: "GPT-5.4",
    provider: "openai",
    tier: "premium",
    summary: "OpenAI’s latest frontier model for demanding reasoning and long context."
  },
  {
    id: "claude-3-5-haiku-latest",
    label: "Claude 3.5 Haiku",
    provider: "anthropic",
    tier: "cheap",
    summary: "Fast and low-cost Claude model for everyday use."
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "cheap",
    summary: "Anthropic’s latest fast Haiku line—near-frontier quality with low latency."
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
    summary: "High-performance Claude Sonnet snapshot for deeper chat quality."
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    tier: "premium",
    summary: "Current Sonnet generation: strong default for serious work and agents."
  },
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    provider: "anthropic",
    tier: "premium",
    summary: "Most capable Claude for complex reasoning and highest-quality answers."
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

function hasProviderKey(
  provider: ChatProvider,
  providerKeys: ProviderKeyStatus[] | undefined
): boolean {
  return providerKeys?.some((status) => status.provider === provider && status.configured) ?? false;
}

/** When set, every model in the catalog is selectable (preview sandbox). */
export interface ChatModelAccessOptions {
  previewWorkspace?: boolean;
}

export function getChatModelAccess(
  model: ChatModel,
  subscriptionTier: SubscriptionTier,
  providerKeys?: ProviderKeyStatus[],
  options?: ChatModelAccessOptions
): {
  allowed: boolean;
  reason: string | null;
} {
  if (options?.previewWorkspace) {
    return {
      allowed: true,
      reason: null
    };
  }

  if (subscriptionTier === "pro") {
    return {
      allowed: true,
      reason: null
    };
  }

  if (subscriptionTier === "trial") {
    if (!isPremiumChatModel(model)) {
      return {
        allowed: true,
        reason: null
      };
    }

    return {
      allowed: false,
      reason: `${getChatModelLabel(model)} is available on Pro. Upgrade to use premium models.`
    };
  }

  const provider = getChatModelOption(model).provider;

  if (hasProviderKey(provider, providerKeys)) {
    return {
      allowed: true,
      reason: null
    };
  }

  return {
    allowed: false,
    reason: `Add your ${provider === "openai" ? "OpenAI" : "Anthropic"} API key in Settings to use ${getChatModelLabel(model)} on the BYOK plan.`
  };
}

export function canUseChatModel(
  model: ChatModel,
  subscriptionTier: SubscriptionTier,
  providerKeys?: ProviderKeyStatus[],
  options?: ChatModelAccessOptions
): boolean {
  return getChatModelAccess(model, subscriptionTier, providerKeys, options).allowed;
}

export function getFirstAccessibleChatModel(
  subscriptionTier: SubscriptionTier,
  providerKeys?: ProviderKeyStatus[],
  options?: ChatModelAccessOptions
): ChatModel {
  return (
    chatModelOptions.find((option) => canUseChatModel(option.id, subscriptionTier, providerKeys, options))
      ?.id ?? defaultChatModel
  );
}

export function isPaidSubscriptionTier(subscriptionTier: SubscriptionTier): boolean {
  return subscriptionTier === "pro" || subscriptionTier === "byok";
}
