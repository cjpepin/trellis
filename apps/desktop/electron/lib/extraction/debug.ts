import type {
  ChatProvider,
  ExtractionDebugRun,
  ExtractionMode,
  ExtractionJobTrigger,
  ExtractionProviderId
} from "../../ipc/types";
import { buildExtractionProviderIdsForOrder } from "./providerOrder";

const maxDebugRuns = 50;
const debugRuns = new Map<string, ExtractionDebugRun>();
const debugRunOrder: string[] = [];

export class ExtractionValidationError extends Error {
  issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "ExtractionValidationError";
    this.issues = issues;
  }
}

export function isExtractionValidationError(error: unknown): error is ExtractionValidationError {
  return error instanceof ExtractionValidationError;
}

function insertDebugRun(id: string): void {
  const existingIndex = debugRunOrder.indexOf(id);

  if (existingIndex >= 0) {
    debugRunOrder.splice(existingIndex, 1);
  }

  debugRunOrder.unshift(id);

  while (debugRunOrder.length > maxDebugRuns) {
    const removedId = debugRunOrder.pop();

    if (removedId) {
      debugRuns.delete(removedId);
    }
  }
}

export function buildRequestedProviderOrder(
  mode: ExtractionMode,
  chatProvider?: ChatProvider | null
): ExtractionProviderId[] {
  return buildExtractionProviderIdsForOrder(mode, chatProvider ?? null);
}

export function createExtractionDebugRun(input: {
  scope: "job" | "direct";
  mode: ExtractionMode;
  jobId?: string | null;
  sessionId?: string | null;
  bucketId?: string | null;
  trigger?: ExtractionJobTrigger | null;
  transcriptMessageCount?: number;
  transcriptStartIndex?: number | null;
  transcriptEndIndex?: number | null;
  relatedNoteCount?: number | null;
  requestedProviderOrder?: ExtractionProviderId[];
  /** Used when `requestedProviderOrder` is omitted. */
  chatProviderForOrder?: ChatProvider | null;
}): ExtractionDebugRun {
  const run: ExtractionDebugRun = {
    id: crypto.randomUUID(),
    scope: input.scope,
    status: "queued",
    mode: input.mode,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    prepDurationMs: null,
    llmPrimaryDurationMs: null,
    llmRetryThoroughDurationMs: null,
    jobId: input.jobId ?? null,
    sessionId: input.sessionId ?? null,
    bucketId: input.bucketId ?? null,
    trigger: input.trigger ?? null,
    transcriptMessageCount: input.transcriptMessageCount ?? 0,
    transcriptStartIndex: input.transcriptStartIndex ?? null,
    transcriptEndIndex: input.transcriptEndIndex ?? null,
    relatedNoteCount: input.relatedNoteCount ?? null,
    requestedUpdateCount: null,
    appliedUpdateCount: null,
    guardrailDropCount: null,
    requestedProviderOrder:
      input.requestedProviderOrder ??
      buildRequestedProviderOrder(input.mode, input.chatProviderForOrder ?? null),
    attemptedProviders: [],
    selectedProvider: null,
    model: null,
    validationIssues: [],
    errorMessage: null
  };

  debugRuns.set(run.id, run);
  insertDebugRun(run.id);
  return run;
}

export function getExtractionDebugRun(id: string): ExtractionDebugRun | null {
  return debugRuns.get(id) ?? null;
}

export function updateExtractionDebugRun(
  id: string,
  patch: Partial<Omit<ExtractionDebugRun, "id" | "createdAt" | "scope" | "mode">>
): ExtractionDebugRun | null {
  const existing = debugRuns.get(id);

  if (!existing) {
    return null;
  }

  const nextRun: ExtractionDebugRun = {
    ...existing,
    ...patch
  };

  if (nextRun.startedAt !== null && nextRun.finishedAt !== null) {
    nextRun.durationMs = Math.max(0, nextRun.finishedAt - nextRun.startedAt);
  }

  debugRuns.set(id, nextRun);
  insertDebugRun(id);
  return nextRun;
}

export function listExtractionDebugRuns(limit = 20): ExtractionDebugRun[] {
  return debugRunOrder
    .slice(0, Math.max(1, Math.min(limit, maxDebugRuns)))
    .map((id) => debugRuns.get(id))
    .filter((run): run is ExtractionDebugRun => Boolean(run));
}
