import type { ProfileRow } from "./auth.ts";
import { corsHeaders } from "./http.ts";

export const chatModelIds = [
  "gpt-4.1-nano",
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4o",
  "claude-3-5-haiku-latest",
  "claude-3-7-sonnet-latest",
  "claude-sonnet-4-20250514"
] as const;

export type ChatModel = (typeof chatModelIds)[number];

interface ChatModelConfig {
  label: string;
  provider: "openai" | "anthropic";
  tier: "cheap" | "premium";
}

const chatModelConfig: Record<ChatModel, ChatModelConfig> = {
  "gpt-4.1-nano": {
    label: "GPT-4.1 Nano",
    provider: "openai",
    tier: "cheap"
  },
  "gpt-4.1-mini": {
    label: "GPT-4.1 Mini",
    provider: "openai",
    tier: "cheap"
  },
  "gpt-4o-mini": {
    label: "GPT-4o Mini",
    provider: "openai",
    tier: "cheap"
  },
  "gpt-4.1": {
    label: "GPT-4.1",
    provider: "openai",
    tier: "premium"
  },
  "gpt-4o": {
    label: "GPT-4o",
    provider: "openai",
    tier: "premium"
  },
  "claude-3-5-haiku-latest": {
    label: "Claude 3.5 Haiku",
    provider: "anthropic",
    tier: "cheap"
  },
  "claude-3-7-sonnet-latest": {
    label: "Claude 3.7 Sonnet",
    provider: "anthropic",
    tier: "premium"
  },
  "claude-sonnet-4-20250514": {
    label: "Claude Sonnet 4",
    provider: "anthropic",
    tier: "premium"
  }
};

const legacyChatModelMap = {
  "claude-sonnet-4": "claude-sonnet-4-20250514",
  "ollama-local-stub": "gpt-4.1-mini"
} as const satisfies Record<string, ChatModel>;

export function isChatModel(value: string): value is ChatModel {
  return (chatModelIds as readonly string[]).includes(value);
}

export function normalizeChatModel(value: string): ChatModel | null {
  if (isChatModel(value)) {
    return value;
  }

  return legacyChatModelMap[value as keyof typeof legacyChatModelMap] ?? null;
}

export function getChatModelLabel(model: ChatModel): string {
  return chatModelConfig[model].label;
}

export function getChatModelProvider(model: ChatModel): "openai" | "anthropic" {
  return chatModelConfig[model].provider;
}

export function isPremiumChatModel(model: ChatModel): boolean {
  return chatModelConfig[model].tier === "premium";
}

export function assertChatModelAccess(profile: ProfileRow, model: ChatModel): void {
  if (
    profile.subscription_tier === "pro" ||
    profile.subscription_tier === "byok" ||
    !isPremiumChatModel(model)
  ) {
    return;
  }

  throw new Response(
    JSON.stringify({
      error: `${getChatModelLabel(model)} is available on Pro. Upgrade to use premium models.`
    }),
    {
      status: 403,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    }
  );
}
