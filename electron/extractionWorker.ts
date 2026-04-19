/**
 * Utility-process entry point for on-device extraction.
 *
 * Runs inside `utilityProcess.fork` (Electron). The main process posts
 * `ExtractRequestMessage` and receives `ExtractResultMessage` /
 * `ExtractErrorMessage` back over the parent port. Keeps one warm llama
 * model + context + grammar for the lifetime of the process so repeated
 * extractions skip the heavy setup cost.
 */
import { buildExtractionUserMessage } from "@shared/extraction/buildPrompt";
import type { ExtractionPromptInput } from "@shared/extraction/buildPrompt";
import { extractionResponseJsonSchema } from "@shared/extraction/jsonSchema";
import { parseExtractionResponseJson } from "@shared/extraction/validate";
import type { ExtractionSourceType } from "@shared/extraction/contracts";
import {
  getLlama,
  LlamaChatSession,
  QwenChatWrapper,
  type ChatWrapper,
  type LlamaContext,
  type LlamaGrammar,
  type LlamaModel
} from "node-llama-cpp";
import { extractionPrompt } from "../supabase/functions/_shared/prompts";

interface ExtractRequestMessage {
  type: "extract";
  id: string;
  modelPath: string;
  contextSize: number;
  retryThorough: boolean;
  input: ExtractionPromptInput & { sourceType?: ExtractionSourceType; sourcePath?: string };
}

interface DisposeMessage {
  type: "dispose";
  id: string;
}

type IncomingMessage = ExtractRequestMessage | DisposeMessage;

type OutgoingMessage =
  | { type: "ready" }
  | { type: "result"; id: string; response: unknown; model: string | null }
  | { type: "error"; id: string; message: string; issues?: string[]; validation?: boolean }
  | { type: "disposed"; id: string };

interface ParentPortLike {
  on(event: "message", listener: (message: IncomingMessage) => void): void;
  postMessage(message: OutgoingMessage): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;

if (!parentPort) {
  throw new Error("extractionWorker.ts must be launched via Electron utilityProcess.fork.");
}

let model: LlamaModel | null = null;
let context: LlamaContext | null = null;
let grammar: LlamaGrammar | null = null;
let chatWrapper: ChatWrapper | null = null;
let currentContextSize = 0;
let loadPromise: Promise<void> | null = null;
let processingChain: Promise<unknown> = Promise.resolve();

async function ensureLoaded(modelPath: string, contextSize: number): Promise<void> {
  if (!model) {
    if (!loadPromise) {
      loadPromise = (async () => {
        const llama = await getLlama();
        model = await llama.loadModel({ modelPath, gpuLayers: "auto" });
        chatWrapper = new QwenChatWrapper();
        try {
          grammar = await llama.createGrammarForJsonSchema(
            structuredClone(extractionResponseJsonSchema) as Parameters<
              typeof llama.createGrammarForJsonSchema
            >[0]
          );
        } catch {
          grammar = await llama.getGrammarFor("json");
        }
      })();
    }
    await loadPromise;
    loadPromise = null;
  }

  if (!context || currentContextSize !== contextSize) {
    if (context) {
      try {
        await context.dispose();
      } catch {
        // ignore dispose errors during re-size
      }
    }
    context = await model!.createContext({ contextSize });
    currentContextSize = contextSize;
  }
}

async function runExtract(request: ExtractRequestMessage): Promise<OutgoingMessage> {
  await ensureLoaded(request.modelPath, request.contextSize);

  const sequence = context!.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    chatWrapper: chatWrapper!,
    systemPrompt: extractionPrompt,
    autoDisposeSequence: true
  });

  const retrySuffix = request.retryThorough
    ? "\n\n## Second pass\n" +
      "The previous extraction pass returned no durable note operations. Re-read the transcript above. " +
      "If it contains any concrete takeaway, decision, definition, preference, plan, named entity, or technical detail someone might search for later, return one concise synthesis or concept note. " +
      "Prefer updating or creating a real note over noop. Only return an empty updates array if the thread is purely social, empty, or content-free.\n"
    : "";

  try {
    const userMessage = buildExtractionUserMessage(request.input) + retrySuffix;
    const content = (
      await session.prompt(userMessage, {
        grammar: grammar!,
        temperature: request.retryThorough ? 0.42 : 0.22,
        maxTokens: 4096
      })
    ).trim();

    if (!content) {
      return {
        type: "error",
        id: request.id,
        message: "On-device note processing returned an empty response."
      };
    }

    const parsed = parseExtractionResponseJson(content, {
      index: request.input.index,
      sourceType: request.input.sourceType,
      sourcePath: request.input.sourcePath,
      sessionPriorSlugs: request.input.sessionPriorNoteSlugs
    });

    if (!parsed.value) {
      return {
        type: "error",
        id: request.id,
        message: parsed.issues[0]?.message ?? "On-device note processing returned an invalid response.",
        issues: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`),
        validation: true
      };
    }

    return {
      type: "result",
      id: request.id,
      response: parsed.value,
      model: null
    };
  } finally {
    try {
      session.dispose({ disposeSequence: true });
    } catch {
      // ignore
    }
  }
}

async function disposeModel(): Promise<void> {
  try {
    if (context) {
      await context.dispose();
    }
  } catch {
    // ignore
  }
  context = null;
  currentContextSize = 0;
  grammar = null;
  chatWrapper = null;
  try {
    if (model) {
      await model.dispose();
    }
  } catch {
    // ignore
  }
  model = null;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = processingChain.then(fn, fn);
  processingChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

parentPort.on("message", (message) => {
  if (message.type === "extract") {
    void enqueue(async () => {
      try {
        const response = await runExtract(message);
        parentPort.postMessage(response);
      } catch (error) {
        parentPort.postMessage({
          type: "error",
          id: message.id,
          message: error instanceof Error ? error.message : "On-device note processing failed."
        });
      }
    });
    return;
  }

  if (message.type === "dispose") {
    void enqueue(async () => {
      await disposeModel();
      parentPort.postMessage({ type: "disposed", id: message.id });
    });
  }
});

parentPort.postMessage({ type: "ready" });
