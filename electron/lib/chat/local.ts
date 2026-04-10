import { stat } from "node:fs/promises";
import { buildChatSystemPrompt } from "../../../supabase/functions/_shared/prompts";
import { defaultLocalExtractionModelId } from "../../../shared/extraction/config";
import type { LocalChatRunInput, LocalChatRunResult } from "../../ipc/types";
import { getEmbeddedExtractionModelPath } from "../extraction/providers/embeddedLlama";
import {
  getLlama,
  LlamaChatSession,
  QwenChatWrapper,
  type LlamaModel
} from "node-llama-cpp";

interface EmbeddedLoadState {
  model: LlamaModel;
}

let loadState: EmbeddedLoadState | null = null;
let loadPromise: Promise<EmbeddedLoadState> | null = null;
let chatQueue: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chatQueue.then(fn, fn);
  chatQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function statModelPath(modelPath: string): Promise<boolean> {
  try {
    const details = await stat(modelPath);
    return details.isFile() && details.size >= 1024 * 1024;
  } catch {
    return false;
  }
}

async function getLoadedModel(modelPath: string): Promise<LlamaModel> {
  if (loadState) {
    return loadState.model;
  }

  if (loadPromise) {
    return (await loadPromise).model;
  }

  loadPromise = (async () => {
    const llama = await getLlama();
    const model = await llama.loadModel({
      modelPath,
      gpuLayers: "auto"
    });
    const next: EmbeddedLoadState = { model };
    loadState = next;
    loadPromise = null;
    return next;
  })();

  return (await loadPromise).model;
}

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
  const modelPath = getEmbeddedExtractionModelPath();
  const installed = await statModelPath(modelPath);

  if (!installed) {
    throw new Error(
      "Local-only chat needs the on-device note processor installed. Download it in Settings or switch chat privacy back to Auto."
    );
  }

  return runSerialized(async () => {
    const model = await getLoadedModel(modelPath);
    const context = await model.createContext({
      contextSize: 8192
    });
    const sequence = context.getSequence();
    const session = new LlamaChatSession({
      contextSequence: sequence,
      chatWrapper: new QwenChatWrapper(),
      systemPrompt: buildChatSystemPrompt(input.references ?? []),
      autoDisposeSequence: true
    });

    try {
      const text = (
        await session.prompt(buildLocalPrompt(input.messages), {
          temperature: 0.45,
          maxTokens: 1024
        })
      ).trim();

      if (!text) {
        throw new Error("Local-only chat returned an empty response.");
      }

      return {
        text,
        sessionTitle: deriveSessionTitle(input.messages),
        tokenCount: Math.ceil(text.length / 4),
        provider: "embedded",
        model: defaultLocalExtractionModelId
      };
    } finally {
      session.dispose({ disposeSequence: true });
      await context.dispose();
    }
  });
}
