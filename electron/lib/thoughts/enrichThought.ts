import type { AppSettings, WikiNote } from "../../ipc/types";
import { resolveVault, readAllNotes } from "../../ipc/vault";
import { searchRelevantNotes } from "../retrieval/index";
import {
  finalizeThoughtEnrichment,
  finalizeThoughtFailure,
  getThoughtById,
  listThoughtsForVault,
  markThoughtProcessing
} from "../database";
import type {
  ThoughtEnrichment,
  ThoughtRelatedNoteRef,
  ThoughtRelatedThoughtRef,
  ThoughtTemporalSignal
} from "@shared/thoughts/types";
import { broadcastThoughtUpdated } from "./broadcastThoughtUpdated";

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

function tokenize(value: string): string[] {
  return [
    ...new Set(
      (value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
        (token) => !stopWords.has(token)
      )
    )
  ];
}

function tokenSet(value: string): Set<string> {
  return new Set(tokenize(value));
}

function jaccard(left: Set<string>, right: Set<string>): number {
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

function daysBetween(a: number, b: number): number {
  return Math.abs(a - b) / 86_400_000;
}

function parseNoteDate(value: string): number | null {
  const t = Date.parse(value);

  return Number.isFinite(t) ? t : null;
}

function buildTemporalSignals(input: {
  thoughtContent: string;
  thoughtCreatedAt: number;
  keywords: string[];
  relatedNotes: ThoughtRelatedNoteRef[];
  otherThoughts: Array<{ id: string; content: string; createdAt: number }>;
  notesBySlug: Map<string, WikiNote>;
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
      if (prior && daysBetween(prior.createdAt, input.thoughtCreatedAt) >= 7) {
        signals.push({
          kind: "resurfaced",
          label: "You circled back to this",
          detail: `Similar language ${Math.round(
            daysBetween(prior.createdAt, input.thoughtCreatedAt)
          )} days after an earlier capture.`
        });
      }
    }
  }

  const topNoteSlug = input.relatedNotes[0]?.slug;

  if (topNoteSlug) {
    const note = input.notesBySlug.get(topNoteSlug);
    const updated = note ? parseNoteDate(note.updated) : null;

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

/**
 * Non-blocking enrichment: keywords, related Strands (retrieval), related thoughts (lexical),
 * and light temporal hints. Safe to retry on failure.
 */
export async function runThoughtEnrichment(
  thoughtId: string,
  getSettings: () => AppSettings
): Promise<void> {
  const thought = await getThoughtById(thoughtId);

  if (!thought) {
    return;
  }

  await markThoughtProcessing(thoughtId);

  const processingSnapshot = await getThoughtById(thoughtId);

  if (processingSnapshot) {
    broadcastThoughtUpdated({
      vaultId: processingSnapshot.vaultId,
      thought: processingSnapshot
    });
  }

  try {
    const vault = resolveVault(getSettings(), thought.vaultId);
    const querySlice = thought.content.trim().slice(0, 2_000);
    const noteHits = await searchRelevantNotes({
      vaultId: vault.id,
      query: querySlice,
      limit: 6
    });

    const relatedNotes: ThoughtRelatedNoteRef[] = noteHits.slice(0, 5).map((note) => ({
      slug: note.slug,
      title: note.title,
      score: note.score,
      reason:
        note.score >= 12
          ? "Strong match"
          : note.score >= 6
            ? "Shared topic"
            : "Possibly related"
    }));

    const allThoughts = await listThoughtsForVault(vault.id, 400);
    const others = allThoughts.filter((row) => row.id !== thought.id);
    const selfTokens = tokenSet(thought.content);

    const relatedThoughtScores: Array<{ ref: ThoughtRelatedThoughtRef; j: number }> = [];

    for (const other of others) {
      const j = jaccard(selfTokens, tokenSet(other.content));

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

    const relatedThoughts = relatedThoughtScores.slice(0, 3).map((item) => item.ref);
    const keywords = tokenize(thought.content).slice(0, 12);

    const notesList = await readAllNotes(vault.path);
    const notesBySlug = new Map(notesList.map((note) => [note.slug, note]));

    const temporalSignals = buildTemporalSignals({
      thoughtContent: thought.content,
      thoughtCreatedAt: thought.createdAt,
      keywords,
      relatedNotes,
      otherThoughts: others.map((row) => ({
        id: row.id,
        content: row.content,
        createdAt: row.createdAt
      })),
      notesBySlug
    });

    const enrichment: ThoughtEnrichment = {
      keywords,
      relatedNotes: relatedNotes.slice(0, 4),
      relatedThoughts,
      temporalSignals
    };

    const enriched = await finalizeThoughtEnrichment(thought.id, {
      enrichment,
      relatedThoughtIds: relatedThoughts.map((item) => item.id),
      extractedEntities: keywords.slice(0, 8),
      tags: keywords.slice(0, 6)
    });

    broadcastThoughtUpdated({
      vaultId: enriched.vaultId,
      thought: enriched
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await finalizeThoughtFailure(thoughtId, message);

    broadcastThoughtUpdated({
      vaultId: failed.vaultId,
      thought: failed
    });
  }
}
