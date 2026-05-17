import { ipcMain } from "electron";
import { z } from "zod";
import type { AppSettings } from "./types";
import {
  ipcChannels,
  type RetrievalSearchInput
} from "./types";
import { rebuildBucketEmbeddings, searchRelevantNotes } from "../lib/retrieval/index";
import { readAllNotes } from "./bucket";

const retrievalSearchSchema = z.object({
  query: z.string().min(1).max(40_000),
  explicitSlugs: z.array(z.string().min(1)).max(12).optional(),
  bucketId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(16).optional()
});

function resolveBucket(settings: AppSettings, bucketId?: string) {
  const resolved =
    settings.buckets.find((b) => b.id === bucketId) ??
    settings.buckets.find((b) => b.id === settings.activeBucketId) ??
    settings.buckets[0];

  if (!resolved) {
    throw new Error("Trellis needs at least one configured bucket.");
  }

  return resolved;
}

export function registerRetrievalIpc(getSettings: () => AppSettings): void {
  ipcMain.handle(ipcChannels.retrievalSearchNotes, async (_event, input: unknown) => {
    const parsed = retrievalSearchSchema.parse(input) as RetrievalSearchInput;
    const bucket = resolveBucket(getSettings(), parsed.bucketId);
    let results = await searchRelevantNotes({
      bucketId: bucket.id,
      query: parsed.query,
      explicitSlugs: parsed.explicitSlugs,
      limit: parsed.limit
    });

    if (results.length === 0) {
      const notes = await readAllNotes(bucket.path);
      await rebuildBucketEmbeddings(bucket.id, notes);
      results = await searchRelevantNotes({
        bucketId: bucket.id,
        query: parsed.query,
        explicitSlugs: parsed.explicitSlugs,
        limit: parsed.limit
      });
    }

    return results;
  });

  ipcMain.handle(ipcChannels.retrievalRebuildIndex, async (_event, bucketId: unknown) => {
    const resolvedBucketId = z.string().min(1).optional().parse(bucketId);
    const b = resolveBucket(getSettings(), resolvedBucketId);
    const notes = await readAllNotes(b.path);
    return rebuildBucketEmbeddings(b.id, notes);
  });
}
