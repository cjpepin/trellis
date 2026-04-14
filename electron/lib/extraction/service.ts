import type {
  ExtractionDebugProviderAttempt,
  ExtractionJobTrigger,
  ExtractionMode,
  ExtractionRunInput,
  ExtractionRunResult,
  ExtractionRuntimeStatus
} from "../../ipc/types";
import {
  createExtractionDebugRun,
  isExtractionValidationError,
  updateExtractionDebugRun
} from "./debug";
import { pickSelectedProviderId } from "./providerSelection";
import { embeddedExtractionProvider } from "./providers/embeddedLlama";
import type { ExtractionProvider } from "./providers/types";
import {
  getLocalExtractionFeatureDisabledReason,
  isLocalExtractionFeatureEnabled
} from "./rollout";

export function resolveExtractionMode(_mode?: ExtractionMode): ExtractionMode {
  return "local";
}

const providers: Record<"embedded", ExtractionProvider> = {
  embedded: embeddedExtractionProvider
};

function buildProviderOrder(_mode: ExtractionMode): ExtractionProvider[] {
  if (!isLocalExtractionFeatureEnabled()) {
    return [];
  }

  return [providers.embedded];
}

interface ExtractionDebugContext {
  runId?: string;
  jobId?: string | null;
  vaultId?: string | null;
  trigger?: ExtractionJobTrigger | null;
  transcriptStartIndex?: number | null;
  transcriptEndIndex?: number | null;
  relatedNoteCount?: number | null;
  seedAttemptedProviders?: ExtractionDebugProviderAttempt[];
}

export async function getExtractionRuntimeStatus(input: {
  mode?: ExtractionMode;
}): Promise<ExtractionRuntimeStatus> {
  const mode = resolveExtractionMode(input.mode);
  const localExtractionEnabled = isLocalExtractionFeatureEnabled();
  const statuses = [
    localExtractionEnabled
      ? providers.embedded.getStatus()
      : Promise.resolve({
          id: "embedded" as const,
          label: "On-device",
          available: false,
          reason: getLocalExtractionFeatureDisabledReason(),
          models: []
        })
  ];
  const resolvedStatuses = await Promise.all(statuses);

  return {
    mode,
    selectedProvider: pickSelectedProviderId(resolvedStatuses),
    providers: resolvedStatuses
  };
}

export async function runExtraction(
  input: ExtractionRunInput,
  debugContext?: ExtractionDebugContext
): Promise<ExtractionRunResult> {
  const mode = resolveExtractionMode(input.mode);
  const order = buildProviderOrder(mode);
  const localExtractionDisabled = !isLocalExtractionFeatureEnabled();
  const errors: string[] = [];
  const attemptedProviders = [...(debugContext?.seedAttemptedProviders ?? [])];
  const run =
    (debugContext?.runId
      ? updateExtractionDebugRun(debugContext.runId, {
          status: "running",
          startedAt: Date.now(),
          transcriptMessageCount: input.transcript.length,
          transcriptStartIndex: debugContext.transcriptStartIndex ?? null,
          transcriptEndIndex: debugContext.transcriptEndIndex ?? null,
          relatedNoteCount: debugContext.relatedNoteCount ?? input.relatedNotes?.length ?? null,
          attemptedProviders,
          errorMessage: null
        })
      : null) ??
    createExtractionDebugRun({
      scope: debugContext?.jobId ? "job" : "direct",
      mode,
      jobId: debugContext?.jobId ?? null,
      sessionId: input.sessionId ?? null,
      vaultId: debugContext?.vaultId ?? null,
      trigger: debugContext?.trigger ?? null,
      transcriptMessageCount: input.transcript.length,
      transcriptStartIndex: debugContext?.transcriptStartIndex ?? null,
      transcriptEndIndex: debugContext?.transcriptEndIndex ?? null,
      relatedNoteCount: debugContext?.relatedNoteCount ?? input.relatedNotes?.length ?? null
    });

  updateExtractionDebugRun(run.id, {
    status: "running",
    startedAt: run.startedAt ?? Date.now(),
    transcriptMessageCount: input.transcript.length,
    transcriptStartIndex: debugContext?.transcriptStartIndex ?? null,
    transcriptEndIndex: debugContext?.transcriptEndIndex ?? null,
    relatedNoteCount: debugContext?.relatedNoteCount ?? input.relatedNotes?.length ?? null,
    attemptedProviders,
    errorMessage: null
  });

  if (localExtractionDisabled || order.length === 0) {
    const message = getLocalExtractionFeatureDisabledReason();
    updateExtractionDebugRun(run.id, {
      status: "failed",
      finishedAt: Date.now(),
      attemptedProviders,
      errorMessage: message
    });
    throw new Error(message);
  }

  for (const provider of order) {
    const attemptStartedAt = Date.now();
    const status = await provider.getStatus();

    if (!status.available) {
      if (status.reason) {
        errors.push(status.reason);
      }
      attemptedProviders.push({
        id: provider.id,
        outcome: "unavailable",
        reason: status.reason,
        durationMs: Date.now() - attemptStartedAt
      });
      continue;
    }

    try {
      const result = await provider.extract({
        transcript: input.transcript,
        sessionId: input.sessionId,
        index: input.index,
        relatedNotes: input.relatedNotes,
        sourceType: input.sourceType,
        sourceTitle: input.sourceTitle,
        sourcePath: input.sourcePath,
        sourceContent: input.sourceContent,
        preferredLocalModelId: input.preferredLocalModelId,
        retryThorough: input.retryThorough
      });
      attemptedProviders.push({
        id: provider.id,
        outcome: "success",
        durationMs: Date.now() - attemptStartedAt
      });
      updateExtractionDebugRun(run.id, {
        status: "completed",
        finishedAt: Date.now(),
        attemptedProviders,
        selectedProvider: result.provider,
        model: result.model,
        requestedUpdateCount: result.response.updates.filter(
          (update) => update.operation !== "noop"
        ).length,
        validationIssues: [],
        errorMessage: null
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown note processing error.";
      errors.push(message);
      attemptedProviders.push({
        id: provider.id,
        outcome: "failed",
        reason: message,
        durationMs: Date.now() - attemptStartedAt
      });
      updateExtractionDebugRun(run.id, {
        attemptedProviders,
        validationIssues: isExtractionValidationError(error) ? error.issues : [],
        errorMessage: message
      });

      updateExtractionDebugRun(run.id, {
        status: "failed",
        finishedAt: Date.now(),
        attemptedProviders,
        errorMessage: message
      });
      throw new Error(message);
    }
  }

  const finalMessage = errors[0] ?? "No note processing provider is available.";
  updateExtractionDebugRun(run.id, {
    status: "failed",
    finishedAt: Date.now(),
    attemptedProviders,
    errorMessage: finalMessage
  });
  throw new Error(finalMessage);
}
