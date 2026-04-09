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

export function buildFormattedTranscript(
  messages: MessageRecord[]
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: formatMessageForExtraction(message)
  }));
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

export function planSessionExtraction(
  messages: MessageRecord[],
  latestCompletedJob: ExtractionJobSnapshot | null,
  force = false
): PlannedSessionExtraction | null {
  const fullTranscript = buildFormattedTranscript(messages);

  if (fullTranscript.length < 2) {
    return null;
  }

  const transcriptDigest = buildTranscriptDigest(fullTranscript);

  if (!force && latestCompletedJob?.transcriptDigest === transcriptDigest) {
    return null;
  }

  let transcriptStartIndex = 0;

  if (!force && latestCompletedJob) {
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
    return null;
  }

  return {
    transcript,
    transcriptStartIndex,
    transcriptEndIndex: fullTranscript.length,
    transcriptDigest,
    retrievalQuery: transcript.map((message) => message.content).join("\n\n")
  };
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
  mode: ExtractionMode,
  providers: ExtractionProviderStatus[]
): ExtractionExecutionStrategy {
  const local = providers.find((provider) => provider.id === "embedded");
  const cloud = providers.find((provider) => provider.id === "cloud");

  if (mode === "local") {
    if (!local?.available) {
      return {
        action: "skip",
        reason: local?.reason ?? "On-device note processing is unavailable."
      };
    }

    return {
      action: "run",
      initialMode: "local",
      localRetryCount: 1
    };
  }

  if (mode === "cloud") {
    if (!cloud?.available) {
      return {
        action: "fail",
        reason: cloud?.reason ?? "Cloud note processing is unavailable."
      };
    }

    return {
      action: "run",
      initialMode: "cloud",
      localRetryCount: 0
    };
  }

  if (local?.available) {
    return {
      action: "run",
      initialMode: "local",
      fallbackMode: cloud?.available ? "cloud" : undefined,
      localRetryCount: 1
    };
  }

  if (cloud?.available) {
    return {
      action: "run",
      initialMode: "cloud",
      localRetryCount: 0
    };
  }

  return {
    action: "fail",
    reason:
      local?.reason ??
      cloud?.reason ??
      "No note processing provider is available."
  };
}
