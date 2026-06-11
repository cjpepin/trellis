/**
 * Main-process client for the on-device extraction utility process.
 *
 * Keeps a single `utilityProcess` warm for the lifetime of the app so the
 * llama model, grammar, and context are only loaded once. If the worker
 * crashes, in-flight promises reject and the next call respawns.
 */
import { utilityProcess, type UtilityProcess } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ExtractionResponse,
  ExtractionSourceType
} from "@trellis/shared/extraction/contracts";
import type { ExtractionPromptInput } from "@trellis/shared/extraction/buildPrompt";
import { ExtractionValidationError } from "../debug";

/** Same directory as the main bundle (`main.js`), where `extractionWorker.js` is emitted. */
const mainBundleDir = path.dirname(fileURLToPath(import.meta.url));

interface PendingRequest {
  resolve: (value: ExtractionResponse) => void;
  reject: (error: Error) => void;
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "result"; id: string; response: ExtractionResponse; model: string | null }
  | { type: "error"; id: string; message: string; issues?: string[]; validation?: boolean }
  | { type: "disposed"; id: string };

let workerProcess: UtilityProcess | null = null;
let readyPromise: Promise<void> | null = null;
const pending = new Map<string, PendingRequest>();

function resolveWorkerEntry(): string {
  return path.join(mainBundleDir, "extractionWorker.js");
}

function rejectAllPending(error: Error): void {
  for (const req of pending.values()) {
    req.reject(error);
  }
  pending.clear();
}

function teardown(): void {
  workerProcess = null;
  readyPromise = null;
}

async function ensureWorker(): Promise<UtilityProcess> {
  if (workerProcess && readyPromise) {
    await readyPromise;
    return workerProcess;
  }

  const proc = utilityProcess.fork(resolveWorkerEntry(), [], {
    serviceName: "trellis-extraction-worker",
    stdio: "inherit"
  });
  workerProcess = proc;

  readyPromise = new Promise<void>((resolve, reject) => {
    const onMessage = (raw: unknown) => {
      const message = raw as WorkerMessage;
      if (message?.type === "ready") {
        proc.off("message", onMessage);
        resolve();
      }
    };
    const onExit = (code: number) => {
      reject(new Error(`Extraction worker exited before ready (code ${code}).`));
    };
    proc.on("message", onMessage);
    proc.once("exit", onExit);
  });

  proc.on("message", (raw: unknown) => {
    const message = raw as WorkerMessage;
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "result") {
      const req = pending.get(message.id);
      if (!req) return;
      pending.delete(message.id);
      req.resolve(message.response);
      return;
    }
    if (message.type === "error") {
      const req = pending.get(message.id);
      if (!req) return;
      pending.delete(message.id);
      if (message.validation) {
        req.reject(
          new ExtractionValidationError(message.message, message.issues ?? [])
        );
      } else {
        req.reject(new Error(message.message));
      }
    }
  });

  proc.on("exit", (code) => {
    rejectAllPending(
      new Error(`Extraction worker exited unexpectedly (code ${code ?? "?"}).`)
    );
    teardown();
  });

  await readyPromise;
  return proc;
}

export interface WorkerExtractRequest {
  modelPath: string;
  contextSize: number;
  retryThorough: boolean;
  input: ExtractionPromptInput & {
    sourceType?: ExtractionSourceType;
    sourcePath?: string;
  };
}

export async function runExtractionInWorker(
  request: WorkerExtractRequest
): Promise<ExtractionResponse> {
  const proc = await ensureWorker();
  const id = randomUUID();

  return new Promise<ExtractionResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    proc.postMessage({
      type: "extract",
      id,
      modelPath: request.modelPath,
      contextSize: request.contextSize,
      retryThorough: request.retryThorough,
      input: request.input
    });
  });
}

export async function disposeExtractionWorker(): Promise<void> {
  const proc = workerProcess;
  if (!proc) {
    return;
  }

  const id = randomUUID();
  const disposed = new Promise<void>((resolve) => {
    const onMessage = (raw: unknown) => {
      const message = raw as WorkerMessage;
      if (message?.type === "disposed" && message.id === id) {
        proc.off("message", onMessage);
        resolve();
      }
    };
    proc.on("message", onMessage);
  });

  try {
    proc.postMessage({ type: "dispose", id });
    await Promise.race([
      disposed,
      new Promise<void>((r) => setTimeout(r, 3000))
    ]);
  } catch {
    // worker already gone
  }

  try {
    proc.kill();
  } catch {
    // ignore
  }
  rejectAllPending(new Error("Extraction worker was disposed."));
  teardown();
}
