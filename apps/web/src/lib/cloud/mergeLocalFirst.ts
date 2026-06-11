import type {
  ChatSessionSummary,
  GraphData,
  GraphEdge,
  GraphNode,
  NoteSummary,
  ThoughtRecord,
  BucketSnapshot
} from "@trellis/contracts";
import { cloudFolderPathsToFolderSummaries } from "@/lib/cloud/adapters";

function sortSessions(sessions: ChatSessionSummary[]): ChatSessionSummary[] {
  return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * Merges local + cloud session rows by id, keeping the row with the greater `updatedAt`
 * (ties prefer the local copy).
 */
export function mergeChatSessionSummaries(
  local: ChatSessionSummary[],
  cloud: ChatSessionSummary[]
): ChatSessionSummary[] {
  const byId = new Map<string, ChatSessionSummary>();

  for (const session of local) {
    byId.set(session.id, session);
  }

  for (const session of cloud) {
    const existing = byId.get(session.id);
    if (!existing) {
      byId.set(session.id, session);
      continue;
    }
    if (session.updatedAt > existing.updatedAt) {
      byId.set(session.id, session);
    }
  }

  return sortSessions([...byId.values()]);
}

function uniqueFolderPathsFromNotes(notes: NoteSummary[]): string[] {
  const paths = new Set<string>();
  for (const note of notes) {
    const path = (note.folderPath ?? "").trim();
    if (path.length > 0) {
      paths.add(path);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

function pickNewerNoteSummary(local: NoteSummary, cloud: NoteSummary): NoteSummary {
  if (local.updated === cloud.updated) {
    return local;
  }
  return local.updated > cloud.updated ? local : cloud;
}

/**
 * Merges vault indexes: union notes by `slug` using newer `updated` (ties prefer local).
 * Rebuilds folder summaries; merges graph node lists preferring the local copy when a slug
 * exists in both.
 */
export function mergeBucketSnapshotsPreferLocal(
  local: BucketSnapshot,
  cloud: BucketSnapshot
): BucketSnapshot {
  const pairs = new Map<string, { local?: NoteSummary; cloud?: NoteSummary }>();

  for (const note of local.notes) {
    pairs.set(note.slug, { local: note });
  }
  for (const note of cloud.notes) {
    const entry = pairs.get(note.slug) ?? {};
    pairs.set(note.slug, { ...entry, cloud: note });
  }

  const mergedNotes: NoteSummary[] = [];
  for (const { local: l, cloud: c } of pairs.values()) {
    if (l && c) {
      mergedNotes.push(pickNewerNoteSummary(l, c));
    } else if (l) {
      mergedNotes.push(l);
    } else if (c) {
      mergedNotes.push(c);
    }
  }

  mergedNotes.sort((left, right) => right.updated.localeCompare(left.updated));
  const folderPaths = uniqueFolderPathsFromNotes(mergedNotes);
  const folders = cloudFolderPathsToFolderSummaries(folderPaths, mergedNotes);
  return {
    bucketId: local.bucketId,
    bucketName: local.bucketName,
    bucketPath: local.bucketPath,
    notes: mergedNotes,
    folders,
    graph: mergeGraphDataPreferLocal(local.graph, cloud.graph)
  };
}

function mergeGraphDataPreferLocal(local: GraphData, cloud: GraphData): GraphData {
  const localBySlug = new Map<string, GraphNode>(local.nodes.map((node) => [node.slug, node]));
  const cloudBySlug = new Map<string, GraphNode>(cloud.nodes.map((node) => [node.slug, node]));
  const slugs = new Set<string>([...localBySlug.keys(), ...cloudBySlug.keys()]);
  const nodes: GraphNode[] = [];
  for (const slug of slugs) {
    const ln = localBySlug.get(slug);
    const cn = cloudBySlug.get(slug);
    if (ln && cn) {
      nodes.push(ln);
    } else {
      nodes.push((ln ?? cn) as GraphNode);
    }
  }
  const seenEdgeIds = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const edge of [...local.edges, ...cloud.edges]) {
    if (seenEdgeIds.has(edge.id)) {
      continue;
    }
    seenEdgeIds.add(edge.id);
    edges.push(edge);
  }
  return { nodes, edges };
}

/**
 * Merges thought rows by id, keeping the newer `updatedAt` (ties prefer local).
 */
export function mergeThoughtRecords(
  local: ThoughtRecord[],
  cloud: ThoughtRecord[]
): ThoughtRecord[] {
  const byId = new Map<string, ThoughtRecord>();

  for (const t of local) {
    byId.set(t.id, t);
  }
  for (const t of cloud) {
    const existing = byId.get(t.id);
    if (!existing) {
      byId.set(t.id, t);
      continue;
    }
    if (t.updatedAt > existing.updatedAt) {
      byId.set(t.id, t);
    }
  }

  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * When the cloud copy is still empty (or has no Strands while this device does), run a one-shot
 * migration so the server catches up. Avoids re-uploading when the cloud is already substantially
 * populated.
 */
export function shouldInitialCloudBackfill(
  cloud: { chatSessions: unknown[]; notes: unknown[] },
  local: { sessionCount: number; noteCount: number; thoughtCount: number }
): boolean {
  if (local.sessionCount + local.noteCount + local.thoughtCount === 0) {
    return false;
  }
  if (cloud.chatSessions.length === 0 && cloud.notes.length === 0) {
    return true;
  }
  if (local.noteCount > 0 && cloud.notes.length === 0) {
    return true;
  }
  return false;
}
