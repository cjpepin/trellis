import type {
  ChatContextReference,
  MemoryItem,
  MemoryKind,
  MessageRecord
} from "../../ipc/types";
import { listMemoryItems, saveMemoryItem, type SaveMemoryItemInput } from "../database";
import {
  countSharedTokens,
  jaccardSimilarity,
  normalizeForPhraseSearch,
  takeFirstSentence,
  tokenize
} from "./scoring";

interface SearchMemoryItemsInput {
  vaultId: string;
  query: string;
  preferredNoteSlugs?: string[];
  limit?: number;
}

interface ScoredMemoryItem extends MemoryItem {
  score: number;
}

function classifyMemoryKind(userText: string): MemoryKind | null {
  if (/\b(i prefer|i like to|i usually|remember that i|please remember|i do not want|i don't want|avoid)\b/i.test(userText)) {
    return "preference";
  }

  if (/\b(todo|to do|follow up|follow-up|next step|open question|still need to|need to decide)\b/i.test(userText)) {
    return "open_loop";
  }

  if (/\b(i need to|we need to|i should|we should|task|action item)\b/i.test(userText)) {
    return "task";
  }

  if (/\b(my project|our project|i'm building|i am building|we're building|we are building|working on|roadmap|launch)\b/i.test(userText)) {
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

function pickLinkedNoteSlug(references: ChatContextReference[]): string | null {
  return (
    references.find((reference) => reference.type === "note" && reference.slug)?.slug ??
    references.find((reference) => reference.type === "memory" && reference.linkedNoteSlug)
      ?.linkedNoteSlug ??
    null
  );
}

function buildCandidate(
  messages: Array<Pick<MessageRecord, "id" | "role" | "content">>,
  references: ChatContextReference[]
): SaveMemoryItemInput | null {
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
    vaultId: "",
    content,
    sourceMessageIds: messages.map((message) => message.id).filter(Boolean),
    linkedNoteSlug: pickLinkedNoteSlug(references),
    confidence: latestAssistant ? 0.72 : 0.56
  };
}

function scoreMemoryItem(
  item: MemoryItem,
  queryTokens: string[],
  normalizedQuery: string,
  preferredNoteSlugs: Set<string>
): number {
  const contentTokens = tokenize(item.content);
  const sharedTokens = countSharedTokens(queryTokens, contentTokens);
  const normalizedContent = normalizeForPhraseSearch(item.content);
  let score = sharedTokens * 4 + Math.min(item.confidence * 10, 10);

  if (normalizedQuery.length >= 8 && normalizedContent.includes(normalizedQuery)) {
    score += 8;
  }

  if (item.linkedNoteSlug && preferredNoteSlugs.has(item.linkedNoteSlug)) {
    score += 20;
  }

  return score;
}

function findExistingMemoryMatch(
  existingItems: MemoryItem[],
  candidate: SaveMemoryItemInput
): MemoryItem | null {
  const candidateTokens = tokenize(candidate.content);
  let bestMatch: MemoryItem | null = null;
  let bestScore = 0;

  for (const item of existingItems) {
    if (item.kind !== candidate.kind) {
      continue;
    }

    if (candidate.linkedNoteSlug && item.linkedNoteSlug && candidate.linkedNoteSlug !== item.linkedNoteSlug) {
      continue;
    }

    const similarity = jaccardSimilarity(candidateTokens, tokenize(item.content));

    if (similarity > bestScore) {
      bestMatch = item;
      bestScore = similarity;
    }
  }

  return bestScore >= 0.42 ? bestMatch : null;
}

export async function searchMemoryItems(
  input: SearchMemoryItemsInput
): Promise<ScoredMemoryItem[]> {
  const items = await listMemoryItems(input.vaultId);
  const queryTokens = tokenize(input.query);
  const normalizedQuery = normalizeForPhraseSearch(input.query);
  const preferredNoteSlugs = new Set((input.preferredNoteSlugs ?? []).filter(Boolean));
  const limit = Math.min(Math.max(input.limit ?? 4, 1), 8);

  return items
    .map((item) => ({
      ...item,
      score: scoreMemoryItem(item, queryTokens, normalizedQuery, preferredNoteSlugs)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.updatedAt - left.updatedAt;
    })
    .slice(0, limit);
}

export async function storeTurnMemory(input: {
  vaultId: string;
  messages: Array<Pick<MessageRecord, "id" | "role" | "content">>;
  references?: ChatContextReference[];
}): Promise<MemoryItem[]> {
  const references = input.references ?? [];
  const candidate = buildCandidate(input.messages, references);

  if (!candidate) {
    return [];
  }

  candidate.vaultId = input.vaultId;
  const existingItems = await listMemoryItems(input.vaultId);
  const existingMatch = findExistingMemoryMatch(existingItems, candidate);

  if (existingMatch) {
    const mergedMessageIds = [...new Set([...existingMatch.sourceMessageIds, ...candidate.sourceMessageIds])];
    const updated = await saveMemoryItem({
      id: existingMatch.id,
      vaultId: input.vaultId,
      kind: existingMatch.kind,
      content: candidate.content.length >= existingMatch.content.length
        ? candidate.content
        : existingMatch.content,
      sourceMessageIds: mergedMessageIds,
      linkedNoteSlug: candidate.linkedNoteSlug ?? existingMatch.linkedNoteSlug,
      confidence: Math.max(existingMatch.confidence, candidate.confidence)
    });

    return [updated];
  }

  const created = await saveMemoryItem(candidate);
  return [created];
}
