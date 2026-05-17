import type { WikiNote } from "@trellis/contracts";
import type { CloudMigrationImportRequest, JsonObject, JsonValue } from "@trellis/shared/cloud/types";
import { getTrellisApiClient } from "@/lib/cloud/client";
import { hasElectronPreloadBridge } from "@/lib/platform/runtime";

function isoFromMs(t: number | undefined, fallback: string): string {
  if (t === undefined || !Number.isFinite(t)) {
    return fallback;
  }
  return new Date(t).toISOString();
}

/**
 * Exports the current local SQLite + vault snapshot and POSTs it to `migration-import`
 * so the cloud copy catches up with desktop. Safe to run when cloud was empty; uses
 * legacy ids so re-runs upsert rather than duplicating.
 */
export async function pushLocalWorkspaceToCloud(cloudWorkspaceId: string, bucketId: string): Promise<void> {
  if (!hasElectronPreloadBridge() || !window.trellis?.db || !window.trellis?.bucket) {
    return;
  }

  const [sessions, localThoughts, index] = await Promise.all([
    window.trellis.db.listSessions(),
    window.trellis.db.listThoughts(bucketId),
    window.trellis.bucket.listIndex(bucketId)
  ]);

  const notes: NonNullable<CloudMigrationImportRequest["notes"]> = [];
  for (const summary of index.notes) {
    const full: WikiNote = await window.trellis.bucket.readNote(summary.slug, bucketId);
    notes.push({
      legacyId: full.slug,
      slug: full.slug,
      title: full.title,
      markdownBody: full.content,
      frontmatter: {},
      noteType: full.type,
      folderPath: full.folderPath,
      sourceCount: full.sources,
      url: full.url ?? null,
      createdAt: full.updated,
      updatedAt: full.updated
    });
  }

  const chatSessions: NonNullable<CloudMigrationImportRequest["chatSessions"]> = [];
  for (const session of sessions) {
    if (session.bucketId !== bucketId) {
      continue;
    }
    const messages = await window.trellis.db.getMessages(session.id);
    chatSessions.push({
      legacyId: session.id,
      title: session.title,
      model: String(session.model),
      createdAt: isoFromMs(session.createdAt, new Date().toISOString()),
      updatedAt: isoFromMs(session.updatedAt, new Date().toISOString()),
      messages: messages.map((m) => ({
        legacyId: m.id,
        role: m.role,
        content: m.content,
        tokens: m.tokens,
        attachments: m.attachments as unknown as JsonValue[] | undefined,
        mediaArtifacts: m.mediaArtifacts as unknown as JsonValue[] | undefined,
        noteActions: m.noteActions as unknown as JsonValue[] | undefined,
        replyContext: m.replyContext as unknown as JsonObject | null | undefined,
        composerPins: m.composerPins as unknown as JsonValue[] | undefined,
        createdAt: isoFromMs(m.createdAt, new Date().toISOString())
      }))
    });
  }

  const thoughts: NonNullable<CloudMigrationImportRequest["thoughts"]> = localThoughts.map((t) => ({
    legacyId: t.id,
    content: t.content,
    sourceType: t.sourceType,
    status: t.status,
    backingNoteSlug: t.backingNoteSlug,
    relatedThoughtIds: t.relatedThoughtIds,
    extractedEntities: t.extractedEntities,
    tags: t.tags,
    enrichment: t.enrichment as unknown as JsonObject | null,
    enrichmentError: t.enrichmentError,
    createdAt: isoFromMs(t.createdAt, new Date().toISOString()),
    updatedAt: isoFromMs(t.updatedAt, new Date().toISOString())
  }));

  const importDigest = `trellis-electron-backfill-${cloudWorkspaceId}-${Date.now()}`;
  const body: CloudMigrationImportRequest = {
    workspaceId: cloudWorkspaceId,
    importDigest,
    importSummary: { source: "electron-local-first" },
    notes,
    chatSessions,
    thoughts
  };

  await getTrellisApiClient().importMigrationSnapshot(body);
}
