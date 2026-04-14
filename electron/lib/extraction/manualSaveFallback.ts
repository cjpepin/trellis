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

function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function stripAssistantLeadIn(text: string): string {
  return normalizeContent(text).replace(/^(yes|yeah|yep|sure|okay|ok)\s*[,—–-]\s*/i, "");
}

/** Heuristic: session or draft titles that mirror the user's message, not a curated title. */
function looksLikeRawUserPrompt(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) {
    return false;
  }
  const lower = t.slice(0, 80).toLowerCase();
  const prefixes = [
    "can you ",
    "could you ",
    "would you ",
    "please ",
    "i need ",
    "i want ",
    "help me ",
    "how do ",
    "how can ",
    "what is ",
    "what are ",
    "what should ",
    "why ",
    "write me ",
    "make me ",
    "give me "
  ];
  if (prefixes.some((p) => lower.startsWith(p))) {
    return true;
  }
  if (t.includes("?") && t.length < 140) {
    return true;
  }
  return false;
}

function clipWords(text: string, maxWords: number, maxChars: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const joined = words.slice(0, maxWords).join(" ");
  if (joined.length <= maxChars) {
    return joined;
  }
  const hard = text.trim().slice(0, maxChars).trimEnd();
  const lastSpace = hard.lastIndexOf(" ");
  return (lastSpace > 24 ? hard.slice(0, lastSpace) : hard).trimEnd();
}

/**
 * Note title for fallback: never the user's raw prompt; prefer assistant substance or a dated label.
 */
function resolveFallbackTargetTitle(input: {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  session: ChatSessionSummary;
  suggestedSessionTitle: string;
  now: Date;
}): string {
  const suggested = input.suggestedSessionTitle.trim();
  if (suggested.length > 0 && !looksLikeRawUserPrompt(suggested)) {
    return suggested.length > 120 ? `${suggested.slice(0, 117)}…` : suggested;
  }

  const sessionTitle = input.session.title.trim();
  if (
    sessionTitle.length > 0 &&
    sessionTitle.toLowerCase() !== "untitled session" &&
    !looksLikeRawUserPrompt(sessionTitle)
  ) {
    return sessionTitle.length > 120 ? `${sessionTitle.slice(0, 117)}…` : sessionTitle;
  }

  const fromAssistant = titleFromAssistantMessages(input.transcript);
  if (fromAssistant.length > 0) {
    return fromAssistant.length > 120 ? `${fromAssistant.slice(0, 117)}…` : fromAssistant;
  }

  return `Notes · ${formatInstanceDateLabel(input.now)}`;
}

/**
 * Derive a short title from assistant wording (first substantive sentence), not from the user.
 */
function titleFromAssistantMessages(
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const assistantBlocks = transcript
    .filter((m) => m.role === "assistant" && normalizeContent(m.content).length > 0)
    .map((m) => stripAssistantLeadIn(m.content));

  if (assistantBlocks.length === 0) {
    return "";
  }

  const text = assistantBlocks.join("\n\n");
  const firstLine = normalizeContent(text).split("\n")[0] ?? "";
  let sentence = firstLine;

  const boringOpen = /^(here'?s|here is|sure[,!]?|okay[,!]?|ok[,!]?)\s+/i;
  sentence = sentence.replace(boringOpen, "").trim();

  const end = sentence.search(/(?<=[.!?])\s/);
  if (end > 0 && end < 140) {
    sentence = sentence.slice(0, end + 1).trim();
  }

  sentence = sentence.replace(/^[#*`_\s]+/, "").replace(/[*`]+$/g, "").trim();
  if (sentence.length === 0) {
    return "";
  }

  let t = clipWords(sentence, 12, 100);
  if (t.length < 8 && assistantBlocks[0]) {
    t = clipWords(normalizeContent(assistantBlocks[0]), 12, 100);
  }
  return t.length > 0 ? t : "";
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

/**
 * Take up to maxChars, preferring paragraph boundaries; then sentence, then hard cut.
 */
function takeRichExcerpt(text: string, maxChars: number): string {
  const t = normalizeContent(text);
  if (t.length === 0) {
    return "";
  }
  if (t.length <= maxChars) {
    return t;
  }

  const slice = t.slice(0, maxChars);
  const para = slice.lastIndexOf("\n\n");
  if (para > maxChars * 0.35) {
    return slice.slice(0, para).trimEnd();
  }
  const sent = slice.search(/(?<=[.!?])\s(?=[A-Za-z])/);
  if (sent > maxChars * 0.4) {
    return slice.slice(0, sent + 1).trim();
  }
  const soft = slice.lastIndexOf(" ");
  if (soft > maxChars * 0.55) {
    return `${slice.slice(0, soft).trimEnd()}…`;
  }
  return `${slice.trimEnd()}…`;
}

/**
 * Opening + continuation: enough substance for long assistant replies without dumping the entire thread.
 * Intentionally allows a small overlap at the boundary so nothing important is lost.
 */
function splitSummaryAndDetail(assistantMarkdown: string): { summary: string; detail: string } {
  const full = normalizeContent(stripAssistantLeadIn(assistantMarkdown));
  if (full.length === 0) {
    return { summary: "", detail: "" };
  }

  const detailCap = 3_400;
  const headBudget = 1_200;
  const tailSkip = 950;

  if (full.length <= headBudget + 40) {
    return { summary: full, detail: "" };
  }

  const summary = takeRichExcerpt(full, headBudget);
  const tail = takeRichExcerpt(full.slice(tailSkip).trim(), detailCap);
  return { summary, detail: tail };
}

function combineAssistantBodies(
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const parts = transcript
    .filter((m) => m.role === "assistant" && normalizeContent(m.content).length > 0)
    .map((m) => stripAssistantLeadIn(m.content));

  return parts.join("\n\n").trim();
}

function combineUserBodies(
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): string {
  return transcript
    .filter((m) => m.role === "user")
    .map((m) => normalizeContent(m.content))
    .join("\n\n")
    .trim();
}

/** Minimum assistant prose before we auto-materialize a Strand without explicit "save" language. */
const minAssistantCharsAutoCapture = 120;
/** Typical real question / context from the user; short follow-ups allowed when the assistant reply is long. */
const minUserCharsAutoCapture = 12;
const longAssistantBypassUserMin = 360;

/**
 * True when idle/session extraction should still write a capture Strand if the model returned no wiki updates.
 * Keeps trivial chats from creating empty captures.
 */
export function shouldAutoCaptureStrandFromTranscript(
  transcript: Array<{ role: "user" | "assistant"; content: string }>
): boolean {
  const assistantNorm = normalizeContent(combineAssistantBodies(transcript));
  if (assistantNorm.length < minAssistantCharsAutoCapture) {
    return false;
  }

  const userNorm = combineUserBodies(transcript);
  if (userNorm.length < minUserCharsAutoCapture && assistantNorm.length < longAssistantBypassUserMin) {
    return false;
  }

  return true;
}

/**
 * Standalone note body: assistant substance only (no user prompt quotes), medium depth.
 */
export function buildManualFallbackBody(
  transcript: Array<{ role: "user" | "assistant"; content: string }>,
  capturedAt: Date = new Date(),
  noteTitle: string
): string {
  const dateLabel = formatInstanceDateLabel(capturedAt);
  const assistantBlob = combineAssistantBodies(transcript);

  const lines: string[] = [`## ${noteTitle}`, "", `Saved from chat on **${dateLabel}**.`, ""];

  if (assistantBlob.length === 0) {
    lines.push("_No assistant reply was available to save in this slice._");
    return lines.join("\n").trimEnd();
  }

  const { summary, detail } = splitSummaryAndDetail(assistantBlob);

  lines.push("### Summary", "", summary || takeRichExcerpt(assistantBlob, 720), "");

  if (detail.length > 0) {
    lines.push("### Detail", "", detail, "");
  }

  return lines.join("\n").trimEnd();
}

export function buildManualSaveFallbackResponse(input: {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  session: ChatSessionSummary;
  suggestedSessionTitle: string;
  existingSlugs: Set<string>;
  now?: Date;
}): ExtractionResponse {
  const now = input.now ?? new Date();
  const targetTitle = resolveFallbackTargetTitle({
    transcript: input.transcript,
    session: input.session,
    suggestedSessionTitle: input.suggestedSessionTitle,
    now
  });
  const body = buildManualFallbackBody(input.transcript, now, targetTitle);
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

/**
 * Same shaped capture as {@link buildManualSaveFallbackResponse}, but for automatic idle extraction when
 * the on-device curator returns nothing applicable — aligns with "always extract durable substance" without
 * requiring the user to say "save".
 */
export function buildAutomaticChatCaptureFallbackResponse(input: {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  session: ChatSessionSummary;
  suggestedSessionTitle: string;
  existingSlugs: Set<string>;
  now?: Date;
}): ExtractionResponse {
  const now = input.now ?? new Date();
  const targetTitle = resolveFallbackTargetTitle({
    transcript: input.transcript,
    session: input.session,
    suggestedSessionTitle: input.suggestedSessionTitle,
    now
  });
  const body = buildManualFallbackBody(input.transcript, now, targetTitle);
  let baseSlug = slugifyExtractionTitle(targetTitle);
  baseSlug = ensureUniqueSlug(baseSlug, input.existingSlugs);

  const sessionTitle = clampSessionTitleWords(targetTitle, 6) || "Chat capture";

  const synthetic: ExtractionUpdate = {
    operation: "create",
    targetSlug: baseSlug,
    targetTitle,
    targetType: "synthesis",
    summary: "Auto-saved from chat: on-device extraction proposed no wiki updates for this slice",
    body,
    folderPath: "captures",
    tags: ["chat-capture", "auto"],
    links: [],
    evidence: [
      {
        kind: "transcript",
        ref: "automatic_extraction_fallback",
        summary:
          "Local extraction completed with no applied wiki updates; Trellis saved assistant substance under captures/."
      }
    ],
    confidence: 1
  };

  return {
    updates: [synthetic],
    sessionTitle
  };
}
