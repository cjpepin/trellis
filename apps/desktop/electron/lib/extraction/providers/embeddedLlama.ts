import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { finished } from "node:stream/promises";
import {
  defaultEmbeddedExtractionModelDownloadUrl,
  defaultLocalExtractionModelId,
  embeddedExtractionGgufFilename,
  embeddedExtractionGgufSha256Hex
} from "@trellis/shared/extraction/config";
import type { ExtractionInstallProgressEvent } from "@trellis/shared/extraction/localModelInstall";
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
      sessionPriorNoteSlugs: input.sessionPriorNoteSlugs,
      sessionPriorNoteContents: input.sessionPriorNoteContents,
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
