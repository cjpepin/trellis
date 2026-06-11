import type {
  CreateFolderInput,
  CreateStubInput,
  DeleteFolderInput,
  DeleteNoteInput,
  RenameFolderInput,
  SaveNoteInput,
  SaveNoteResult,
  BucketSnapshot,
  WikiNote
} from "@trellis/contracts";
import { getTrellisApiClient } from "@/lib/cloud/client";
import {
  cloudBootstrapToBucketSnapshot,
  cloudGraphToGraphData,
  cloudNoteToWikiNote
} from "@/lib/cloud/adapters";
import { getActiveCloudWorkspaceRuntime } from "@/lib/cloud/runtime";
import { mergeBucketSnapshotsPreferLocal } from "@/lib/cloud/mergeLocalFirst";
import { getWebSyntheticBucketId } from "@/lib/bootstrap/webPlaceholder";
import { hasElectronPreloadBridge } from "@/lib/platform/runtime";

interface LocalVaultMeta {
  id: string;
  name: string;
  path: string;
}

function normalizeFolderPath(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
}

async function resolveLocalVaultMeta(bucketId?: string): Promise<LocalVaultMeta> {
  if (!hasElectronPreloadBridge()) {
    const id = bucketId ?? getWebSyntheticBucketId();
    return { id, name: "Cloud", path: "" };
  }

  const settings = await window.trellis.app.getSettings();
  const activeBucket =
    settings.buckets.find((vault) => vault.id === bucketId) ??
    settings.buckets.find((vault) => vault.id === settings.activeBucketId) ??
    settings.buckets[0];

  if (!activeBucket) {
    throw new Error("No local vault is configured yet.");
  }

  return {
    id: activeBucket.id,
    name: activeBucket.name,
    path: activeBucket.path
  };
}

function getCloudWorkspaceId(): string | null {
  return getActiveCloudWorkspaceRuntime()?.cloudWorkspaceId ?? null;
}

export function isCloudBackedVaultActive(): boolean {
  return getCloudWorkspaceId() !== null;
}

export async function listBucketIndex(bucketId?: string): Promise<BucketSnapshot> {
  const cloudWorkspaceId = getCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.bucket.listIndex(bucketId);
  }

  const [localVault, bootstrap] = await Promise.all([
    resolveLocalVaultMeta(bucketId),
    getTrellisApiClient().bootstrap(cloudWorkspaceId)
  ]);
  const fromCloud = cloudBootstrapToBucketSnapshot(bootstrap, localVault);
  if (hasElectronPreloadBridge()) {
    const fromLocal = await window.trellis.bucket.listIndex(bucketId);
    return mergeBucketSnapshotsPreferLocal(fromLocal, fromCloud);
  }
  return fromCloud;
}

export async function readBucketNote(slug: string, bucketId?: string): Promise<WikiNote> {
  const cloudWorkspaceId = getCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.bucket.readNote(slug, bucketId);
  }

  const note = await getTrellisApiClient().getNote(cloudWorkspaceId, slug);
  return cloudNoteToWikiNote(note);
}

export async function createVaultStub(input: CreateStubInput): Promise<SaveNoteResult> {
  const cloudWorkspaceId = getCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.bucket.createStub(input);
  }

  const note = await getTrellisApiClient().saveNote({
    workspaceId: cloudWorkspaceId,
    title: input.title.trim(),
    markdownBody: `# ${input.title.trim()}\n\nThis note is ready for expansion.\n`,
    frontmatter: {
      tags: []
    },
    noteType: "concept",
    folderPath: normalizeFolderPath(input.folderPath),
    sourceCount: 0,
    url: null
  });
  const graph = await getTrellisApiClient().getGraph(cloudWorkspaceId);

  return {
    note: cloudNoteToWikiNote(note),
    graph: cloudGraphToGraphData(graph)
  };
}

export async function writeBucketNote(input: SaveNoteInput): Promise<SaveNoteResult> {
  const cloudWorkspaceId = getCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.bucket.writeNote(input);
  }

  const existing =
    input.slug && input.slug.length > 0
      ? await getTrellisApiClient().getNote(cloudWorkspaceId, input.slug).catch(() => null)
      : null;
  const frontmatter = {
    ...(existing?.frontmatter ?? {}),
    ...(input.frontmatter ?? {}),
    title: input.title,
    updated: new Date().toISOString(),
    created:
      typeof existing?.frontmatter.created === "string"
        ? existing.frontmatter.created
        : new Date().toISOString()
  };

  const note = await getTrellisApiClient().saveNote({
    workspaceId: cloudWorkspaceId,
    slug: input.slug,
    title: input.title,
    markdownBody: input.content,
    frontmatter,
    noteType:
      input.frontmatter?.type ??
      existing?.noteType ??
      "concept",
    folderPath:
      input.folderPath !== undefined
        ? normalizeFolderPath(input.folderPath)
        : existing?.folderPath ?? "",
    sourceCount:
      input.frontmatter?.sources ??
      existing?.sourceCount ??
      0,
    url:
      input.frontmatter?.url ??
      existing?.url ??
      null,
    createdAt: existing?.createdAt,
    strandRevision: input.strandRevision
      ? {
          actor: input.strandRevision.actor,
          sessionId: input.strandRevision.sessionId ?? null
        }
      : undefined
  });
  const graph = await getTrellisApiClient().getGraph(cloudWorkspaceId);

  return {
    note: cloudNoteToWikiNote(note),
    graph: cloudGraphToGraphData(graph)
  };
}

export async function deleteVaultNote(input: DeleteNoteInput): Promise<BucketSnapshot> {
  const cloudWorkspaceId = getCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.bucket.deleteNote(input);
  }

  await getTrellisApiClient().deleteNote({
    workspaceId: cloudWorkspaceId,
    slug: input.slug
  });

  return listBucketIndex(input.bucketId);
}

export async function createVaultFolder(input: CreateFolderInput): Promise<BucketSnapshot> {
  const cloudWorkspaceId = getCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.bucket.createFolder(input);
  }

  await getTrellisApiClient().createFolder({
    workspaceId: cloudWorkspaceId,
    name: input.name,
    parentPath: input.parentPath
  });

  return listBucketIndex(input.bucketId);
}

export async function renameVaultFolder(input: RenameFolderInput): Promise<BucketSnapshot> {
  const cloudWorkspaceId = getCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.bucket.renameFolder(input);
  }

  await getTrellisApiClient().renameFolder({
    workspaceId: cloudWorkspaceId,
    path: input.path,
    name: input.name,
    parentPath: input.parentPath
  });

  return listBucketIndex(input.bucketId);
}

export async function deleteVaultFolder(input: DeleteFolderInput): Promise<BucketSnapshot> {
  const cloudWorkspaceId = getCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.bucket.deleteFolder(input);
  }

  await getTrellisApiClient().deleteFolder({
    workspaceId: cloudWorkspaceId,
    path: input.path
  });

  return listBucketIndex(input.bucketId);
}
