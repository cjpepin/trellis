import type {
  AppSettings,
  ExtractionJobNotification,
  ExtractionJobSnapshot,
  ExtractionMode,
  QueueSessionExtractionInput,
  QueueSessionExtractionResult,
  VaultDefinition,
  WikiNote
} from "../../ipc/types";
import {
  createExtractionJob,
  getExtractionJob,
  getExtractionJobConfig,
  getLatestCompletedExtractionJob,
  getMessagesBySession,
  getNextPendingExtractionJob,
  getSessionById,
  listQueuedExtractionJobsBySession,
  listResumableExtractionJobs,
  recordWikiOps,
  updateExtractionJob,
  updateSession
} from "../database";
import { searchRelevantNotes } from "../retrieval/index";
import {
  buildSnapshot,
  readNoteIfExists,
  resolveVault,
  writeNoteFile
} from "../../ipc/vault";
import { getExtractionRuntimeStatus, resolveExtractionMode, runExtraction } from "./service";
import {
  buildExtractionRetrievalQuery,
  buildTranscriptDigest,
  buildFormattedTranscript,
  computeSessionExtractionPlan,
  filterDirectNoteActionMessages,
  findExplicitReferenceSlugs,
  resolveExtractionExecutionStrategy
} from "./jobs";
import { logExtraction } from "./extractionLog";
import { prepareExtractionWrite, skipIfDuplicatePreparedExtractionContent } from "./guardrails";
import {
  buildRequestedProviderOrder,
  createExtractionDebugRun,
  getExtractionDebugRun,
  updateExtractionDebugRun
} from "./debug";
import type {
  ExtractionContextNote,
  ExtractionResponse,
  ExtractionUpdate
} from "@shared/extraction/contracts";
import { extractionJobRelatedNotesLimit } from "@shared/extraction/config";
import {
  buildAutomaticChatCaptureFallbackResponse,
  buildManualSaveFallbackResponse,
  shouldAutoCaptureStrandFromTranscript
} from "./manualSaveFallback";

interface CreateExtractionOrchestratorOptions {
  getSettings: () => AppSettings;
  notifyJobUpdate: (notification: ExtractionJobNotification) => void;
}

interface ApplyExtractionResult {
  appliedUpdateCount: number;
  sessionTitle: string | null;
  appliedNotes: Array<{ slug: string; title: string }>;
}

type ExtractionIndexItem = {
  slug: string;
  title: string;
  tags: string[];
  folderPath?: string;
  isPlaceholder?: boolean;
};

const activeSessionIds = new Set<string>();

function isWritableUpdate(
  update: ExtractionUpdate
): update is ExtractionUpdate & {
  operation: "create" | "append" | "rewrite";
} {
  return update.operation !== "noop";
}

function countNonNoopUpdates(response: ExtractionResponse): number {
  return response.updates.filter((update) => update.operation !== "noop").length;
}

function buildExtractionIndex(snapshot: Awaited<ReturnType<typeof buildSnapshot>>) {
  const noteBySlug = new Map(snapshot.notes.map((note) => [note.slug, note]));

  return snapshot.graph.nodes.map((node) => {
    const note = noteBySlug.get(node.slug);

    return {
      slug: node.slug,
      title: node.title,
      tags: node.tags,
      ...(node.isPlaceholder ? { isPlaceholder: true } : {}),
      ...(note?.folderPath ? { folderPath: note.folderPath } : {})
    };
  });
}

async function applyExtractionResponseLocally(
  vault: VaultDefinition,
  response: ExtractionResponse,
  sessionId: string,
  index: ExtractionIndexItem[]
): Promise<ApplyExtractionResult> {
  const appliedUpdates = response.updates.filter(isWritableUpdate);
  const appliedOps: Array<{ file: string; action: "create" | "append" | "rewrite" }> = [];
  const appliedNotes: Array<{ slug: string; title: string }> = [];
  let appliedUpdateCount = 0;
  const seenPreparedBodies = new Set<string>();

  for (const rawUpdate of appliedUpdates) {
    const update = rawUpdate;
    let existingNote: WikiNote | null = null;

    try {
      existingNote = await readNoteIfExists(vault.path, update.targetSlug);
    } catch {
      existingNote = null;
    }

    const preparedWrite = prepareExtractionWrite({
      update,
      existingNote,
      index
    });

    if (!preparedWrite) {
      continue;
    }

    if (skipIfDuplicatePreparedExtractionContent(seenPreparedBodies, preparedWrite.content)) {
      logExtraction("applyExtractionResponseLocally.skipDuplicateBody", {
        slug: preparedWrite.slug,
        title: preparedWrite.title
      });
      continue;
    }

    await writeNoteFile(vault.path, vault.id, {
      vaultId: vault.id,
      slug: preparedWrite.slug,
      title: preparedWrite.title,
      content: preparedWrite.content,
      folderPath: preparedWrite.folderPath,
      frontmatter: {
        tags: preparedWrite.tags,
        type: preparedWrite.type,
        sources: preparedWrite.sources,
        url: preparedWrite.url
      }
    });

    appliedUpdateCount += 1;
    appliedNotes.push({
      slug: preparedWrite.slug,
      title: preparedWrite.title
    });
    appliedOps.push({
      file: `${preparedWrite.slug}.md`,
      action: preparedWrite.operation
    });
  }

  if (appliedUpdateCount > 0) {
    await recordWikiOps(
      appliedOps.map((operation) => ({
        sessionId,
        file: operation.file,
        action: operation.action
      }))
    );
  }

  let sessionTitle: string | null = null;

  if (appliedUpdateCount > 0 && response.sessionTitle) {
    const updatedSession = await updateSession({
      id: sessionId,
      title: response.sessionTitle
    });
    sessionTitle = updatedSession.title;
  }

  return {
    appliedUpdateCount,
    sessionTitle,
    appliedNotes
  };
}

export function createExtractionOrchestrator(options: CreateExtractionOrchestratorOptions) {
  async function runWithStrategy(
    job: ExtractionJobSnapshot,
    input: {
      transcript: Array<{ role: "user" | "assistant"; content: string }>;
      index: Array<{ slug: string; title: string; tags: string[]; isPlaceholder?: boolean }>;
      relatedNotes: Awaited<ReturnType<typeof searchRelevantNotes>>;
      preferredLocalModelId?: string;
      debugRunId?: string;
      retryThorough?: boolean;
    }
  ) {
    const mode = resolveExtractionMode(job.mode);
    const runtimeStatus = await getExtractionRuntimeStatus({
      mode
    });
    const strategy = resolveExtractionExecutionStrategy(mode, runtimeStatus.providers);
    const requestedProviderOrder = buildRequestedProviderOrder(mode);
    const patchDebugRun = (
      patch: Parameters<typeof updateExtractionDebugRun>[1]
    ) => {
      if (!input.debugRunId) {
        return null;
      }

      return updateExtractionDebugRun(input.debugRunId, patch);
    };
    const getSeedAttempts = () =>
      input.debugRunId ? [...(getExtractionDebugRun(input.debugRunId)?.attemptedProviders ?? [])] : [];
    const recordUnavailableProviders = () => {
      if (!input.debugRunId) {
        return;
      }

      const attempts = getSeedAttempts();
      const seen = new Set(
        attempts.map((attempt) => `${attempt.id}:${attempt.outcome}:${attempt.reason ?? ""}`)
      );

      for (const providerId of requestedProviderOrder) {
        const provider = runtimeStatus.providers.find((candidate) => candidate.id === providerId);

        if (!provider) {
          continue;
        }

        if (!provider.available) {
          const key = `${provider.id}:unavailable:${provider.reason ?? ""}`;

          if (!seen.has(key)) {
            attempts.push({
              id: provider.id,
              outcome: "unavailable",
              reason: provider.reason
            });
            seen.add(key);
          }
        } else if (strategy.action === "run") {
          break;
        }
      }

      patchDebugRun({
        attemptedProviders: attempts
      });
    };

    if (strategy.action === "skip") {
      recordUnavailableProviders();
      patchDebugRun({
        status: "skipped",
        finishedAt: Date.now(),
        errorMessage: strategy.reason ?? "Note processing skipped."
      });
      const skippedJob = await updateExtractionJob({
        id: job.id,
        status: "skipped",
        errorMessage: strategy.reason ?? "Note processing skipped.",
        finishedAt: Date.now()
      });
      logExtraction("runWithStrategy.skip", {
        jobId: job.id.slice(0, 8),
        reason: strategy.reason ?? "provider_unavailable"
      });
      options.notifyJobUpdate(skippedJob);
      return null;
    }

    if (strategy.action === "fail" || !strategy.initialMode) {
      recordUnavailableProviders();
      patchDebugRun({
        status: "failed",
        finishedAt: Date.now(),
        errorMessage: strategy.reason ?? "No extraction provider is available."
      });
      throw new Error(strategy.reason ?? "No extraction provider is available.");
    }

    let attempts = job.attemptCount;
    let lastError: Error | null = null;

    const attemptMode = async (mode: ExtractionMode) => {
      attempts += 1;
      await updateExtractionJob({
        id: job.id,
        attemptCount: attempts,
        errorMessage: null
      });

      return runExtraction(
        {
          mode,
          sessionId: job.sessionId,
          transcript: input.transcript,
          index: input.index,
          relatedNotes: input.relatedNotes,
          preferredLocalModelId: input.preferredLocalModelId,
          retryThorough: input.retryThorough ?? false
        },
        {
          runId: input.debugRunId,
          jobId: job.id,
          vaultId: job.vaultId,
          trigger: job.trigger,
          transcriptStartIndex: job.transcriptStartIndex,
          transcriptEndIndex: job.transcriptEndIndex,
          relatedNoteCount: input.relatedNotes.length,
          seedAttemptedProviders: getSeedAttempts()
        }
      );
    };

    if (strategy.initialMode === "local") {
      const retryCount = strategy.localRetryCount ?? 0;

      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          return await attemptMode("local");
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("On-device note processing failed.");
        }
      }

      throw lastError ?? new Error("On-device note processing failed.");
    }

    throw new Error("No note processing strategy.");
  }

  async function processJob(jobId: string): Promise<void> {
    const job = await getExtractionJob(jobId);

    if (!job || (job.status !== "pending" && job.status !== "running")) {
      return;
    }

    const jobMode = resolveExtractionMode(job.mode);
    const debugRun = createExtractionDebugRun({
      scope: "job",
      mode: jobMode,
      jobId: job.id,
      sessionId: job.sessionId,
      vaultId: job.vaultId,
      trigger: job.trigger,
      transcriptMessageCount: Math.max(0, job.transcriptEndIndex - job.transcriptStartIndex),
      transcriptStartIndex: job.transcriptStartIndex,
      transcriptEndIndex: job.transcriptEndIndex,
      requestedProviderOrder: buildRequestedProviderOrder(jobMode)
    });

    const session = await getSessionById(job.sessionId);

    if (!session) {
      updateExtractionDebugRun(debugRun.id, {
        status: "failed",
        finishedAt: Date.now(),
        errorMessage: "That chat session no longer exists."
      });
      const failedJob = await updateExtractionJob({
        id: job.id,
        status: "failed",
        errorMessage: "That chat session no longer exists.",
        finishedAt: Date.now()
      });
      options.notifyJobUpdate(failedJob);
      return;
    }

    const runningJob = await updateExtractionJob({
      id: job.id,
      status: "running",
      startedAt: job.startedAt ?? Date.now(),
      errorMessage: null
    });
    updateExtractionDebugRun(debugRun.id, {
      status: "running",
      startedAt: runningJob.startedAt ?? Date.now(),
      errorMessage: null
    });
    options.notifyJobUpdate(runningJob);

    try {
      logExtraction("processJob.start", {
        jobId: job.id.slice(0, 8),
        sessionId: job.sessionId.slice(0, 8),
        vaultId: job.vaultId.slice(0, 8),
        trigger: job.trigger,
        transcriptStart: job.transcriptStartIndex,
        transcriptEnd: job.transcriptEndIndex
      });

      const messages = await getMessagesBySession(job.sessionId);
      const fullTranscript = buildFormattedTranscript(messages);

      if (fullTranscript.length < job.transcriptEndIndex) {
        updateExtractionDebugRun(debugRun.id, {
          status: "skipped",
          finishedAt: Date.now(),
          errorMessage: "That transcript changed before extraction could run."
        });
        const skippedJob = await updateExtractionJob({
          id: job.id,
          status: "skipped",
          errorMessage: "That transcript changed before extraction could run.",
          finishedAt: Date.now()
        });
        options.notifyJobUpdate(skippedJob);
        logExtraction("processJob.skip", {
          jobId: job.id.slice(0, 8),
          reason: "transcript_changed_before_run",
          fullLen: fullTranscript.length,
          expectedEnd: job.transcriptEndIndex
        });
        return;
      }

      const queuedTranscript = fullTranscript.slice(0, job.transcriptEndIndex);
      const currentDigest = buildTranscriptDigest(queuedTranscript);

      if (currentDigest !== job.transcriptDigest) {
        updateExtractionDebugRun(debugRun.id, {
          status: "skipped",
          finishedAt: Date.now(),
          errorMessage: "A newer transcript replaced this extraction job."
        });
        const skippedJob = await updateExtractionJob({
          id: job.id,
          status: "skipped",
          errorMessage: "A newer transcript replaced this extraction job.",
          finishedAt: Date.now()
        });
        options.notifyJobUpdate(skippedJob);
        logExtraction("processJob.skip", {
          jobId: job.id.slice(0, 8),
          reason: "digest_superseded",
          jobDigestPrefix: job.transcriptDigest.slice(0, 8),
          currentDigestPrefix: currentDigest.slice(0, 8)
        });
        return;
      }

      const transcript = fullTranscript.slice(job.transcriptStartIndex, job.transcriptEndIndex);

      if (transcript.length < 2) {
        updateExtractionDebugRun(debugRun.id, {
          status: "skipped",
          finishedAt: Date.now(),
          errorMessage: "There was not enough transcript to extract durable notes."
        });
        const skippedJob = await updateExtractionJob({
          id: job.id,
          status: "skipped",
          errorMessage: "There was not enough transcript to extract durable notes.",
          finishedAt: Date.now()
        });
        options.notifyJobUpdate(skippedJob);
        logExtraction("processJob.skip", {
          jobId: job.id.slice(0, 8),
          reason: "transcript_slice_too_short"
        });
        return;
      }

      const storedConfig = await getExtractionJobConfig(job.id);
      const vault = resolveVault(options.getSettings(), session.vaultId);
      const snapshot = await buildSnapshot(vault.path, vault.id, vault.name);
      const sourceMessages = filterDirectNoteActionMessages(messages).slice(
        job.transcriptStartIndex,
        job.transcriptEndIndex
      );
      const explicitSlugs = findExplicitReferenceSlugs(sourceMessages, snapshot.notes);
      const retrievalQuery = buildExtractionRetrievalQuery(transcript);
      const relatedNotes = await searchRelevantNotes({
        vaultId: vault.id,
        query: retrievalQuery,
        explicitSlugs,
        limit: extractionJobRelatedNotesLimit
      });
      logExtraction("processJob.retrieval", {
        jobId: job.id.slice(0, 8),
        relatedNoteCount: relatedNotes.length,
        explicitSlugCount: explicitSlugs.length,
        queryChars: retrievalQuery.length
      });
      const index = buildExtractionIndex(snapshot);
      let extraction = await runWithStrategy(job, {
        transcript,
        index,
        relatedNotes,
        preferredLocalModelId: storedConfig?.preferredLocalModelId ?? undefined,
        debugRunId: debugRun.id,
        retryThorough: false
      });

      if (!extraction) {
        return;
      }

      let modelUpdateCount = countNonNoopUpdates(extraction.response);
      logExtraction("processJob.model_pass", {
        jobId: job.id.slice(0, 8),
        pass: "primary",
        nonNoopUpdates: modelUpdateCount
      });

      if (
        modelUpdateCount === 0 &&
        (job.trigger === "idle" ||
          job.trigger === "session-switch" ||
          job.trigger === "manual")
      ) {
        logExtraction("processJob.retry_thorough_begin", {
          jobId: job.id.slice(0, 8),
          trigger: job.trigger
        });
        const second = await runWithStrategy(job, {
          transcript,
          index,
          relatedNotes,
          preferredLocalModelId: storedConfig?.preferredLocalModelId ?? undefined,
          debugRunId: debugRun.id,
          retryThorough: true
        });
        if (second) {
          extraction = second;
          modelUpdateCount = countNonNoopUpdates(second.response);
          logExtraction("processJob.model_pass", {
            jobId: job.id.slice(0, 8),
            pass: "retry_thorough",
            nonNoopUpdates: modelUpdateCount
          });
        }
      }

      let applied = await applyExtractionResponseLocally(
        vault,
        extraction.response,
        job.sessionId,
        index
      );

      if (job.trigger === "manual" && applied.appliedUpdateCount === 0) {
        const existingSlugs = new Set(index.map((entry) => entry.slug));
        const fallbackResponse = buildManualSaveFallbackResponse({
          transcript,
          session,
          suggestedSessionTitle: extraction.response.sessionTitle ?? "",
          existingSlugs
        });
        applied = await applyExtractionResponseLocally(
          vault,
          fallbackResponse,
          job.sessionId,
          index
        );
      }

      if (
        applied.appliedUpdateCount === 0 &&
        (job.trigger === "idle" ||
          job.trigger === "session-switch" ||
          job.trigger === "startup") &&
        shouldAutoCaptureStrandFromTranscript(transcript)
      ) {
        const existingSlugs = new Set([
          ...index.map((entry) => entry.slug),
          ...applied.appliedNotes.map((note) => note.slug)
        ]);
        const fallbackResponse = buildAutomaticChatCaptureFallbackResponse({
          transcript,
          session,
          suggestedSessionTitle: extraction.response.sessionTitle ?? "",
          existingSlugs
        });
        applied = await applyExtractionResponseLocally(
          vault,
          fallbackResponse,
          job.sessionId,
          index
        );
      }
      const completedJob = await updateExtractionJob({
        id: job.id,
        status: "completed",
        provider: extraction.provider,
        model: extraction.model,
        appliedUpdateCount: applied.appliedUpdateCount,
        sessionTitle: applied.sessionTitle,
        finishedAt: Date.now(),
        errorMessage: null
      });
      const requestedUpdateCount = extraction.response.updates.filter(
        (update) => update.operation !== "noop"
      ).length;
      updateExtractionDebugRun(debugRun.id, {
        status: "completed",
        finishedAt: completedJob.finishedAt ?? Date.now(),
        selectedProvider: extraction.provider,
        model: extraction.model,
        requestedUpdateCount,
        appliedUpdateCount: applied.appliedUpdateCount,
        guardrailDropCount: Math.max(0, requestedUpdateCount - applied.appliedUpdateCount),
        errorMessage: null
      });
      logExtraction("processJob.complete", {
        jobId: job.id.slice(0, 8),
        requestedUpdateCount,
        appliedUpdateCount: applied.appliedUpdateCount,
        guardrailDropped: Math.max(0, requestedUpdateCount - applied.appliedUpdateCount)
      });
      options.notifyJobUpdate({
        ...completedJob,
        appliedNotes: applied.appliedNotes
      });
    } catch (error) {
      updateExtractionDebugRun(debugRun.id, {
        status: "failed",
        finishedAt: Date.now(),
        errorMessage:
          error instanceof Error
            ? error.message
            : "Trellis couldn’t finish extracting notes for that session."
      });
      const failedJob = await updateExtractionJob({
        id: job.id,
        status: "failed",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Trellis couldn’t finish extracting notes for that session.",
        finishedAt: Date.now()
      });
      logExtraction("processJob.failed", {
        jobId: job.id.slice(0, 8),
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown"
      });
      options.notifyJobUpdate(failedJob);
    }
  }

  async function scheduleSessionQueue(sessionId: string): Promise<void> {
    if (activeSessionIds.has(sessionId)) {
      return;
    }

    const nextJob = await getNextPendingExtractionJob(sessionId);

    if (!nextJob) {
      return;
    }

    activeSessionIds.add(sessionId);

    void processJob(nextJob.id).finally(async () => {
      activeSessionIds.delete(sessionId);
      await scheduleSessionQueue(sessionId);
    });
  }

  return {
    async queueSession(
      input: QueueSessionExtractionInput
    ): Promise<QueueSessionExtractionResult> {
      const session = await getSessionById(input.sessionId);

      if (!session) {
        throw new Error("That chat session could not be found.");
      }

      const messages = await getMessagesBySession(session.id);
      const latestCompletedJob = await getLatestCompletedExtractionJob(session.id);
      const planOptions = {
        fullTranscriptWhenChanged: input.trigger === "idle" || input.trigger === "session-switch"
      };
      const { plan, ineligibleReason } = computeSessionExtractionPlan(
        messages,
        latestCompletedJob,
        input.force ?? false,
        planOptions
      );

      if (!plan) {
        logExtraction("queueSession.ineligible", {
          sessionId: session.id.slice(0, 8),
          reason: ineligibleReason ?? "unknown",
          rawMessageCount: messages.length,
          trigger: input.trigger ?? "manual"
        });
        return {
          state: "ineligible",
          job: null
        };
      }

      const queuedJobs = await listQueuedExtractionJobsBySession(session.id);
      const duplicate = queuedJobs.find((job) => job.transcriptDigest === plan.transcriptDigest);

      if (duplicate) {
        logExtraction("queueSession.duplicate", {
          sessionId: session.id.slice(0, 8),
          digestPrefix: plan.transcriptDigest.slice(0, 8),
          trigger: input.trigger ?? "manual"
        });
        return {
          state: "duplicate",
          job: duplicate
        };
      }

      const job = await createExtractionJob({
        sessionId: session.id,
        vaultId: session.vaultId,
        trigger: input.trigger ?? "manual",
        mode: resolveExtractionMode(input.mode),
        transcriptStartIndex: plan.transcriptStartIndex,
        transcriptEndIndex: plan.transcriptEndIndex,
        transcriptDigest: plan.transcriptDigest,
        cloudFunctionsBaseUrl: null,
        cloudPublishableKey: null,
        preferredLocalModelId: input.preferredLocalModelId ?? null
      });

      logExtraction("queueSession.queued", {
        sessionId: session.id.slice(0, 8),
        jobId: job.id.slice(0, 8),
        trigger: input.trigger ?? "manual",
        plannedTurns: plan.transcript.length,
        digestPrefix: plan.transcriptDigest.slice(0, 8)
      });

      options.notifyJobUpdate(job);
      await scheduleSessionQueue(session.id);

      return {
        state: "queued",
        job
      };
    },
    async resumePendingJobs(): Promise<void> {
      const resumableJobs = await listResumableExtractionJobs();
      const sessionIds = new Set<string>();

      for (const job of resumableJobs) {
        if (job.status === "running") {
          await updateExtractionJob({
            id: job.id,
            status: "pending"
          });
        }

        sessionIds.add(job.sessionId);
      }

      await Promise.all([...sessionIds].map((sessionId) => scheduleSessionQueue(sessionId)));
    }
  };
}
