import type {
  ThoughtRelatedNoteRef,
  ThoughtRelatedThoughtRef,
  ThoughtTemporalSignal
} from "./types.ts";

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
  "some",
  "very",
  "thing",
  "things",
  "think",
  "thought"
]);

export function tokenizeThoughtContent(value: string): string[] {
  return [
    ...new Set(
      (value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
        (token) => !stopWords.has(token)
      )
    )
  ];
}

export function tokenSetThoughtContent(value: string): Set<string> {
  return new Set(tokenizeThoughtContent(value));
}

export function jaccardTokenSets(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;

  return union === 0 ? 0 : intersection / union;
}

export function daysBetweenTimestamps(a: number, b: number): number {
  return Math.abs(a - b) / 86_400_000;
}

export function parseNoteDateMs(value: string): number | null {
  const t = Date.parse(value);

  return Number.isFinite(t) ? t : null;
}

export function buildThoughtTemporalSignals(input: {
  thoughtCreatedAt: number;
  keywords: string[];
  relatedNotes: ThoughtRelatedNoteRef[];
  otherThoughts: Array<{ id: string; content: string; createdAt: number }>;
  notesBySlug: Map<string, { title: string; updated: string }>;
}): ThoughtTemporalSignal[] {
  const signals: ThoughtTemporalSignal[] = [];
  const topKeyword = input.keywords[0];

  if (topKeyword && input.otherThoughts.length > 0) {
    const repeats = input.otherThoughts.filter((row) =>
      row.content.toLowerCase().includes(topKeyword.toLowerCase())
    );

    if (repeats.length >= 2) {
      signals.push({
        kind: "repeat_topic",
        label: "This theme shows up often",
        detail: `“${topKeyword}” appears across several captures.`
      });
    } else if (repeats.length === 1) {
      const prior = repeats[0];
      if (prior && daysBetweenTimestamps(prior.createdAt, input.thoughtCreatedAt) >= 7) {
        signals.push({
          kind: "resurfaced",
          label: "You circled back to this",
          detail: `Similar language ${Math.round(
            daysBetweenTimestamps(prior.createdAt, input.thoughtCreatedAt)
          )} days after an earlier capture.`
        });
      }
    }
  }

  const topNoteSlug = input.relatedNotes[0]?.slug;

  if (topNoteSlug) {
    const note = input.notesBySlug.get(topNoteSlug);
    const updated = note ? parseNoteDateMs(note.updated) : null;

    if (updated !== null && updated < input.thoughtCreatedAt - 86_400_000 * 30) {
      signals.push({
        kind: "older_strand_bridge",
        label: "Touches an older Strand",
        detail: `Related note “${note?.title ?? topNoteSlug}” predates this capture.`
      });
    }
  }

  return signals.slice(0, 2);
}

export function scoreRelatedThoughtsLexical(input: {
  selfContent: string;
  selfId: string;
  others: Array<{ id: string; content: string }>;
}): ThoughtRelatedThoughtRef[] {
  const selfTokens = tokenSetThoughtContent(input.selfContent);
  const relatedThoughtScores: Array<{ ref: ThoughtRelatedThoughtRef; j: number }> = [];

  for (const other of input.others) {
    if (other.id === input.selfId) {
      continue;
    }

    const j = jaccardTokenSets(selfTokens, tokenSetThoughtContent(other.content));

    if (j < 0.06) {
      continue;
    }

    relatedThoughtScores.push({
      j,
      ref: {
        id: other.id,
        score: j,
        reason: j >= 0.22 ? "Similar language" : "Shared keywords"
      }
    });
  }

  relatedThoughtScores.sort((left, right) => right.ref.score - left.ref.score);

  return relatedThoughtScores.slice(0, 3).map((item) => item.ref);
}
