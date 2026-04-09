import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { finished } from "node:stream/promises";
import { buildExtractionUserMessage } from "@shared/extraction/buildPrompt";
import {
  defaultEmbeddedExtractionModelDownloadUrl,
  defaultLocalExtractionModelId,
  embeddedExtractionGgufFilename
} from "@shared/extraction/config";
import { extractionResponseJsonSchema } from "@shared/extraction/jsonSchema";
import type { ExtractionInstallProgressEvent } from "@shared/extraction/localModelInstall";
import { parseExtractionResponseJson } from "@shared/extraction/validate";
import { app } from "electron";
import {
  getLlama,
  LlamaChatSession,
  QwenChatWrapper,
  type LlamaGrammar,
  type LlamaModel
} from "node-llama-cpp";
import { extractionPrompt } from "../../../../supabase/functions/_shared/prompts";
import type {
  LocalExtractionModelInfo,
  ExtractionProviderStatus,
  ExtractionRunResult
} from "../../../ipc/types";
import { ExtractionValidationError } from "../debug";
import type { ExtractionProvider, ProviderExtractInput } from "./types";

const curatedEmbeddedModels: Array<Omit<LocalExtractionModelInfo, "installed" | "available">> = [
  {
    id: defaultLocalExtractionModelId,
    label: "On-device note processor (Qwen 2.5 3B Instruct)",
    runtime: "embedded",
    purpose: "extraction",
    recommended: true
  }
];

function extractionModelsDir(): string {
  return path.join(app.getPath("userData"), "extraction", "models");
}

export function getEmbeddedExtractionModelPath(): string {
  return path.join(extractionModelsDir(), embeddedExtractionGgufFilename);
}

function resolveDownloadUrl(): string {
  const fromEnv = process.env.TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : defaultEmbeddedExtractionModelDownloadUrl;
}

interface EmbeddedLoadState {
  model: LlamaModel;
}

let loadState: EmbeddedLoadState | null = null;
let loadPromise: Promise<EmbeddedLoadState> | null = null;
let extractionQueue: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = extractionQueue.then(fn, fn);
  extractionQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

export async function disposeEmbeddedModel(): Promise<void> {
  const pending = loadPromise;
  loadPromise = null;
  if (pending) {
    try {
      const s = await pending;
      await s.model.dispose();
    } catch {
      // ignore load failures while tearing down
    }
    loadState = null;
    return;
  }

  const prior = loadState;
  loadState = null;
  if (prior) {
    await prior.model.dispose();
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

async function statModelPath(modelPath: string): Promise<{ sizeBytes: number } | null> {
  try {
    const s = await stat(modelPath);
    if (!s.isFile() || s.size < 1024 * 1024) {
      return null;
    }
    return { sizeBytes: s.size };
  } catch {
    return null;
  }
}

async function buildResponseGrammar(model: LlamaModel): Promise<LlamaGrammar> {
  const llama = model.llama;
  try {
    return await llama.createGrammarForJsonSchema(
      structuredClone(extractionResponseJsonSchema) as Parameters<
        typeof llama.createGrammarForJsonSchema
      >[0]
    );
  } catch {
    return await llama.getGrammarFor("json");
  }
}

async function runEmbeddedExtraction(input: ProviderExtractInput): Promise<ExtractionRunResult> {
  const modelPath = getEmbeddedExtractionModelPath();
  const st = await statModelPath(modelPath);

  if (!st) {
    throw new Error("The on-device note processor is not installed yet.");
  }

  return runSerialized(async () => {
    const model = await getLoadedModel(modelPath);
    const context = await model.createContext({
      contextSize: 8192
    });

    const sequence = context.getSequence();
    const grammar = await buildResponseGrammar(model);

    const session = new LlamaChatSession({
      contextSequence: sequence,
      chatWrapper: new QwenChatWrapper(),
      systemPrompt: extractionPrompt,
      autoDisposeSequence: true
    });

    try {
      const userMessage = buildExtractionUserMessage(input);
      const content = (
        await session.prompt(userMessage, {
          grammar,
          temperature: 0.2,
          maxTokens: 4096
        })
      ).trim();

      if (!content) {
        throw new Error("On-device note processing returned an empty response.");
      }

      const parsed = parseExtractionResponseJson(content, {
        index: input.index,
        sourceType: input.sourceType,
        sourcePath: input.sourcePath
      });

      if (!parsed.value) {
        throw new ExtractionValidationError(
          parsed.issues[0]?.message ?? "On-device note processing returned an invalid response.",
          parsed.issues.map((issue) => `${issue.path}: ${issue.message}`)
        );
      }

      return {
        response: parsed.value,
        provider: "embedded",
        model: defaultLocalExtractionModelId
      };
    } finally {
      session.dispose({ disposeSequence: true });
      await context.dispose();
    }
  });
}

export const embeddedExtractionProvider: ExtractionProvider = {
  id: "embedded",
  async getStatus(): Promise<ExtractionProviderStatus> {
    const modelPath = getEmbeddedExtractionModelPath();
    const st = await statModelPath(modelPath);
    const installed = Boolean(st);

    const models: LocalExtractionModelInfo[] = curatedEmbeddedModels.map((row) => ({
      ...row,
      available: true,
      installed,
      sizeBytes: st?.sizeBytes,
      variant: embeddedExtractionGgufFilename
    }));

    return {
      id: "embedded",
      label: "On-device",
      available: installed,
      reason: installed
        ? undefined
        : "Download the on-device note processor once to turn chats into notes on this device.",
      selectedModel: installed ? defaultLocalExtractionModelId : null,
      models
    };
  },
  extract: runEmbeddedExtraction
};

export async function installEmbeddedExtractionModel(
  modelId: string,
  onProgress?: (payload: ExtractionInstallProgressEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  if (modelId !== defaultLocalExtractionModelId) {
    throw new Error("That on-device note processor is not available in this version of Trellis.");
  }

  const destDir = extractionModelsDir();
  await mkdir(destDir, { recursive: true });
  const finalPath = getEmbeddedExtractionModelPath();
  const tempPath = `${finalPath}.download`;

  try {
    await unlink(tempPath);
  } catch {
    // ignore
  }

  const url = resolveDownloadUrl();
  onProgress?.({ kind: "status", status: "Connecting…" });

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(
      "Could not download the on-device note processor. Check your network and try again."
    );
  }

  const totalRaw = response.headers.get("content-length");
  const total = totalRaw ? Number(totalRaw) : 0;
  const body = response.body;

  if (!body) {
    throw new Error("Download did not return a response body.");
  }

  let completed = 0;
  const reader = body.getReader();
  const stream = createWriteStream(tempPath);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value?.byteLength) {
        continue;
      }
      const buf = Buffer.from(value);
      completed += buf.length;
      if (total > 0) {
        onProgress?.({ kind: "layer", completed, total });
      } else {
        onProgress?.({
          kind: "status",
          status: `Downloaded ${(completed / (1024 * 1024)).toFixed(1)} MB`
        });
      }
      if (!stream.write(buf)) {
        await once(stream, "drain");
      }
    }
  } finally {
    stream.end();
    await finished(stream);
  }

  await disposeEmbeddedModel();
  await rename(tempPath, finalPath);
  onProgress?.({ kind: "complete" });
}

export async function removeEmbeddedExtractionModel(modelId: string): Promise<void> {
  if (modelId !== defaultLocalExtractionModelId) {
    throw new Error("That on-device note processor is not available in this version of Trellis.");
  }

  await disposeEmbeddedModel();

  try {
    await unlink(getEmbeddedExtractionModelPath());
  } catch {
    throw new Error("Could not remove the on-device note processor file.");
  }
}
