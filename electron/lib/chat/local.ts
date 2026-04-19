import { buildChatSystemPrompt } from "../../../supabase/functions/_shared/prompts";
import { deriveSessionTitle } from "../../../shared/chat/deriveSessionTitle";
import { defaultLocalExtractionModelId } from "../../../shared/extraction/config";
import type { ChatStreamEvent, LocalChatRunInput, LocalChatRunResult } from "../../ipc/types";
import { runEmbeddedChatPrompt } from "./embeddedCompletion";

let e2eStubReplyCount = 0;

function shouldUseE2eLocalReplyStub(): boolean {
  return process.env.TRELLIS_E2E_STUB_LOCAL_REPLY === "1";
}

async function runE2eLocalReplyStub(
  input: LocalChatRunInput
): Promise<LocalChatRunResult> {
  e2eStubReplyCount += 1;
  const current = e2eStubReplyCount;
  const delayMs = Number(process.env.TRELLIS_E2E_STUB_LOCAL_REPLY_DELAY_MS ?? 0);

  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const text = `Stubbed reply ${current}.`;

  return {
    text,
    sessionTitle: deriveSessionTitle(input.messages, { assistantReply: text }),
    tokenCount: Math.ceil(text.length / 4),
    provider: "embedded",
    model: "e2e-stub"
  };
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
  if (shouldUseE2eLocalReplyStub()) {
    return runE2eLocalReplyStub(input);
  }

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
    sessionTitle: deriveSessionTitle(input.messages, { assistantReply: text }),
    tokenCount: Math.ceil(text.length / 4),
    provider: "embedded",
    model: defaultLocalExtractionModelId
  };
}

export async function runLocalChatReplyStream(
  input: LocalChatRunInput,
  emit: (type: ChatStreamEvent["type"], payload: string) => void
): Promise<void> {
  emit("status", "Thinking");

  if (shouldUseE2eLocalReplyStub()) {
    const result = await runE2eLocalReplyStub(input);
    for (const token of result.text.split(/(\s+)/)) {
      if (token.length > 0) {
        emit("token", token);
      }
    }
    emit("title", result.sessionTitle);
    emit("done", "ok");
    return;
  }

  const text = await runEmbeddedChatPrompt({
    systemPrompt: buildChatSystemPrompt(input.references ?? []),
    userPrompt: buildLocalPrompt(input.messages),
    maxTokens: 1024,
    temperature: 0.45,
    missingModelErrorMessage:
      "Local-only chat needs the on-device note processor installed. Download it in Settings or switch chat privacy back to Auto.",
    onTextChunk: (chunk) => {
      if (chunk.length > 0) {
        emit("token", chunk);
      }
    }
  });

  emit("title", deriveSessionTitle(input.messages, { assistantReply: text }));
  emit("done", "ok");
}
