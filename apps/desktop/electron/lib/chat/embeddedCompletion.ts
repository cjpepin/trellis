import type { LlamaModel } from "node-llama-cpp";
import { getEmbeddedChatModelPath, isEmbeddedModelAvailable as isEmbeddedModelFilePresent } from "./embeddedModelPath";

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

async function getLoadedModel(modelPath: string): Promise<LlamaModel> {
  if (loadState) {
    return loadState.model;
  }

  if (loadPromise) {
    return (await loadPromise).model;
  }

  loadPromise = (async () => {
    const { getLlama } = await import("node-llama-cpp");
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

export async function runEmbeddedChatPrompt(input: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  missingModelErrorMessage?: string;
  /** Stream assistant text as it is generated (node-llama-cpp `onTextChunk`). */
  onTextChunk?: (text: string) => void;
}): Promise<string> {
  const modelPath = getEmbeddedChatModelPath();
  const installed = await isEmbeddedModelFilePresent();

  if (!installed) {
    throw new Error(
      input.missingModelErrorMessage ??
        "The on-device model is not installed. Download it in Settings."
    );
  }

  return runSerialized(async () => {
    const { LlamaChatSession, QwenChatWrapper } = await import("node-llama-cpp");
    const model = await getLoadedModel(modelPath);
    const context = await model.createContext({
      contextSize: 8192
    });
    const sequence = context.getSequence();
    const session = new LlamaChatSession({
      contextSequence: sequence,
      chatWrapper: new QwenChatWrapper(),
      systemPrompt: input.systemPrompt,
      autoDisposeSequence: true
    });

    try {
      const text = (
        await session.prompt(input.userPrompt, {
          temperature: input.temperature ?? 0.4,
          maxTokens: input.maxTokens ?? 1536,
          ...(input.onTextChunk ? { onTextChunk: input.onTextChunk } : {})
        })
      ).trim();

      if (!text) {
        throw new Error("The on-device model returned an empty response.");
      }

      return text;
    } finally {
      session.dispose({ disposeSequence: true });
      await context.dispose();
    }
  });
}
