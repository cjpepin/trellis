import type {
  CreateThoughtInput,
  ThoughtEnrichment,
  ThoughtRecord
} from "@trellis/shared/thoughts/types";
import { getTrellisApiClient } from "@/lib/cloud/client";
import { mergeThoughtRecords } from "@/lib/cloud/mergeLocalFirst";
import { getActiveCloudWorkspaceRuntime } from "@/lib/cloud/runtime";
import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const thoughtSelect =
  "id, workspace_id, content, source_type, status, backing_note_slug, related_thought_ids, extracted_entities, tags, enrichment_json, enrichment_error, created_at, updated_at";

function getCloudWorkspaceId(): string | null {
  return getActiveCloudWorkspaceRuntime()?.cloudWorkspaceId ?? null;
}

interface ThoughtRow {
  id: string;
  workspace_id: string;
  content: string;
  source_type: string;
  status: string;
  backing_note_slug: string | null;
  related_thought_ids: unknown;
  extracted_entities: unknown;
  tags: unknown;
  enrichment_json: unknown;
  enrichment_error: string | null;
  created_at: string;
  updated_at: string;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function mapRowToRecord(row: ThoughtRow, bucketIdForUi: string): ThoughtRecord {
  let enrichment: ThoughtEnrichment | null = null;
  if (row.enrichment_json && typeof row.enrichment_json === "object") {
    enrichment = row.enrichment_json as ThoughtEnrichment;
  }

  return {
    id: row.id,
    bucketId: bucketIdForUi,
    content: row.content,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    sourceType: row.source_type as ThoughtRecord["sourceType"],
    status: row.status as ThoughtRecord["status"],
    backingNoteSlug: row.backing_note_slug,
    relatedThoughtIds: parseStringArray(row.related_thought_ids),
    extractedEntities: parseStringArray(row.extracted_entities),
    tags: parseStringArray(row.tags),
    enrichment,
    enrichmentError: row.enrichment_error
  };
}

export async function listCloudThoughts(
  workspaceId: string,
  bucketIdForUi: string,
  limit = 300
): Promise<ThoughtRecord[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("thoughts")
    .select(thoughtSelect)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message ?? "Could not list thoughts.");
  }

  return ((data ?? []) as ThoughtRow[]).map((row) => mapRowToRecord(row, bucketIdForUi));
}

export async function getCloudThought(
  workspaceId: string,
  thoughtId: string,
  bucketIdForUi: string
): Promise<ThoughtRecord | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("thoughts")
    .select(thoughtSelect)
    .eq("workspace_id", workspaceId)
    .eq("id", thoughtId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? "Could not load thought.");
  }

  if (!data) {
    return null;
  }

  return mapRowToRecord(data as ThoughtRow, bucketIdForUi);
}

export async function createCloudThought(
  workspaceId: string,
  bucketIdForUi: string,
  input: CreateThoughtInput
): Promise<ThoughtRecord> {
  const content = input.content.trim();
  if (content.length === 0) {
    throw new Error("Thought content cannot be empty.");
  }

  const supabase = getSupabase();
  const sourceType = input.sourceType ?? "manual";

  const { data, error } = await supabase
    .from("thoughts")
    .insert({
      workspace_id: workspaceId,
      content,
      source_type: sourceType,
      status: "raw",
      backing_note_slug: input.backingNoteSlug ?? null,
      related_thought_ids: [],
      extracted_entities: [],
      tags: []
    })
    .select(thoughtSelect)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create thought.");
  }

  return mapRowToRecord(data as ThoughtRow, bucketIdForUi);
}

export async function listThoughtsBridged(bucketId: string): Promise<ThoughtRecord[]> {
  const cloudWorkspaceId = getCloudWorkspaceId();
  if (cloudWorkspaceId && hasSupabaseConfig()) {
    const fromCloud = await listCloudThoughts(cloudWorkspaceId, bucketId);
    if (hasElectronPreloadBridge()) {
      const fromLocal = await window.trellis.db.listThoughts(bucketId);
      return mergeThoughtRecords(fromLocal, fromCloud);
    }
    return fromCloud;
  }
  if (!hasElectronPreloadBridge()) {
    return [];
  }
  return window.trellis.db.listThoughts(bucketId);
}

export async function getThoughtBridged(
  thoughtId: string,
  bucketId: string
): Promise<ThoughtRecord | null> {
  const cloudWorkspaceId = getCloudWorkspaceId();
  if (cloudWorkspaceId && hasSupabaseConfig()) {
    return getCloudThought(cloudWorkspaceId, thoughtId, bucketId);
  }
  if (!hasElectronPreloadBridge()) {
    return null;
  }
  return window.trellis.db.getThought(thoughtId);
}

export async function createThoughtBridged(input: CreateThoughtInput): Promise<ThoughtRecord> {
  const cloudWorkspaceId = getCloudWorkspaceId();
  if (cloudWorkspaceId && hasSupabaseConfig()) {
    const created = await createCloudThought(cloudWorkspaceId, input.bucketId, input);
    void getTrellisApiClient()
      .thoughtEnrich({ workspaceId: cloudWorkspaceId, thoughtId: created.id })
      .catch(() => {
        // best-effort; row may stay raw/failed until user retries
      });
    return created;
  }
  if (!hasElectronPreloadBridge()) {
    throw new Error("Thoughts require the desktop app or a signed-in cloud workspace.");
  }
  return window.trellis.db.createThought(input);
}

export async function retryThoughtEnrichmentBridged(thoughtId: string): Promise<void> {
  const cloudWorkspaceId = getCloudWorkspaceId();
  if (cloudWorkspaceId && hasSupabaseConfig()) {
    await getTrellisApiClient().thoughtEnrich({
      workspaceId: cloudWorkspaceId,
      thoughtId
    });
    return;
  }
  if (!hasElectronPreloadBridge()) {
    throw new Error("Thought enrichment requires the desktop app.");
  }
  await window.trellis.db.retryThoughtEnrichment(thoughtId);
}
