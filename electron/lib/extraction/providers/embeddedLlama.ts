import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { finished } from "node:stream/promises";
import { buildExtractionUserMessage } from "@shared/extraction/buildPrompt";
import {
  defaultEmbeddedExtractionModelDownloadUrl,
  defaultLocalExtractionModelId,
  embeddedExtractionGgufFilename,
  embeddedExtractionGgufSha256Hex,
  embeddedExtractionMaxTokensPrimary,
  embeddedExtractionMaxTokensRetry
} from "@shared/extraction/config";
import { extractionResponseJsonSchema } from "@shared/extraction/jsonSchema";
import type { ExtractionInstallProgressEvent } from "@shared/extraction/localModelInstall";
import { parseExtractionResponseJson } from "@shared/extraction/validate";
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
import { getUserDataRoot } from "../../appPaths";
import { ExtractionValidationError } from "../debug";
import type { ExtractionProvider, ProviderExtractInput } from "./types";

/**
 * On-device extraction uses a small GGUF for local-first chat and offline fallback when
 * cloud extraction is unavailable. Product quality for cloud sessions should target the
 * cloud extraction path; this stack is maintained for resilience, not parity with API models.
 */
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
  return path.join(getUserDataRoot(), "extraction", "models");
}

export function getEmbeddedExtractionModelPath(): string {
  return path.join(extractionModelsDir(), embeddedExtractionGgufFilename);
}

function resolveDownloadUrl(): string {
  const fromEnv = process.env.TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL?.trim();
  if (!fromEnv || fromEnv.length === 0) {
    return defaultEmbeddedExtractionModelDownloadUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(fromEnv);
  } catch {
    console.warn("TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL is not a valid URL; using default download URL.");
    return defaultEmbeddedExtractionModelDownloadUrl;
  }

  if (parsed.protocol !== "https:") {
    console.warn("TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL must use https; using default download URL.");
    return defaultEmbeddedExtractionModelDownloadUrl;
  }

  const host = parsed.hostname.toLowerCase();
  const allowed =
    host === "huggingface.co" ||
    host.endsWith(".huggingface.co") ||
    host === "cdn-lfs.huggingface.co" ||
    host.endsWith(".hf.co");

  if (!allowed) {
    console.warn(
      "TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL hostname is not allow-listed; using default download URL."
    );
    return defaultEmbeddedExtractionModelDownloadUrl;
  }

  console.warn("Using TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL override for on-device model download.");
  return fromEnv;
}

async function safelyUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // ignore
  }
}

interface EmbeddedLoadState {
  model: LlamaModel;
}

let loadState: EmbeddedLoadState | null = null;
let loadPromise: Promise<EmbeddedLoadState> | null = null;
let extractionQueue: Promise<unknown> = Promise.resolve();
/** Reuse JSON grammar for the pinned GGUF path to avoid rebuilding each job. */
let cachedGrammar: { modelPath: string; grammar: LlamaGrammar } | null = null;

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = extractionQueue.then(fn, fn);
  extractionQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

export async function disposeEmbeddedModel(): Promise<void> {
  cachedGrammar = null;
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

async function getOrCreateResponseGrammar(model: LlamaModel, modelPath: string): Promise<LlamaGrammar> {
  if (cachedGrammar && cachedGrammar.modelPath === modelPath) {
    return cachedGrammar.grammar;
  }
  const grammar = await buildResponseGrammar(model);
  cachedGrammar = { modelPath, grammar };
  return grammar;
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
    const grammar = await getOrCreateResponseGrammar(model, modelPath);

    const session = new LlamaChatSession({
      contextSequence: sequence,
      chatWrapper: new QwenChatWrapper(),
      systemPrompt: extractionPrompt,
      autoDisposeSequence: true
    });

    const retrySuffix = input.retryThorough
      ? "\n\n## Second pass\n" +
        "The previous extraction pass returned no durable note operations. Re-read the transcript above. " +
        "If it contains any concrete takeaway, decision, definition, preference, plan, named entity, or technical detail someone might search for later, return one concise synthesis or concept note. " +
        "Prefer updating or creating a real note over noop. Only return an empty updates array if the thread is purely social, empty, or content-free.\n"
      : "";

    try {
      const userMessage = buildExtractionUserMessage(input) + retrySuffix;
      const content = (
        await session.prompt(userMessage, {
          grammar,
          temperature: input.retryThorough ? 0.42 : 0.22,
          maxTokens: input.retryThorough ? embeddedExtractionMaxTokensRetry : embeddedExtractionMaxTokensPrimary
        })
      ).trim();

      if (!content) {
        throw new Error("On-device note processing returned an empty response.");
      }

      const parsed = parseExtractionResponseJson(content, {
        index: input.index,
        sourceType: input.sourceType,
        sourcePath: input.sourcePath,
        sessionPriorSlugs: input.sessionPriorNoteSlugs
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

  await safelyUnlink(tempPath);

  const url = resolveDownloadUrl();
  onProgress?.({ kind: "status", status: "Connecting…" });

  const hash = createHash("sha256");

  try {
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
        hash.update(buf);
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

    if (total > 0 && completed !== total) {
      throw new Error(
        "Download size mismatch (connection may have been cut off). Try downloading again."
      );
    }

    const digestHex = hash.digest("hex");
    if (
      typeof embeddedExtractionGgufSha256Hex === "string" &&
      embeddedExtractionGgufSha256Hex.length === 64 &&
      embeddedExtractionGgufSha256Hex !== digestHex
    ) {
      throw new Error(
        "Downloaded model file did not match the expected checksum. Try downloading again."
      );
    }

    await disposeEmbeddedModel();
    await rename(tempPath, finalPath);
    onProgress?.({ kind: "complete" });
  } catch (error) {
    await safelyUnlink(tempPath);
    throw error;
  }
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
