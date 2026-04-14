import { createHash } from "node:crypto";
import { formatMessageForExtraction } from "../../../shared/chat/formatMessage";
import {
  extractWikiLinkTitles,
  normalizeTitleKey
} from "../../../shared/extraction/wikiLinks";
import type {
  ExtractionJobSnapshot,
  ExtractionMode,
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

interface PlanSessionExtractionOptions {
  fullTranscriptWhenChanged?: boolean;
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
  force = false,
  options: PlanSessionExtractionOptions = {}
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

  if (!force && latestCompletedJob && !options.fullTranscriptWhenChanged) {
    if (messages.length <= latestCompletedJob.transcriptEndIndex) {
      transcriptStartIndex = 0;
    } else {
      transcriptStartIndex = Math.max(
        0,
        Math.min(latestCompletedJob.transcriptEndIndex, messages.length) - 2
      );
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
  force = false,
  options: PlanSessionExtractionOptions = {}
): PlannedSessionExtraction | null {
  return computeSessionExtractionPlan(messages, latestCompletedJob, force, options).plan;
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
    if (message.role !== "user") {
      continue;
    }

    for (const title of extractWikiLinkTitles(message.content)) {
      const matchedSlug = titleToSlug.get(normalizeTitleKey(title));

      if (matchedSlug) {
        explicitSlugs.add(matchedSlug);
      }
    }
  }

  return [...explicitSlugs].slice(0, 6);
}

export function resolveExtractionExecutionStrategy(
  _mode: ExtractionMode,
  providers: ExtractionProviderStatus[]
): ExtractionExecutionStrategy {
  const local = providers.find((provider) => provider.id === "embedded");

  if (local?.available) {
    return {
      action: "run",
      initialMode: "local",
      localRetryCount: 1
    };
  }

  return {
    action: "skip",
    reason: local?.reason ?? "On-device note processing is unavailable."
  };
}
