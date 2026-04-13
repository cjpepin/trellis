import { CHAT_ATTACHMENT_CONTEXT_MARKER } from "./formatMessage";

const MAX_TITLE_WORDS = 6;

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "been",
  "being",
  "could",
  "does",
  "doing",
  "from",
  "have",
  "here",
  "into",
  "just",
  "like",
  "make",
  "more",
  "need",
  "only",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "very",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
  "your"
]);

export type SessionTitleSourceMessage = {
  role: "user" | "assistant";
  content: string;
  imageParts?: { mimeType: string }[];
};

const TRIVIAL_USER = new RegExp(
  "^(?:ok|okay|thanks?|thank you|yes|no|please|cool|nice|got it|continue|go on|more|yep|nope)\\.?$",
  "i"
);

function stripAttachmentContext(content: string): string {
  const idx = content.indexOf(CHAT_ATTACHMENT_CONTEXT_MARKER);
  if (idx === -1) {
    return content.trim();
  }

  return content.slice(0, idx).trim();
}

function plainUserBody(message: SessionTitleSourceMessage): string {
  if (message.role !== "user") {
    return "";
  }

  const trimmed = message.content.trim();

  if (trimmed.length > 0) {
    const stripped = stripAttachmentContext(trimmed);

    if (
      (stripped === "(No message text.)" || stripped.length === 0) &&
      message.imageParts &&
      message.imageParts.length > 0
    ) {
      return "Image message";
    }

    return stripped;
  }

  if (message.imageParts && message.imageParts.length > 0) {
    return "Image message";
  }

  return "";
}

function isTrivialUserBody(body: string): boolean {
  const t = body.replace(/\s+/g, " ").trim();
  if (t.length === 0) {
    return true;
  }

  if (t.length < 3) {
    return true;
  }

  return TRIVIAL_USER.test(t);
}

function findUserBodyForTitle(messages: SessionTitleSourceMessage[]): string {
  const users = messages.filter((m) => m.role === "user");
  let fallback = "";

  for (let i = users.length - 1; i >= 0; i -= 1) {
    const message = users[i];
    if (!message) {
      continue;
    }

    const body = plainUserBody(message);
    const normalized =
      body === "(No message text.)" ? "" : body;

    if (!normalized) {
      continue;
    }

    if (!isTrivialUserBody(normalized)) {
      return normalized;
    }

    if (!fallback) {
      fallback = normalized;
    }
  }

  return fallback;
}

/** Drop common question / helper frames so titles name the topic. */
function stripQuestionFrame(text: string): string {
  let s = text.replace(/\?+$/, "").trim();

  const frames: RegExp[] = [
    /^(?:please|hi|hey|hello)[,!.]?\s+/i,
    /^(?:can|could|would) you(?: please)?\s+/i,
    /^(?:help me|i need you to|i want you to)\s+(?:to\s+)?/i,
    /^(?:how do i|how can i|how should i|what(?:'s| is) the best way to)\s+/i,
    /^(?:what(?:'s| is)|why (?:does|do|is)|when (?:does|do|should))\s+/i,
    /^(?:explain|describe)\s+/i
  ];

  for (const re of frames) {
    const next = s.replace(re, "").trim();
    if (next !== s) {
      s = next;
    }
  }

  return s;
}

function extractFirstAssistantSnippet(assistantText: string, maxLen: number): string {
  let s = assistantText.trim();

  if (s.startsWith("```")) {
    const closeIdx = s.indexOf("```", 3);
    if (closeIdx !== -1) {
      s = s.slice(closeIdx + 3).trim();
    }
  }

  s = s
    .replace(/^(?:\s*(?:sure|okay|ok|great|absolutely|yes)[!.]?\s*)+/i, "")
    .replace(/^(?:here(?:'s| is| are))\s+(?:a |an |the |my |some )?/i, "")
    .replace(/^(?:#{1,6}\s+.+\n)+/m, "")
    .trim();

  const sentences = s.split(/(?<=[.!?])\s+/).filter(Boolean);
  let chunk = sentences[0] ?? "";

  if (chunk.length < 48 && sentences.length > 1 && sentences[1]) {
    chunk = `${chunk} ${sentences[1]}`;
  }

  if (chunk.length > maxLen) {
    return chunk.slice(0, maxLen).trim();
  }

  return chunk;
}

function resolveAssistantSnippet(
  messages: SessionTitleSourceMessage[],
  explicitAssistantReply?: string
): string | undefined {
  const trimmed = explicitAssistantReply?.trim();
  if (trimmed) {
    return extractFirstAssistantSnippet(trimmed, 480);
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && message.role === "assistant" && message.content.trim()) {
      return extractFirstAssistantSnippet(message.content, 480);
    }
  }

  return undefined;
}

function titleCaseWords(words: string[]): string {
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function wordsInDocumentOrder(text: string, maxWords: number): string[] {
  const raw = text.toLowerCase().match(/\b[a-z0-9][a-z0-9'-]{2,}\b/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const token of raw) {
    const word = token.replace(/(?:'s|-)+$/g, "");
    if (word.length < 3 || stopWords.has(word)) {
      continue;
    }

    if (seen.has(word)) {
      continue;
    }

    seen.add(word);
    out.push(word);

    if (out.length >= maxWords) {
      break;
    }
  }

  return out;
}

function tryShortLineTitle(text: string): string | null {
  const t = stripQuestionFrame(text).replace(/\s+/g, " ").trim();
  if (!t || t.length > 58) {
    return null;
  }

  if (/[`#|]/.test(t)) {
    return null;
  }

  const words = t.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_TITLE_WORDS) {
    return null;
  }

  if (words.some((w) => w.length > 24)) {
    return null;
  }

  return titleCaseWords(words);
}

function fallbackFromPlainWords(text: string): string {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, MAX_TITLE_WORDS)
    .map((part) => part.replace(/[^a-z0-9/-]/gi, ""))
    .filter(Boolean);

  if (words.length === 0) {
    return "New Conversation";
  }

  return titleCaseWords(words);
}

/**
 * Derives a short session title (≤6 words) from the transcript and optional latest assistant reply.
 * Prefers topic phrasing over raw prompts; uses assistant wording when the user turn is thin.
 */
export function deriveSessionTitle(
  messages: SessionTitleSourceMessage[],
  options?: { assistantReply?: string }
): string {
  const userBody = findUserBodyForTitle(messages);

  if (!userBody) {
    return "New Conversation";
  }

  const normalizedUser =
    userBody.length === 0 || userBody === "(No message text.)" ? "Attached context" : userBody;

  const assistantSnippet = resolveAssistantSnippet(messages, options?.assistantReply);
  const framedUser = stripQuestionFrame(normalizedUser);
  const userWordCount = framedUser.split(/\s+/).filter(Boolean).length;

  const short = tryShortLineTitle(normalizedUser);
  if (short && (!assistantSnippet || userWordCount >= 5)) {
    return short;
  }

  const corpus = [framedUser, assistantSnippet].filter(Boolean).join(" ");
  const ordered = wordsInDocumentOrder(corpus, MAX_TITLE_WORDS);

  if (ordered.length > 0) {
    return titleCaseWords(ordered);
  }

  return fallbackFromPlainWords(framedUser.length > 0 ? framedUser : normalizedUser);
}
