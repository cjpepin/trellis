import { providerForChatModel } from "@trellis/shared/chat/providerForModel";
import type {
  ExtractionDebugProviderAttempt,
  ExtractionJobTrigger,
  ExtractionMode,
  ExtractionRunInput,
  ExtractionRunResult,
  ExtractionRuntimeStatus,
  ChatProvider
} from "../../ipc/types";
import {
  createExtractionDebugRun,
  isExtractionValidationError,
  updateExtractionDebugRun
} from "./debug";
import { pickSelectedProviderId } from "./providerSelection";
import { embeddedExtractionProvider } from "./providers/embeddedLlama";
import { createCloudExtractionProvider } from "./providers/cloudApi";
import type { ExtractionProvider } from "./providers/types";
import {
  getLocalExtractionFeatureDisabledReason,
  isLocalExtractionFeatureEnabled
} from "./rollout";
import { buildExtractionProviderIdsForOrder, resolveExtractionMode } from "./providerOrder";

export { resolveExtractionMode } from "./providerOrder";

const providers: Record<string, ExtractionProvider> = {
  embedded: embeddedExtractionProvider
};

export function registerCloudExtractionProviders(deps: {
  getOpenAiKey: () => string | null;
  getAnthropicKey: () => string | null;
}): void {
  providers["cloud-openai"] = createCloudExtractionProvider("openai", deps.getOpenAiKey);
  providers["cloud-anthropic"] = createCloudExtractionProvider("anthropic", deps.getAnthropicKey);
}

function buildProviderOrder(mode: ExtractionMode, chatProvider: ChatProvider | null): ExtractionProvider[] {
  const ids = buildExtractionProviderIdsForOrder(mode, chatProvider);
  const out: ExtractionProvider[] = [];
  for (const id of ids) {
    const p = providers[id];
    if (p) {
      out.push(p);
    }
  }
  return out;
}

interface ExtractionDebugContext {
  runId?: string;
  jobId?: string | null;
  bucketId?: string | null;
  trigger?: ExtractionJobTrigger | null;
  transcriptStartIndex?: number | null;
  transcriptEndIndex?: number | null;
  relatedNoteCount?: number | null;
  seedAttemptedProviders?: ExtractionDebugProviderAttempt[];
}

export async function getExtractionRuntimeStatus(input: {
  mode?: ExtractionMode;
  chatModel?: string;
}): Promise<ExtractionRuntimeStatus> {
  const mode = resolveExtractionMode(input.chatModel);
  const chatProvider: ChatProvider | null = input.chatModel ? providerForChatModel(input.chatModel) : null;
  const order = buildProviderOrder(mode, chatProvider);
  const resolvedStatuses = await Promise.all(order.map((provider) => provider.getStatus()));

  // Always include the embedded provider in the status so the Settings UI can show
  // its availability and reason even when local extraction is disabled or when a
  // cloud provider is first in the order.
  const hasEmbedded = resolvedStatuses.some((s) => s.id === "embedded");
  if (!hasEmbedded && providers.embedded) {
    const embeddedStatus = await providers.embedded.getStatus();
    resolvedStatuses.push(embeddedStatus);
  }

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
  const mode = resolveExtractionMode(input.chatModel);
  const chatProvider: ChatProvider | null = input.chatModel ? providerForChatModel(input.chatModel) : null;
  const order = buildProviderOrder(mode, chatProvider);
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
      bucketId: debugContext?.bucketId ?? null,
      trigger: debugContext?.trigger ?? null,
      transcriptMessageCount: input.transcript.length,
      transcriptStartIndex: debugContext?.transcriptStartIndex ?? null,
      transcriptEndIndex: debugContext?.transcriptEndIndex ?? null,
      relatedNoteCount: debugContext?.relatedNoteCount ?? input.relatedNotes?.length ?? null,
      requestedProviderOrder: buildExtractionProviderIdsForOrder(mode, chatProvider)
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

  if (order.length === 0) {
    const message =
      !isLocalExtractionFeatureEnabled() && mode === "local"
        ? getLocalExtractionFeatureDisabledReason()
        : "No note processing provider is available.";
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
        sessionPriorNoteSlugs: input.sessionPriorNoteSlugs,
        sessionPriorNoteContents: input.sessionPriorNoteContents,
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
      continue;
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
