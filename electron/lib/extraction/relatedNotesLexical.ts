import type { ExtractionContextNote } from "@shared/extraction/contracts";
import type { NoteSummary } from "../../ipc/types";
import { readNoteIfExists } from "../../ipc/vault";

const MAX_LEXICAL_BODY_CHARS = 6000;

const retrievalStopWords = new Set([
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
  "please"
]);

function tokenize(value: string): string[] {
  return [
    ...new Set(
      (value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
        (token) => !retrievalStopWords.has(token)
      )
    )
  ];
}

function normalizeForPhraseSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Lexical overlap between a vault note and the extraction retrieval query.
 * Used when embeddings are missing or semantic retrieval ranks the wrong notes for a multi-topic thread.
 */
export function scoreVaultNoteAgainstExtractionQuery(note: NoteSummary, query: string): number {
  const normQ = normalizeForPhraseSearch(query);
  const titlePhrase = normalizeForPhraseSearch(note.title);
  let score = 0;

  if (titlePhrase.length >= 6 && normQ.includes(titlePhrase)) {
    score += 22;
  }

  const queryTokens = new Set(tokenize(query));
  for (const t of tokenize(note.title)) {
    if (queryTokens.has(t)) {
      score += 5;
    }
  }

  for (const part of note.slug.split("-")) {
    if (part.length >= 4 && queryTokens.has(part)) {
      score += 4;
    }
  }

  for (const tag of note.tags) {
    const normalized = normalizeForPhraseSearch(tag.replace(/-/g, " "));
    if (normalized.length >= 4 && normQ.includes(normalized)) {
      score += 6;
    }
  }

  return score;
}

const LEXICAL_MIN_SCORE = 8;

/**
 * Merges embedding-based retrieval with title/query lexical matches so secondary topics
 * (e.g. "running schedule" mentioned during a lifting chat) can appear in "## Relevant Existing Notes".
 */
export async function mergeRelatedNotesWithLexicalAugmentation(
  vaultPath: string,
  vaultNotes: NoteSummary[],
  retrievalQuery: string,
  existingNotes: ExtractionContextNote[],
  maxTotal: number
): Promise<ExtractionContextNote[]> {
  const bySlug = new Map<string, ExtractionContextNote>();

  for (const note of existingNotes) {
    const prior = bySlug.get(note.slug);
    if (!prior || note.score > prior.score) {
      bySlug.set(note.slug, note);
    }
  }

  const lexicalSlots = Math.max(0, maxTotal - bySlug.size);
  if (lexicalSlots === 0 || vaultNotes.length === 0) {
    return sortAndCap(bySlug, maxTotal);
  }

  const candidates: Array<{ note: NoteSummary; score: number }> = [];

  for (const note of vaultNotes) {
    if (bySlug.has(note.slug)) {
      continue;
    }

    const score = scoreVaultNoteAgainstExtractionQuery(note, retrievalQuery);
    if (score >= LEXICAL_MIN_SCORE) {
      candidates.push({ note, score });
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  for (const { note, score } of candidates.slice(0, lexicalSlots)) {
    const full = await readNoteIfExists(vaultPath, note.slug);
    if (!full) {
      continue;
    }

    bySlug.set(note.slug, {
      slug: note.slug,
      title: note.title,
      tags: note.tags,
      headingPath: "(document)",
      content: full.content.slice(0, MAX_LEXICAL_BODY_CHARS),
      score,
      isExplicitMatch: false
    });
  }

  return sortAndCap(bySlug, maxTotal);
}

function sortAndCap(bySlug: Map<string, ExtractionContextNote>, maxTotal: number): ExtractionContextNote[] {
  return [...bySlug.values()].sort((left, right) => right.score - left.score).slice(0, maxTotal);
}
