import type { MessageRecord, NoteSummary } from "@electron/ipc/types";
import { extractWikiLinkTitles, resolveReferencedNoteSlug } from "./noteReferences";

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
  "year"
]);

function tokenize(value: string): string[] {
  const tokens = value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];

  return [...new Set(tokens.filter((token) => !stopWords.has(token)))];
}

function normalizeForPhraseSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countMatches(haystack: Set<string>, tokens: string[]): number {
  return tokens.reduce((total, token) => total + (haystack.has(token) ? 1 : 0), 0);
}

function buildTermSet(value: string): Set<string> {
  return new Set(tokenize(value));
}

export function selectRelevantReferenceSlugs(
  messages: Array<Pick<MessageRecord, "role" | "content">>,
  notes: NoteSummary[]
): string[] {
  const userMessages = messages.filter((message) => message.role === "user");
  const explicitReferenceSlugs = Array.from(
    new Set(
      userMessages
        .flatMap((message) =>
          extractWikiLinkTitles(message.content)
            .map((title) => resolveReferencedNoteSlug(title, notes))
            .filter((slug): slug is string => Boolean(slug))
        )
    )
  ).slice(0, 4);

  const latestUserMessage = userMessages.at(-1)?.content ?? "";
  const recentUserCorpus = userMessages.slice(-3).map((message) => message.content).join(" ");
  const primaryTokens = tokenize(latestUserMessage);
  const secondaryTokens = tokenize(recentUserCorpus);

  if (secondaryTokens.length === 0) {
    return explicitReferenceSlugs;
  }

  const normalizedRecentCorpus = normalizeForPhraseSearch(recentUserCorpus);
  const automaticReferenceSlugs = notes
    .filter((note) => !explicitReferenceSlugs.includes(note.slug))
    .map((note) => {
      const titleTerms = buildTermSet(note.title);
      const tagTerms = buildTermSet(note.tags.join(" "));
      const excerptTerms = buildTermSet(note.excerpt);
      const titlePhrase = normalizeForPhraseSearch(note.title);
      const titlePhraseBonus =
        titlePhrase.length >= 8 && normalizedRecentCorpus.includes(titlePhrase) ? 8 : 0;
      const primaryTitleMatches = countMatches(titleTerms, primaryTokens);
      const primaryTagMatches = countMatches(tagTerms, primaryTokens);
      const primaryExcerptMatches = countMatches(excerptTerms, primaryTokens);
      const secondaryTitleMatches = countMatches(titleTerms, secondaryTokens);
      const secondaryTagMatches = countMatches(tagTerms, secondaryTokens);
      const secondaryExcerptMatches = countMatches(excerptTerms, secondaryTokens);
      const uniqueMatches = new Set(
        secondaryTokens.filter(
          (token) => titleTerms.has(token) || tagTerms.has(token) || excerptTerms.has(token)
        )
      ).size;
      const score =
        titlePhraseBonus +
        primaryTitleMatches * 6 +
        primaryTagMatches * 5 +
        primaryExcerptMatches * 3 +
        secondaryTitleMatches * 2 +
        secondaryTagMatches * 2 +
        secondaryExcerptMatches;

      return {
        slug: note.slug,
        updated: note.updated,
        inboundCount: note.inboundCount,
        score,
        uniqueMatches,
        hasStrongPrimarySignal: primaryTitleMatches + primaryTagMatches > 0 || titlePhraseBonus > 0
      };
    })
    .filter(
      (candidate) =>
        candidate.score >= 8 &&
        (candidate.uniqueMatches >= 2 || candidate.hasStrongPrimarySignal)
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.inboundCount !== left.inboundCount) {
        return right.inboundCount - left.inboundCount;
      }

      return right.updated.localeCompare(left.updated);
    })
    .slice(0, 4)
    .map((candidate) => candidate.slug);

  return [...explicitReferenceSlugs, ...automaticReferenceSlugs].slice(0, 6);
}
