import type {
  AppSettings,
  ExtractionCloudConfig,
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
  readNoteOrCreateIfMissing,
  resolveVault,
  writeNoteFile
} from "../../ipc/vault";
import { getExtractionRuntimeStatus, resolveExtractionMode, runExtraction } from "./service";
import {
  buildTranscriptDigest,
  buildFormattedTranscript,
  findExplicitReferenceSlugs,
  planSessionExtraction,
  resolveExtractionExecutionStrategy
} from "./jobs";
import { prepareExtractionWrite } from "./guardrails";
import {
  buildRequestedProviderOrder,
  createExtractionDebugRun,
  getExtractionDebugRun,
  updateExtractionDebugRun
} from "./debug";
import type { ExtractionResponse, ExtractionUpdate } from "@shared/extraction/contracts";
import { isTrustedFunctionsBaseUrl } from "../trustedFunctionsUrl";

interface CreateExtractionOrchestratorOptions {
  getSettings: () => AppSettings;
  getAuthSession: () => { accessToken: string } | null;
  notifyJobUpdate: (notification: ExtractionJobNotification) => void;
}

interface ApplyExtractionResult {
  appliedUpdateCount: number;
  sessionTitle: string | null;
}

const activeSessionIds = new Set<string>();

function isWritableUpdate(
  update: ExtractionUpdate
): update is ExtractionUpdate & {
  operation: "create" | "append" | "rewrite";
} {
  return update.operation !== "noop";
}

function buildExtractionIndex(snapshot: Awaited<ReturnType<typeof buildSnapshot>>) {
  return snapshot.graph.nodes.map((node) => ({
    slug: node.slug,
    title: node.title,
    tags: node.tags,
    ...(node.isPlaceholder ? { isPlaceholder: true } : {})
  }));
}

function resolveJobCloudConfig(
  storedConfig: {
    cloudFunctionsBaseUrl: string | null;
    cloudPublishableKey: string | null;
  } | null,
  queuedConfig: ExtractionCloudConfig | undefined,
  getAuthSession: () => { accessToken: string } | null
): ExtractionCloudConfig | undefined {
  const baseUrl = queuedConfig?.functionsBaseUrl ?? storedConfig?.cloudFunctionsBaseUrl ?? undefined;
  const publishableKey =
    queuedConfig?.publishableKey ?? storedConfig?.cloudPublishableKey ?? undefined;
  const accessToken = queuedConfig?.accessToken ?? getAuthSession()?.accessToken ?? undefined;

  if (!baseUrl || !publishableKey) {
    return undefined;
  }

  if (!isTrustedFunctionsBaseUrl(baseUrl)) {
    return undefined;
  }

  return {
    functionsBaseUrl: baseUrl,
    publishableKey,
    accessToken
  };
}

async function applyExtractionResponseLocally(
  vault: VaultDefinition,
  response: ExtractionResponse,
  sessionId: string,
  index: Array<{ slug: string; title: string; tags: string[]; isPlaceholder?: boolean }>
): Promise<ApplyExtractionResult> {
  const appliedUpdates = response.updates.filter(isWritableUpdate);
  const appliedOps: Array<{ file: string; action: "create" | "append" | "rewrite" }> = [];
  let appliedUpdateCount = 0;

  for (const update of appliedUpdates) {
    let existingNote: WikiNote | null = null;

    try {
      existingNote = await readNoteOrCreateIfMissing(vault.path, update.targetSlug);
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

    await writeNoteFile(vault.path, vault.id, {
      vaultId: vault.id,
      slug: preparedWrite.slug,
      title: preparedWrite.title,
      content: preparedWrite.content,
      frontmatter: {
        tags: preparedWrite.tags,
        type: preparedWrite.type,
        sources: preparedWrite.sources,
        url: preparedWrite.url
      }
    });

    appliedUpdateCount += 1;
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
    sessionTitle
  };
}

export function createExtractionOrchestrator(options: CreateExtractionOrchestratorOptions) {
  const queuedCloudConfigByJobId = new Map<string, ExtractionCloudConfig>();

  async function runWithStrategy(
    job: ExtractionJobSnapshot,
    input: {
      transcript: Array<{ role: "user" | "assistant"; content: string }>;
      index: Array<{ slug: string; title: string; tags: string[]; isPlaceholder?: boolean }>;
      relatedNotes: Awaited<ReturnType<typeof searchRelevantNotes>>;
      cloud?: ExtractionCloudConfig;
      preferredLocalModelId?: string;
      debugRunId?: string;
    }
  ) {
    const runtimeStatus = await getExtractionRuntimeStatus({
      mode: job.mode,
      cloud: input.cloud
    });
    const strategy = resolveExtractionExecutionStrategy(job.mode, runtimeStatus.providers);
    const requestedProviderOrder = buildRequestedProviderOrder(job.mode);
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
          cloud: input.cloud,
          sessionId: job.sessionId,
          transcript: input.transcript,
          index: input.index,
          relatedNotes: input.relatedNotes,
          preferredLocalModelId: input.preferredLocalModelId
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

      if (strategy.fallbackMode === "cloud") {
        return attemptMode("cloud");
      }

      throw lastError ?? new Error("On-device note processing failed.");
    }

    recordUnavailableProviders();
    return attemptMode(strategy.initialMode);
  }

  async function processJob(jobId: string): Promise<void> {
    const job = await getExtractionJob(jobId);

    if (!job || (job.status !== "pending" && job.status !== "running")) {
      return;
    }

    const debugRun = createExtractionDebugRun({
      scope: "job",
      mode: job.mode,
      jobId: job.id,
      sessionId: job.sessionId,
      vaultId: job.vaultId,
      trigger: job.trigger,
      transcriptMessageCount: Math.max(0, job.transcriptEndIndex - job.transcriptStartIndex),
      transcriptStartIndex: job.transcriptStartIndex,
      transcriptEndIndex: job.transcriptEndIndex,
      requestedProviderOrder: buildRequestedProviderOrder(job.mode)
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
        return;
      }

      const storedConfig = await getExtractionJobConfig(job.id);
      const queuedCloudConfig = queuedCloudConfigByJobId.get(job.id);
      const cloud = resolveJobCloudConfig(storedConfig, queuedCloudConfig, options.getAuthSession);
      const vault = resolveVault(options.getSettings(), session.vaultId);
      const snapshot = await buildSnapshot(vault.path, vault.id, vault.name);
      const sourceMessages = messages.slice(job.transcriptStartIndex, job.transcriptEndIndex);
      const explicitSlugs = findExplicitReferenceSlugs(sourceMessages, snapshot.notes);
      const relatedNotes = await searchRelevantNotes({
        vaultId: vault.id,
        query: transcript.map((message) => message.content).join("\n\n"),
        explicitSlugs,
        limit: 6
      });
      const extraction = await runWithStrategy(job, {
        transcript,
        index: buildExtractionIndex(snapshot),
        relatedNotes,
        cloud,
        preferredLocalModelId: storedConfig?.preferredLocalModelId ?? undefined,
        debugRunId: debugRun.id
      });

      if (!extraction) {
        return;
      }

      const index = buildExtractionIndex(snapshot);
      const applied = await applyExtractionResponseLocally(
        vault,
        extraction.response,
        job.sessionId,
        index
      );
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
      options.notifyJobUpdate(completedJob);
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
      options.notifyJobUpdate(failedJob);
    } finally {
      queuedCloudConfigByJobId.delete(job.id);
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
      const plan = planSessionExtraction(messages, latestCompletedJob, input.force ?? false);

      if (!plan) {
        return {
          state: "ineligible",
          job: null
        };
      }

      const queuedJobs = await listQueuedExtractionJobsBySession(session.id);
      const duplicate = queuedJobs.find((job) => job.transcriptDigest === plan.transcriptDigest);

      if (duplicate) {
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
        cloudFunctionsBaseUrl: input.cloud?.functionsBaseUrl ?? null,
        cloudPublishableKey: input.cloud?.publishableKey ?? null,
        preferredLocalModelId: input.preferredLocalModelId ?? null
      });

      if (input.cloud) {
        queuedCloudConfigByJobId.set(job.id, input.cloud);
      }

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
