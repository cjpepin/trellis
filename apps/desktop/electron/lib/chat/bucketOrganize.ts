import type { AppSettings, ApplyBucketOrganizeResult, NoteSummary } from "../../ipc/types";
import {
  hasBucketOrganizeIntent,
  planBucketOrganize,
  type BucketOrganizeNoteSummary
} from "@trellis/shared/chat/bucketOrganizePlan";
import {
  buildSnapshot,
  createFolder,
  readNoteOrCreateIfMissing,
  resolveBucket,
  writeNoteFile
} from "../../ipc/bucket";
import { normalizeWikiFolderPath } from "@trellis/shared/bucket/folderPath";

export { hasBucketOrganizeIntent, planBucketOrganize };

function toOrganizeSummaries(notes: NoteSummary[]): BucketOrganizeNoteSummary[] {
  return notes.map((note) => ({
    slug: note.slug,
    title: note.title,
    folderPath: note.folderPath ?? ""
  }));
}

export async function executeBucketOrganize(
  getSettings: () => AppSettings,
  input: { bucketId: string; userMessage: string }
): Promise<ApplyBucketOrganizeResult> {
  const vault = resolveBucket(getSettings(), input.bucketId);
  const snapshot = await buildSnapshot(vault.path, vault.id, vault.name);
  const plan = planBucketOrganize(input.userMessage, toOrganizeSummaries(snapshot.notes));

  if (!plan || (plan.createFolders.length === 0 && plan.moves.length === 0)) {
    return { applied: false, message: null };
  }

  for (const folder of plan.createFolders) {
    await createFolder(vault.path, {
      name: folder.name,
      parentPath: folder.parentPath
    });
  }

  let moveCount = 0;
  let movedNote: { slug: string; title: string } | undefined;

  for (const move of plan.moves) {
    const existing = await readNoteOrCreateIfMissing(vault.path, move.slug);

    if (normalizeWikiFolderPath(existing.folderPath) === normalizeWikiFolderPath(move.folderPath)) {
      continue;
    }

    await writeNoteFile(vault.path, vault.id, {
      bucketId: vault.id,
      slug: existing.slug,
      title: existing.title,
      content: existing.content,
      folderPath: move.folderPath,
      frontmatter: {
        tags: existing.tags,
        type: existing.type,
        sources: existing.sources
      },
      strandRevision: { actor: "trellis" }
    });
    moveCount += 1;
    if (!movedNote) {
      movedNote = { slug: existing.slug, title: existing.title };
    }
  }

  const folderLabel = plan.createFolders[0]?.name ?? "folder";

  if (moveCount > 0) {
    return {
      applied: true,
      message: `Created wiki folder “${folderLabel}” and moved ${moveCount} note${moveCount === 1 ? "" : "s"}.`,
      movedNote
    };
  }

  return {
    applied: true,
    message: `Created wiki folder “${folderLabel}”.`
  };
}
