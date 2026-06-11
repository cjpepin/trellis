import type {
  ExtractionContextNote,
  ExtractionIndexEntry as ExtractionIndexNote,
  ExtractionResponse as ExtractionPayload,
  ExtractionUpdate
} from "./contracts.ts";
import { deriveSessionTitle } from "../chat/deriveSessionTitle.ts";

/** Matches chat transcript shape used by extraction eval and legacy cloud-eval helpers. */
export interface HeuristicTranscriptMessage {
  role: "user" | "assistant";
  content: string;
}

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
  "would"
]);

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function tokenizeIndexText(value: string): string[] {
  return value
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
}

function scoreIndexNoteMatch(
  note: ExtractionIndexNote,
  corpusLower: string,
  keywords: string[]
): number {
  const tokens = new Set([
    ...tokenizeIndexText(note.title),
    ...tokenizeIndexText(note.slug.replace(/-/g, " ")),
    ...note.tags.flatMap((tag) => tokenizeIndexText(tag))
  ]);
  let score = note.isPlaceholder ? 2 : 3;

  if (corpusLower.includes(note.title.toLowerCase())) {
    score += 6;
  }

  if (corpusLower.includes(note.slug.replace(/-/g, " "))) {
    score += 4;
  }

  for (const token of tokens) {
    if (stopWords.has(token) || token.length < 3) {
      continue;
    }

    if (keywords.includes(token)) {
      score += 2;
    }

    if (corpusLower.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function findPreferredIndexTarget(
  index: ExtractionIndexNote[],
  corpus: string,
  keywords: string[],
  preferredSlug?: string
): ExtractionIndexNote | null {
  if (preferredSlug) {
    const exactSlugMatch = index.find((note) => note.slug === preferredSlug);

    if (exactSlugMatch) {
      return exactSlugMatch;
    }
  }

  const corpusLower = corpus.toLowerCase();
  let bestMatch: ExtractionIndexNote | null = null;
  let bestScore = 0;

  for (const note of index) {
    const score = scoreIndexNoteMatch(note, corpusLower, keywords);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = note;
    }
  }

  return bestScore >= 6 ? bestMatch : null;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractKeywords(text: string): string[] {
  const counts = new Map<string, number>();

  for (const token of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (stopWords.has(token)) {
      continue;
    }

    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([token]) => token);
}

function buildBulletPoints(text: string): string[] {
  return splitSentences(text).slice(0, 4);
}

export function shouldExtractKnowledge(corpus: string, sourceType?: "pdf" | "web" | "text"): boolean {
  if (sourceType) {
    return true;
  }

  const normalized = corpus.trim();
  const sentences = splitSentences(normalized);
  const keywords = extractKeywords(normalized);
  const hasStructure = /(^|\n)\s*(?:[-*]\s|#{1,3}\s|\d+\.\s)/m.test(normalized);
  const hasDecisionSignal =
    /\b(decide|decision|plan|next step|tradeoff|approach|architecture|policy|workflow|implement|build|refactor|fix|learned|insight)\b/i
      .test(normalized);

  if (normalized.length < 120 && !hasStructure) {
    return false;
  }

  if (sentences.length < 2 && !hasDecisionSignal) {
    return false;
  }

  if (keywords.length < 2) {
    return false;
  }

  return true;
}

export function extractKnowledgeHeuristic(input: {
  transcript: HeuristicTranscriptMessage[];
  index: ExtractionIndexNote[];
  relatedNotes?: ExtractionContextNote[];
  sourceType?: "pdf" | "web" | "text";
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
}): ExtractionPayload {
  const corpus =
    input.sourceContent ||
    input.transcript
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n\n");

  const keywords = extractKeywords(corpus);
  const preferredTarget = findPreferredIndexTarget(
    input.index,
    corpus,
    keywords,
    input.sourceTitle ? slugify(input.sourceTitle) : undefined
  );
  const primaryTitle = preferredTarget?.title ??
    (input.sourceTitle
      ? input.sourceTitle
      : keywords.length > 0
        ? titleCase(keywords.slice(0, 2).join(" "))
        : deriveSessionTitle(input.transcript));
  const slug = preferredTarget?.slug ?? slugify(primaryTitle);
  const existing = preferredTarget
    ? !preferredTarget.isPlaceholder
    : input.index.find((note) => note.slug === slug && !note.isPlaceholder);
  const linkedTo = input.index
    .filter((note) =>
      note.slug !== slug &&
      (
        note.tags.some((tag) => keywords.includes(tag.toLowerCase())) ||
        keywords.some((keyword) => note.title.toLowerCase().includes(keyword))
      )
    )
    .slice(0, 4)
    .map((note) => note.title);
  const bullets = buildBulletPoints(corpus);
  const noteType = input.sourceType ? "source-summary" : "concept";
  const summary = splitSentences(corpus).slice(0, 2).join(" ");
  const tags = [...new Set(keywords.filter((keyword) => keyword !== "template"))].slice(0, 4);
  const keyPointLines =
    linkedTo.length > 0
      ? [
          `- Related notes: ${linkedTo.map((title) => `[[${title}]]`).join(", ")}.`,
          ...bullets.map((bullet) => `- ${bullet}`)
        ]
      : bullets.map((bullet) => `- ${bullet}`);

  const primaryContent = [
    existing
      ? "## New Context"
      : `# ${primaryTitle}`,
    existing ? "" : "",
    existing ? summary || corpus.slice(0, 280) : "## Summary",
    existing ? "" : "",
    existing ? "" : summary || corpus.slice(0, 400),
    "## Key Points",
    "",
    ...keyPointLines,
    input.sourcePath ? "" : "",
    input.sourcePath ? `Source: ${input.sourcePath}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const updates: ExtractionUpdate[] = [
    {
      operation: existing ? "append" : "create",
      targetSlug: slug,
      targetTitle: primaryTitle,
      targetType: noteType,
      summary: summary || primaryTitle,
      body: primaryContent,
      tags,
      links: linkedTo,
      evidence: [
        {
          kind: input.sourceType ? "source" : "transcript",
          ref: input.sourcePath ?? (input.sourceType ?? "transcript"),
          summary: summary || primaryTitle
        }
      ],
      confidence: existing ? 0.66 : 0.61,
      sources: input.sourceType ? 1 : 0,
      url: input.sourceType === "web" ? input.sourcePath : undefined
    }
  ];

  return {
    updates,
    sessionTitle: deriveSessionTitle(input.transcript)
  };
}
