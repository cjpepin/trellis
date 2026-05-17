import {
  relatedNotesRetrievalDefaultLimit,
  retrievalLexicalWeights
} from "../../../shared/extraction/config.ts";

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
  "please",
  "should"
]);

export function tokenizeRetrieval(value: string): string[] {
  return [
    ...new Set(
      (value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
        (token) => !retrievalStopWords.has(token)
      )
    )
  ];
}

export function normalizeForPhraseSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function takeFirstSentence(value: string, fallbackChars = 180): string {
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

export function truncateForContext(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+\n/g, "\n").trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trimEnd()}\n\n[…truncated]`;
}

export interface LexicalNoteRow {
  slug: string;
  title: string;
  markdown_body: string;
  tags: string[];
}

export function lexicalNoteScore(query: string, row: LexicalNoteRow): number {
  const normalizedQuery = normalizeForPhraseSearch(query);
  const queryTokens = tokenizeRetrieval(query);
  const searchable = [row.title, row.tags.join(" "), row.markdown_body].join(" ");
  const searchableTokens = new Set(tokenizeRetrieval(searchable));
  const titlePhrase = normalizeForPhraseSearch(row.title);
  let score = 0;

  if (titlePhrase.length >= 8 && normalizedQuery.includes(titlePhrase)) {
    score += retrievalLexicalWeights.titlePhraseMatch;
  }

  for (const token of queryTokens) {
    if (searchableTokens.has(token)) {
      score += row.title.toLowerCase().includes(token)
        ? retrievalLexicalWeights.tokenHitInTitle
        : retrievalLexicalWeights.tokenHitElsewhere;
    }
  }

  return score;
}

export { relatedNotesRetrievalDefaultLimit };
