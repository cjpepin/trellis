import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { finished } from "node:stream/promises";
import {
  defaultEmbeddedExtractionModelDownloadUrl,
  defaultLocalExtractionModelId,
  embeddedExtractionGgufFilename
} from "@shared/extraction/config";
import type { ExtractionInstallProgressEvent } from "@shared/extraction/localModelInstall";
import type {
  LocalExtractionModelInfo,
  ExtractionProviderStatus,
  ExtractionRunResult
} from "../../../ipc/types";
import { getUserDataRoot } from "../../appPaths";
import type { ExtractionProvider, ProviderExtractInput } from "./types";
import {
  disposeExtractionWorker,
  runExtractionInWorker
} from "./workerClient";

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
  return fromEnv && fromEnv.length > 0 ? fromEnv : defaultEmbeddedExtractionModelDownloadUrl;
}

export async function disposeEmbeddedModel(): Promise<void> {
  await disposeExtractionWorker();
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

/**
 * Choose the smallest context size that still holds the prompt with headroom.
 * Smaller contexts materially reduce KV-cache allocation time on each call
 * when the worker resizes the context for a new extraction.
 */
function chooseContextSize(input: ProviderExtractInput): number {
  const transcriptChars = input.transcript.reduce(
    (sum, turn) => sum + turn.content.length,
    0
  );
  const relatedChars = (input.relatedNotes ?? []).reduce(
    (sum, note) => sum + (note.content?.length ?? 0),
    0
  );
  const sourceChars = input.sourceContent?.length ?? 0;
  const totalChars = transcriptChars + relatedChars + sourceChars;

  const approxInputTokens = Math.ceil(totalChars / 4);
  const budget = approxInputTokens + 4096 + 512;

  if (budget <= 2048) return 2048;
  if (budget <= 4096) return 4096;
  if (budget <= 6144) return 6144;
  return 8192;
}

async function runEmbeddedExtraction(input: ProviderExtractInput): Promise<ExtractionRunResult> {
  const modelPath = getEmbeddedExtractionModelPath();
  const st = await statModelPath(modelPath);

  if (!st) {
    throw new Error("The on-device note processor is not installed yet.");
  }

  const contextSize = chooseContextSize(input);

  const response = await runExtractionInWorker({
    modelPath,
    contextSize,
    retryThorough: input.retryThorough ?? false,
    input: {
      transcript: input.transcript,
      index: input.index,
      relatedNotes: input.relatedNotes,
      sourceType: input.sourceType,
      sourceTitle: input.sourceTitle,
      sourcePath: input.sourcePath,
      sourceContent: input.sourceContent
    }
  });

  return {
    response,
    provider: "embedded",
    model: defaultLocalExtractionModelId
  };
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
