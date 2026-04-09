import type {
  ExtractionCloudConfig,
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
import { cloudExtractionProvider } from "./providers/cloud";
import { embeddedExtractionProvider } from "./providers/embeddedLlama";
import type { ExtractionProvider } from "./providers/types";
import {
  getLocalExtractionFeatureDisabledReason,
  isLocalExtractionFeatureEnabled
} from "./rollout";

export function resolveExtractionMode(mode?: ExtractionMode): ExtractionMode {
  if (mode !== undefined) {
    return mode;
  }

  return isLocalExtractionFeatureEnabled() ? "local" : "cloud";
}

const providers: Record<"cloud" | "embedded", ExtractionProvider> = {
  cloud: cloudExtractionProvider,
  embedded: embeddedExtractionProvider
};

function buildProviderOrder(mode: ExtractionMode): ExtractionProvider[] {
  const localExtractionEnabled = isLocalExtractionFeatureEnabled();

  if (mode === "cloud") {
    return [providers.cloud];
  }

  if (!localExtractionEnabled) {
    return mode === "auto" ? [providers.cloud] : [];
  }

  if (mode === "local") {
    return [providers.embedded];
  }

  return [providers.embedded, providers.cloud];
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
  cloud?: ExtractionCloudConfig;
}): Promise<ExtractionRuntimeStatus> {
  const mode = resolveExtractionMode(input.mode);
  const localExtractionEnabled = isLocalExtractionFeatureEnabled();
  const statuses = await Promise.all([
    localExtractionEnabled
      ? providers.embedded.getStatus({ cloud: input.cloud })
      : Promise.resolve({
          id: "embedded" as const,
          label: "On-device",
          available: false,
          reason: getLocalExtractionFeatureDisabledReason(),
          models: []
        }),
    providers.cloud.getStatus({ cloud: input.cloud })
  ]);

  return {
    mode,
    selectedProvider: pickSelectedProviderId(statuses, mode),
    providers: statuses
  };
}

export async function runExtraction(
  input: ExtractionRunInput,
  debugContext?: ExtractionDebugContext
): Promise<ExtractionRunResult> {
  const mode = resolveExtractionMode(input.mode);
  const order = buildProviderOrder(mode);
  const localExtractionDisabled = mode === "local" && !isLocalExtractionFeatureEnabled();
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
    const status = await provider.getStatus({ cloud: input.cloud });

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
      const result = await provider.extract(input);
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

      if (mode !== "auto") {
        updateExtractionDebugRun(run.id, {
          status: "failed",
          finishedAt: Date.now(),
          attemptedProviders,
          errorMessage: message
        });
        throw new Error(message);
      }
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
