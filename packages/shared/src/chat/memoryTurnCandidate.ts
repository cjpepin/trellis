/**
 * Classify whether the last user+assistant turn should become a private memory item.
 */
export type MemoryKind = "preference" | "open_loop" | "task" | "project" | "fact";

const stopWords = new Set([
  "about",
  "after",
  "again",
  "being",
  "could",
  "from",
  "have",
  "into",
  "just",
  "more",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "what",
  "with",
  "would",
  "your",
  "want",
  "make",
  "need",
  "help",
  "please",
  "should"
]);

export function tokenizeMemory(value: string): string[] {
  return [
    ...new Set(
      (value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
        (token) => !stopWords.has(token)
      )
    )
  ];
}

export function jaccardSimilarityMemory(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);

  if (union.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function takeFirstSentence(value: string, fallbackChars = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  const sentence = normalized.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";

  if (sentence.length >= 12) {
    return sentence;
  }

  return normalized.slice(0, fallbackChars).trim();
}

function classifyMemoryKind(userText: string): MemoryKind | null {
  if (
    /\b(i prefer|i like to|i usually|remember that i|please remember|i do not want|i don't want|avoid)\b/i.test(
      userText
    )
  ) {
    return "preference";
  }

  if (
    /\b(todo|to do|follow up|follow-up|next step|open question|still need to|need to decide)\b/i.test(
      userText
    )
  ) {
    return "open_loop";
  }

  if (/\b(i need to|we need to|i should|we should|task|action item)\b/i.test(userText)) {
    return "task";
  }

  if (
    /\b(my project|our project|i'm building|i am building|we're building|we are building|working on|roadmap|launch)\b/i.test(
      userText
    )
  ) {
    return "project";
  }

  if (/\b(i use|we use|my stack|our stack|i am|i'm|my role|our team|my company)\b/i.test(userText)) {
    return "fact";
  }

  return null;
}

function buildMemoryContent(kind: MemoryKind, userText: string, assistantText: string): string {
  const userSentence = takeFirstSentence(userText, 220);
  const assistantSentence = takeFirstSentence(assistantText, 220);

  if (kind === "preference") {
    return `Preference: ${userSentence}`;
  }

  if (kind === "project") {
    return assistantSentence.length > 0
      ? `Project context: ${userSentence}\n\nLatest direction: ${assistantSentence}`
      : `Project context: ${userSentence}`;
  }

  if (kind === "open_loop") {
    return assistantSentence.length > 0
      ? `Open loop: ${userSentence}\n\nLatest guidance: ${assistantSentence}`
      : `Open loop: ${userSentence}`;
  }

  if (kind === "task") {
    return assistantSentence.length > 0
      ? `Task to revisit: ${userSentence}\n\nSuggested next step: ${assistantSentence}`
      : `Task to revisit: ${userSentence}`;
  }

  return assistantSentence.length > 0
    ? `Useful fact: ${userSentence}\n\nRelated context: ${assistantSentence}`
    : `Useful fact: ${userSentence}`;
}

export interface MemoryReferenceLike {
  type: "note" | "memory";
  slug?: string;
  linkedNoteSlug?: string | null;
}

export interface MemoryTurnMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function pickLinkedNoteSlug(references: MemoryReferenceLike[]): string | null {
  return (
    references.find((reference) => reference.type === "note" && reference.slug)?.slug ??
    references.find((reference) => reference.type === "memory" && reference.linkedNoteSlug)
      ?.linkedNoteSlug ??
    null
  );
}

export interface MemoryTurnCandidate {
  kind: MemoryKind;
  content: string;
  sourceMessageIds: string[];
  linkedNoteSlug: string | null;
  confidence: number;
}

export function buildMemoryTurnCandidate(
  messages: MemoryTurnMessage[],
  references: MemoryReferenceLike[]
): MemoryTurnCandidate | null {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");

  if (!latestUser) {
    return null;
  }

  const kind = classifyMemoryKind(latestUser.content);

  if (!kind) {
    return null;
  }

  const content = buildMemoryContent(kind, latestUser.content, latestAssistant?.content ?? "");

  if (content.length < 24) {
    return null;
  }

  return {
    kind,
    content,
    sourceMessageIds: messages.map((message) => message.id).filter(Boolean),
    linkedNoteSlug: pickLinkedNoteSlug(references),
    confidence: latestAssistant ? 0.72 : 0.56
  };
}

export interface ExistingMemoryRowLike {
  id: string;
  kind: string;
  content: string;
  linked_note_slug: string | null;
}

export function findExistingMemoryMatch(
  existingItems: ExistingMemoryRowLike[],
  candidate: MemoryTurnCandidate
): ExistingMemoryRowLike | null {
  const candidateTokens = tokenizeMemory(candidate.content);
  let bestMatch: ExistingMemoryRowLike | null = null;
  let bestScore = 0;

  for (const item of existingItems) {
    if (item.kind !== candidate.kind) {
      continue;
    }

    if (
      candidate.linkedNoteSlug &&
      item.linked_note_slug &&
      candidate.linkedNoteSlug !== item.linked_note_slug
    ) {
      continue;
    }

    const similarity = jaccardSimilarityMemory(candidateTokens, tokenizeMemory(item.content));

    if (similarity > bestScore) {
      bestMatch = item;
      bestScore = similarity;
    }
  }

  return bestScore >= 0.42 ? bestMatch : null;
}
