import { createHash } from "node:crypto";
import { formatMessageForExtraction } from "../../../shared/chat/formatMessage";
import {
  extractWikiLinkTitles,
  normalizeTitleKey
} from "../../../shared/extraction/wikiLinks";
import { extractionRetryShortTranscriptMaxTurns } from "../../../shared/extraction/config";
import type { ExtractionResponse, ExtractionUpdate } from "../../../shared/extraction/contracts";
import type {
  ExtractionJobSnapshot,
  ExtractionJobTrigger,
  ExtractionMode,
  ExtractionProviderId,
  ExtractionProviderStatus,
  MessageRecord,
  NoteSummary
} from "../../ipc/types";

export interface PlannedSessionExtraction {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  transcriptStartIndex: number;
  transcriptEndIndex: number;
  transcriptDigest: string;
  retrievalQuery: string;
}

export interface ExtractionExecutionStrategy {
  action: "run" | "skip" | "fail";
  initialMode?: ExtractionMode;
  fallbackMode?: ExtractionMode;
  localRetryCount?: number;
  reason?: string;
}


export function buildFormattedTranscript(
  messages: MessageRecord[]
): Array<{ role: "user" | "assistant"; content: string }> {
  return filterDirectNoteActionMessages(messages).map((message) => ({
    role: message.role,
    content: formatMessageForExtraction(message)
  }));
}

export function getDirectNoteActionExcludedMessageIds(messages: MessageRecord[]): Set<string> {
  const excluded = new Set<string>();

  for (const message of messages) {
    if (message.noteActions && message.noteActions.length > 0) {
      excluded.add(message.id);

      for (const action of message.noteActions) {
        if (
          action.status !== "pending" &&
          action.status !== "approved" &&
          action.status !== "rejected"
        ) {
          continue;
        }

        for (const sourceMessageId of action.sourceMessageIds) {
          excluded.add(sourceMessageId);
        }
      }
    }

  }

  return excluded;
}

export function filterDirectNoteActionMessages(messages: MessageRecord[]): MessageRecord[] {
  const excluded = getDirectNoteActionExcludedMessageIds(messages);

  if (excluded.size === 0) {
    return messages;
  }

  return messages.filter((message) => !excluded.has(message.id));
}

export function buildTranscriptDigest(
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): string {
  return createHash("sha256")
    .update(
      transcript
        .map((message) => `${message.role}:${message.content}`)
        .join("\n\n---\n\n")
    )
    .digest("hex");
}

export type ExtractionPlanIneligibleReason =
  | "fewer_than_two_turns"
  | "digest_unchanged"
  | "planned_slice_fewer_than_two_turns";

export function computeSessionExtractionPlan(
  messages: MessageRecord[],
  latestCompletedJob: ExtractionJobSnapshot | null,
  force = false
): {
  plan: PlannedSessionExtraction | null;
  ineligibleReason: ExtractionPlanIneligibleReason | null;
} {
  const fullTranscript = buildFormattedTranscript(messages);

  if (fullTranscript.length < 2) {
    return { plan: null, ineligibleReason: "fewer_than_two_turns" };
  }

  const transcriptDigest = buildTranscriptDigest(fullTranscript);

  if (!force && latestCompletedJob?.transcriptDigest === transcriptDigest) {
    return { plan: null, ineligibleReason: "digest_unchanged" };
  }

  let transcriptStartIndex = 0;

  if (!force && latestCompletedJob) {
    // Compare against fullTranscript.length (not messages.length) — they differ because
    // buildFormattedTranscript filters out direct-note-action messages.
    if (fullTranscript.length <= latestCompletedJob.transcriptEndIndex) {
      // Transcript was modified or truncated; reprocess from start.
      transcriptStartIndex = 0;
    } else {
      // Process only turns added since the last completed job.
      // No overlap needed: prior session notes are pinned in retrieval so the model
      // always sees what it previously extracted.
      transcriptStartIndex = latestCompletedJob.transcriptEndIndex;
    }
  }

  const transcript = fullTranscript.slice(transcriptStartIndex);

  if (transcript.length < 2) {
    return { plan: null, ineligibleReason: "planned_slice_fewer_than_two_turns" };
  }

  return {
    plan: {
      transcript,
      transcriptStartIndex,
      transcriptEndIndex: fullTranscript.length,
      transcriptDigest,
      retrievalQuery: transcript.map((message) => message.content).join("\n\n")
    },
    ineligibleReason: null
  };
}

export function planSessionExtraction(
  messages: MessageRecord[],
  latestCompletedJob: ExtractionJobSnapshot | null,
  force = false
): PlannedSessionExtraction | null {
  return computeSessionExtractionPlan(messages, latestCompletedJob, force).plan;
}

/**
 * Biases lexical retrieval toward the latest user/assistant exchange while keeping full-thread terms.
 */
export function buildExtractionRetrievalQuery(
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const full = transcript.map((message) => message.content).join("\n\n");
  if (transcript.length <= 2) {
    return full;
  }

  const lastPair = transcript.slice(-2).map((message) => message.content).join("\n\n");
  return `${lastPair}\n\n---\n\n${full}`;
}

export function findExplicitReferenceSlugs(
  messages: Array<Pick<MessageRecord, "role" | "content">>,
  notes: NoteSummary[]
): string[] {
  const titleToSlug = new Map(
    notes.map((note) => [normalizeTitleKey(note.title), note.slug] as const)
  );
  const explicitSlugs = new Set<string>();

  for (const message of messages) {
    for (const title of extractWikiLinkTitles(message.content)) {
      const matchedSlug = titleToSlug.get(normalizeTitleKey(title));

      if (matchedSlug) {
        explicitSlugs.add(matchedSlug);
      }
    }
  }

  return [...explicitSlugs].slice(0, 12);
}

export function resolveExtractionExecutionStrategy(
  mode: ExtractionMode,
  providers: ExtractionProviderStatus[]
): ExtractionExecutionStrategy {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const embedded = byId.get("embedded");
  const cloudOpenAi = byId.get("cloud-openai");
  const cloudAnthropic = byId.get("cloud-anthropic");

  if (mode === "cloud") {
    const hasRunnable = [cloudOpenAi, cloudAnthropic, embedded].some((p) => p?.available);
    if (hasRunnable) {
      return {
        action: "run",
        initialMode: "cloud",
        localRetryCount: 0
      };
    }
    const reason =
      [cloudOpenAi?.reason, cloudAnthropic?.reason, embedded?.reason].find(
        (r): r is string => typeof r === "string" && r.length > 0
      ) ?? "No cloud or on-device note processing is available.";
    return {
      action: "skip",
      reason
    };
  }

  if (embedded?.available) {
    return {
      action: "run",
      initialMode: "local",
      localRetryCount: 1
    };
  }

  return {
    action: "skip",
    reason: embedded?.reason ?? "On-device note processing is unavailable."
  };
}

/**
 * Whether to run the second "retry thorough" extraction pass when the first pass
 * returned only noop updates. Cloud providers skip the second pass to avoid doubled
 * latency; embedded keeps it as a backstop for small-model quality.
 */
export function shouldRunRetryThoroughPass(params: {
  trigger: ExtractionJobTrigger;
  primaryProvider: ExtractionProviderId;
  /** Formatted transcript turns (user/assistant messages); used to skip retry on very short threads. */
  transcriptTurnCount: number;
}): boolean {
  if (
    params.trigger !== "idle" &&
    params.trigger !== "session-switch" &&
    params.trigger !== "manual"
  ) {
    return false;
  }

  if (params.primaryProvider === "cloud-openai" || params.primaryProvider === "cloud-anthropic") {
    return false;
  }

  if (params.transcriptTurnCount <= extractionRetryShortTranscriptMaxTurns) {
    return false;
  }

  return true;
}

export { foldIncrementalCreatesOntoSessionAnchor } from "../../../shared/extraction/foldIncrementalCreates";
