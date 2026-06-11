/**
 * Thoughts are the interaction layer: fast capture stored in SQLite, optionally linked to Strands.
 * See docs/schema.md (Thoughts) for persistence semantics.
 */

export type ThoughtSourceType = "manual" | "imported" | "converted_from_note" | "system";

export type ThoughtStatus = "raw" | "processing" | "enriched" | "failed";

export interface ThoughtRelatedNoteRef {
  slug: string;
  title: string;
  score: number;
  /** Short, user-facing explanation (e.g. "Shared topic", "Retrieval match"). */
  reason: string;
}

export interface ThoughtRelatedThoughtRef {
  id: string;
  score: number;
  reason: string;
}

export type ThoughtTemporalKind = "repeat_topic" | "resurfaced" | "older_strand_bridge";

export interface ThoughtTemporalSignal {
  kind: ThoughtTemporalKind;
  label: string;
  detail?: string;
}

export interface ThoughtEnrichment {
  keywords: string[];
  relatedNotes: ThoughtRelatedNoteRef[];
  relatedThoughts: ThoughtRelatedThoughtRef[];
  temporalSignals: ThoughtTemporalSignal[];
}

export interface ThoughtRecord {
  id: string;
  bucketId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  sourceType: ThoughtSourceType;
  status: ThoughtStatus;
  backingNoteSlug: string | null;
  relatedThoughtIds: string[];
  extractedEntities: string[];
  tags: string[];
  enrichment: ThoughtEnrichment | null;
  enrichmentError: string | null;
}

export interface CreateThoughtInput {
  bucketId: string;
  content: string;
  sourceType?: ThoughtSourceType;
  backingNoteSlug?: string | null;
}
