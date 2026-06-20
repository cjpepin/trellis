import type {
  BucketSnapshot,
  CreateStubInput,
  DeleteNoteInput,
  NoteSummary,
  SaveNoteInput,
  SaveNoteResult,
  WikiNote,
} from "@trellis/contracts";
import { slugifyNoteTitle } from "@/lib/noteReferences";
import { listDemoVaultIndex, readDemoVaultNote } from "./demoVault";

const noteOverrides = new Map<string, WikiNote>();
const createdNotes = new Map<string, WikiNote>();
const deletedSlugs = new Set<string>();

function excerptFromContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}

function mergeNoteSummary(note: NoteSummary, override?: WikiNote): NoteSummary {
  if (!override) return note;
  return {
    ...note,
    title: override.title,
    updated: override.updated,
    tags: override.tags,
    type: override.type,
    excerpt: excerptFromContent(override.content),
    folderPath: override.folderPath,
    relativePath: override.relativePath,
  };
}

async function baseSnapshot(bucketId?: string): Promise<BucketSnapshot> {
  return listDemoVaultIndex(bucketId);
}

async function mergedSnapshot(bucketId?: string): Promise<BucketSnapshot> {
  const snapshot = await baseSnapshot(bucketId);
  const notesBySlug = new Map(snapshot.notes.map((note) => [note.slug, note]));

  for (const [slug, note] of createdNotes.entries()) {
    if (deletedSlugs.has(slug)) continue;
    notesBySlug.set(slug, {
      slug: note.slug,
      title: note.title,
      updated: note.updated,
      tags: note.tags,
      type: note.type,
      excerpt: excerptFromContent(note.content),
      inboundCount: note.inboundCount,
      folderPath: note.folderPath,
      relativePath: note.relativePath,
    });
  }

  for (const [slug, override] of noteOverrides.entries()) {
    if (deletedSlugs.has(slug)) continue;
    const existing = notesBySlug.get(slug);
    if (existing) {
      notesBySlug.set(slug, mergeNoteSummary(existing, override));
    }
  }

  const notes = [...notesBySlug.values()]
    .filter((note) => !deletedSlugs.has(note.slug))
    .sort((left, right) => left.title.localeCompare(right.title));

  return {
    ...snapshot,
    notes,
  };
}

async function readMergedNote(slug: string, bucketId?: string): Promise<WikiNote> {
  const override = noteOverrides.get(slug) ?? createdNotes.get(slug);
  if (override && !deletedSlugs.has(slug)) {
    return override;
  }
  return readDemoVaultNote(slug, bucketId);
}

function buildNoteFromInput(input: SaveNoteInput, base?: WikiNote | null): WikiNote {
  const slug = input.slug?.trim() || slugifyNoteTitle(input.title);
  const folderPath = input.folderPath ?? base?.folderPath ?? "wiki";
  const relativePath =
    input.relativePath ??
    base?.relativePath ??
    (folderPath ? `${folderPath}/${slug}.md` : `${slug}.md`);

  return {
    slug,
    title: input.title.trim(),
    content: input.content,
    updated: new Date().toISOString(),
    tags: (input.frontmatter?.tags as string[] | undefined) ?? base?.tags ?? [],
    type: (input.frontmatter?.type as WikiNote["type"] | undefined) ?? base?.type ?? "concept",
    excerpt: excerptFromContent(input.content),
    inboundCount: base?.inboundCount ?? 0,
    folderPath,
    relativePath,
    links: base?.links ?? [],
    sources:
      typeof input.frontmatter?.sources === "number"
        ? input.frontmatter.sources
        : (base?.sources ?? 0),
    url: typeof input.frontmatter?.url === "string" ? input.frontmatter.url : base?.url,
  };
}

export async function writeDemoWorkspaceNote(input: SaveNoteInput): Promise<SaveNoteResult> {
  const slug = input.slug?.trim() || slugifyNoteTitle(input.title);
  const base = input.slug ? await readMergedNote(slug, input.bucketId).catch(() => null) : null;
  const note = buildNoteFromInput({ ...input, slug }, base);

  if (base || createdNotes.has(slug)) {
    noteOverrides.set(slug, note);
  } else {
    createdNotes.set(slug, note);
  }

  const snapshot = await mergedSnapshot(input.bucketId);
  return { note, graph: snapshot.graph };
}

export async function createDemoWorkspaceStub(input: CreateStubInput): Promise<SaveNoteResult> {
  const title = input.title.trim();
  const slug = slugifyNoteTitle(title);
  const folderPath = input.folderPath ?? "wiki";
  const note: WikiNote = {
    slug,
    title,
    content: `# ${title}\n\n`,
    updated: new Date().toISOString(),
    tags: [],
    type: "concept",
    excerpt: title,
    inboundCount: 0,
    folderPath,
    relativePath: folderPath ? `${folderPath}/${slug}.md` : `${slug}.md`,
    links: [],
    sources: 0,
  };

  createdNotes.set(slug, note);
  const snapshot = await mergedSnapshot(input.bucketId);
  return { note, graph: snapshot.graph };
}

export async function deleteDemoWorkspaceNote(input: DeleteNoteInput): Promise<BucketSnapshot> {
  deletedSlugs.add(input.slug);
  noteOverrides.delete(input.slug);
  createdNotes.delete(input.slug);
  return mergedSnapshot(input.bucketId);
}

export async function readDemoWorkspaceNote(slug: string, bucketId?: string): Promise<WikiNote> {
  return readMergedNote(slug, bucketId);
}

export async function listDemoWorkspaceIndex(bucketId?: string): Promise<BucketSnapshot> {
  return mergedSnapshot(bucketId);
}
