import { buildChatSystemPrompt } from "../../../supabase/functions/_shared/prompts";
import { defaultLocalExtractionModelId } from "../../../shared/extraction/config";
import type { LocalChatRunInput, LocalChatRunResult } from "../../ipc/types";
import { runEmbeddedChatPrompt } from "./embeddedCompletion";

function deriveSessionTitle(messages: LocalChatRunInput["messages"]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const words = latestUserMessage
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 6)
    .map((part) => part.replace(/[^a-z0-9-]/gi, ""))
    .filter(Boolean);

  if (words.length === 0) {
    return "New Conversation";
  }

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function buildLocalPrompt(messages: LocalChatRunInput["messages"]): string {
  return [
    "Continue this Trellis conversation and answer the final user message naturally.",
    "",
    ...messages.map((message) =>
      `${message.role === "user" ? "User" : "Assistant"}: ${message.content.trim()}`
    ),
    "",
    "Reply as the assistant."
  ].join("\n");
}

export async function runLocalChatReply(input: LocalChatRunInput): Promise<LocalChatRunResult> {
  const text = await runEmbeddedChatPrompt({
    systemPrompt: buildChatSystemPrompt(input.references ?? []),
    userPrompt: buildLocalPrompt(input.messages),
    maxTokens: 1024,
    temperature: 0.45,
    missingModelErrorMessage:
      "Local-only chat needs the on-device note processor installed. Download it in Settings or switch chat privacy back to Auto."
  });

  return {
    text,
    sessionTitle: deriveSessionTitle(input.messages),
    tokenCount: Math.ceil(text.length / 4),
    provider: "embedded",
    model: defaultLocalExtractionModelId
  };
}
