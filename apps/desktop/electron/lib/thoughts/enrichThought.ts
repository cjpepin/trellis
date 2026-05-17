import type { AppSettings } from "../../ipc/types";
import { resolveBucket, readAllNotes } from "../../ipc/bucket";
import { searchRelevantNotes } from "../retrieval/index";
import {
  finalizeThoughtEnrichment,
  finalizeThoughtFailure,
  getThoughtById,
  listThoughtsForBucket,
  markThoughtProcessing
} from "../database";
import type { ThoughtEnrichment, ThoughtRelatedNoteRef } from "@trellis/shared/thoughts/types";
import {
  buildThoughtTemporalSignals,
  scoreRelatedThoughtsLexical,
  tokenizeThoughtContent
} from "@trellis/shared/thoughts/enrichShared";
import { broadcastThoughtUpdated } from "./broadcastThoughtUpdated";

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
      bucketId: processingSnapshot.bucketId,
      thought: processingSnapshot
    });
  }

  try {
    const vault = resolveBucket(getSettings(), thought.bucketId);
    const querySlice = thought.content.trim().slice(0, 2_000);
    const noteHits = await searchRelevantNotes({
      bucketId: vault.id,
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

    const allThoughts = await listThoughtsForBucket(vault.id, 400);
    const others = allThoughts.filter((row) => row.id !== thought.id);
    const relatedThoughts = scoreRelatedThoughtsLexical({
      selfContent: thought.content,
      selfId: thought.id,
      others: others.map((row) => ({ id: row.id, content: row.content }))
    });
    const keywords = tokenizeThoughtContent(thought.content).slice(0, 12);

    const notesList = await readAllNotes(vault.path);
    const notesBySlug = new Map(
      notesList.map((note) => [note.slug, { title: note.title, updated: note.updated }])
    );

    const temporalSignals = buildThoughtTemporalSignals({
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
      bucketId: enriched.bucketId,
      thought: enriched
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await finalizeThoughtFailure(thoughtId, message);

    broadcastThoughtUpdated({
      bucketId: failed.bucketId,
      thought: failed
    });
  }
}
