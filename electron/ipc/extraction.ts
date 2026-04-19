import { ipcMain } from "electron";
import type { ExtractionInstallProgressEvent } from "@shared/extraction/localModelInstall";
import { z } from "zod";
import {
  ipcChannels,
  type ExtractionRunInput,
  type QueueSessionExtractionInput,
  type QueueSessionExtractionResult
} from "./types";
import { getExtractionRuntimeStatus, runExtraction } from "../lib/extraction/service";
import { listExtractionDebugRuns } from "../lib/extraction/debug";
import {
  installEmbeddedExtractionModel,
  removeEmbeddedExtractionModel
} from "../lib/extraction/providers/embeddedLlama";

const extractionContextNoteSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string()),
  headingPath: z.string().min(1),
  content: z.string().min(1),
  score: z.number(),
  isExplicitMatch: z.boolean().optional(),
  updatedAt: z.string().optional()
});

const extractionInputSchema = z.object({
  mode: z.enum(["local", "cloud"]).optional(),
  chatModel: z.string().min(1).optional(),
  sessionId: z.string().uuid().optional(),
  transcript: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(500_000)
    })
  ),
  index: z.array(
    z.object({
      slug: z.string().min(1),
      title: z.string().min(1),
      tags: z.array(z.string()),
      isPlaceholder: z.boolean().optional()
    })
  ),
  relatedNotes: z.array(extractionContextNoteSchema).optional(),
  sessionPriorNoteSlugs: z.array(z.string().min(1)).optional(),
  sourceType: z.enum(["pdf", "web", "text"]).optional(),
  sourceTitle: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  sourceContent: z.string().min(1).optional(),
  preferredLocalModelId: z.string().min(1).optional(),
  retryThorough: z.boolean().optional()
});

const runtimeStatusSchema = z.object({
  mode: z.enum(["local", "cloud"]).optional(),
  chatModel: z.string().min(1).optional()
});

const queueSessionSchema = z.object({
  sessionId: z.string().uuid(),
  trigger: z.enum(["idle", "session-switch", "manual", "startup"]).optional(),
  mode: z.enum(["local", "cloud"]).optional(),
  preferredLocalModelId: z.string().min(1).optional(),
  force: z.boolean().optional()
});

const localModelIdSchema = z.string().min(1);
const debugRunsLimitSchema = z.number().int().min(1).max(50).optional();

let activeInstallAbort: AbortController | null = null;

export function registerExtractionIpc(orchestrator: {
  queueSession: (input: QueueSessionExtractionInput) => Promise<QueueSessionExtractionResult>;
}): void {
  ipcMain.handle(ipcChannels.extractionGetRuntimeStatus, async (_event, input: unknown) => {
    return getExtractionRuntimeStatus(runtimeStatusSchema.parse(input ?? {}));
  });

  ipcMain.handle(ipcChannels.extractionRun, async (_event, input: unknown) => {
    return runExtraction(extractionInputSchema.parse(input) as ExtractionRunInput);
  });

  ipcMain.handle(ipcChannels.extractionQueueSession, async (_event, input: unknown) => {
    return orchestrator.queueSession(queueSessionSchema.parse(input) as QueueSessionExtractionInput);
  });

  ipcMain.handle(ipcChannels.extractionListDebugRuns, async (_event, limit: unknown) => {
    return listExtractionDebugRuns(debugRunsLimitSchema.parse(limit));
  });

  ipcMain.handle(ipcChannels.extractionInstallLocalModel, async (event, modelId: unknown) => {
    const parsedModelId = localModelIdSchema.parse(modelId);

    if (activeInstallAbort) {
      throw new Error("Another model download is already in progress.");
    }

    activeInstallAbort = new AbortController();

    const sendProgress = (payload: ExtractionInstallProgressEvent): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(ipcChannels.extractionInstallProgress, payload);
      }
    };

    try {
      await installEmbeddedExtractionModel(parsedModelId, sendProgress, activeInstallAbort.signal);
      return getExtractionRuntimeStatus({});
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        sendProgress({ kind: "aborted" });
        throw new Error("Download cancelled.");
      }

      throw error;
    } finally {
      activeInstallAbort = null;
    }
  });

  ipcMain.handle(ipcChannels.extractionCancelInstallLocalModel, async () => {
    activeInstallAbort?.abort();
  });

  ipcMain.handle(ipcChannels.extractionRemoveLocalModel, async (_event, modelId: unknown) => {
    const parsedModelId = localModelIdSchema.parse(modelId);
    await removeEmbeddedExtractionModel(parsedModelId);
    return getExtractionRuntimeStatus({});
  });
}
