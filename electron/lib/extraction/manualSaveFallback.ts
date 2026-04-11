import type { ExtractionResponse, ExtractionUpdate } from "../../../shared/extraction/contracts";
import { slugifyExtractionTitle } from "../../../shared/extraction/wikiLinks";
import type { ChatSessionSummary } from "../../ipc/types";

function formatInstanceDateLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function clampSessionTitleWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean).slice(0, maxWords);
  return words.join(" ");
}

function pickNoteTitle(input: {
  session: ChatSessionSummary;
  suggestedSessionTitle: string;
  now: Date;
}): string {
  const suggested = input.suggestedSessionTitle.trim();

  if (suggested.length > 0) {
    const clipped = suggested.length > 120 ? `${suggested.slice(0, 117)}…` : suggested;
    return clipped;
  }

  const sessionTitle = input.session.title.trim();

  if (sessionTitle.length > 0 && sessionTitle.toLowerCase() !== "untitled session") {
    return sessionTitle.length > 120 ? `${sessionTitle.slice(0, 117)}…` : sessionTitle;
  }

  return `Chat capture · ${formatInstanceDateLabel(input.now)}`;
}

function ensureUniqueSlug(baseSlug: string, existing: Set<string>): string {
  if (!existing.has(baseSlug)) {
    return baseSlug;
  }

  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${baseSlug}-${n}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  return `${baseSlug}-${Date.now()}`;
}

function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

/** First sentence or line, for summaries (keeps it readable in Overview). */
function firstChunk(text: string, maxChars: number): string {
  const t = normalizeContent(text);
  if (t.length === 0) {
    return "";
  }
  const sentenceEnd = t.search(/(?<=[.!?])\s/);
  if (sentenceEnd > 0 && sentenceEnd + 1 <= maxChars) {
    return t.slice(0, sentenceEnd + 1).trim();
  }
  const clipped = t.slice(0, maxChars).trimEnd();
  return t.length > maxChars ? `${clipped}…` : clipped;
}

/** Heading-safe title derived from the opening of the first user message. */
function topicHeadingFromTranscript(
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const firstUser = transcript.find((m) => m.role === "user" && normalizeContent(m.content).length > 0);
  if (!firstUser) {
    return "Notes from chat";
  }
  const line = normalizeContent(firstUser.content).split("\n")[0] ?? "";
  let h = line.replace(/[#*`_[\]]/g, "").trim();
  if (h.length > 72) {
    h = `${h.slice(0, 69).trimEnd()}…`;
  }
  return h.length > 0 ? h : "Notes from chat";
}

function stripAssistantLeadIn(text: string): string {
  return normalizeContent(text).replace(/^(yes|yeah|yep|sure|okay|ok)\s*[,—–-]\s*/i, "");
}

/**
 * Wiki-style body: overview + request + guidance (not chat-log labels).
 * Passes extraction guardrails (no “User:” / “Assistant:” line prefixes).
 */
export function buildManualFallbackBody(
  transcript: Array<{ role: "user" | "assistant"; content: string }>,
  capturedAt: Date = new Date()
): string {
  const dateLabel = formatInstanceDateLabel(capturedAt);
  const topic = topicHeadingFromTranscript(transcript);
  const userTurns = transcript.filter((m) => m.role === "user" && normalizeContent(m.content).length > 0);
  const assistantTurns = transcript.filter(
    (m) => m.role === "assistant" && normalizeContent(m.content).length > 0
  );

  const firstUser = userTurns[0];
  const firstAssistant = assistantTurns[0];

  const overviewLines: string[] = [
    `## ${topic}`,
    "",
    "### Overview",
    "",
    `These working notes were captured on **${dateLabel}** because structured note extraction did not produce a separate wiki page for this thread. They are formatted as documentation—not as a raw chat export.`
  ];

  if (firstUser) {
    const focus = firstChunk(firstUser.content, 320);
    overviewLines.push("", `**What you were solving:** ${focus}`);
  }

  if (firstAssistant) {
    const lead = firstChunk(stripAssistantLeadIn(firstAssistant.content), 360);
    if (lead.length > 0) {
      overviewLines.push("", `**Key direction:** ${lead}`);
    }
  }

  overviewLines.push("", "---", "");

  const chunks: string[] = [...overviewLines, "### What was asked", ""];

  if (userTurns.length === 0) {
    chunks.push("_No user messages in this slice._", "");
  } else {
    for (let i = 0; i < userTurns.length; i += 1) {
      const turn = userTurns[i];
      if (!turn) {
        continue;
      }
      const block = normalizeContent(turn.content);
      if (userTurns.length > 1) {
        chunks.push(`#### ${i + 1}`, "", block, "");
      } else {
        chunks.push(block, "");
      }
    }
  }

  chunks.push("### Guidance", "");

  if (assistantTurns.length === 0) {
    chunks.push("_No assistant reply in this slice._", "");
  } else {
    for (let i = 0; i < assistantTurns.length; i += 1) {
      const turn = assistantTurns[i];
      if (!turn) {
        continue;
      }
      let block = normalizeContent(turn.content);
      if (i === 0) {
        block = stripAssistantLeadIn(block);
      }
      if (assistantTurns.length > 1) {
        chunks.push(`#### Part ${i + 1}`, "", block, "");
      } else {
        chunks.push(block, "");
      }
    }
  }

  chunks.push(
    "---",
    "",
    `_Auto-saved from Trellis chat when on-device extraction returned no wiki updates. You can edit this page freely._`
  );

  return chunks.join("\n").trimEnd();
}

export function buildManualSaveFallbackResponse(input: {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  session: ChatSessionSummary;
  suggestedSessionTitle: string;
  existingSlugs: Set<string>;
  now?: Date;
}): ExtractionResponse {
  const now = input.now ?? new Date();
  const body = buildManualFallbackBody(input.transcript, now);
  const targetTitle = pickNoteTitle({
    session: input.session,
    suggestedSessionTitle: input.suggestedSessionTitle,
    now
  });
  let baseSlug = slugifyExtractionTitle(targetTitle);
  baseSlug = ensureUniqueSlug(baseSlug, input.existingSlugs);

  const sessionTitle = clampSessionTitleWords(targetTitle, 6) || "Chat capture";

  const synthetic: ExtractionUpdate = {
    operation: "create",
    targetSlug: baseSlug,
    targetTitle,
    targetType: "synthesis",
    summary: "Working notes captured after extraction produced no wiki writes",
    body,
    tags: ["chat-capture"],
    links: [],
    evidence: [
      {
        kind: "transcript",
        ref: "manual_save_fallback",
        summary:
          "User requested Save to note; model returned no applied wiki updates, so Trellis wrote formatted working notes."
      }
    ],
    confidence: 1
  };

  return {
    updates: [synthetic],
    sessionTitle
  };
}
