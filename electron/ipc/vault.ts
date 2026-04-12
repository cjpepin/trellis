import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { dialog, ipcMain } from "electron";
import YAML from "yaml";
import { z } from "zod";
import type {
  AppSettings,
  CreateFolderInput,
  CreateStubInput,
  DeleteFolderInput,
  DeleteNoteInput,
  ExportToObsidianInput,
  ExportToObsidianResult,
  FolderSummary,
  GraphData,
  GraphEdge,
  GraphNode,
  ImportFromObsidianInput,
  ImportFromObsidianResult,
  NoteFrontmatter,
  NoteSummary,
  RenameFolderInput,
  SaveNoteInput,
  SaveNoteResult,
  VaultImportNoteImageResult,
  VaultReadNoteAssetDataUrlInput,
  VaultSnapshot,
  WikiNote
} from "./types";
import { ipcChannels, TRELLIS_DEFAULT_CHAT_IMAGE_NOTE_SLUG } from "./types";
import { readMediaCacheBytes } from "../lib/chatMediaCache";
import { rebuildVaultEmbeddings, syncNoteEmbeddings } from "../lib/retrieval/index";

const noteTypeSchema = z.enum([
  "concept",
  "entity",
  "source-summary",
  "synthesis"
] as const);

const createStubSchema = z.object({
  title: z.string().min(1).max(120),
  folderPath: z.string().nullable().optional(),
  vaultId: z.string().min(1).optional()
});

const folderPathSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\\/g, "/"))
  .refine((value) => !value.startsWith("/") && !value.includes(".."), {
    message: "Folder paths must stay inside the wiki root."
  });

const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const saveNoteSchema = z.object({
  vaultId: z.string().min(1).optional(),
  slug: slugSchema.optional(),
  relativePath: z.string().min(1).optional(),
  folderPath: z.string().nullable().optional(),
  title: z.string().min(1).max(120),
  content: z.string(),
  frontmatter: z
    .object({
      title: z.string().optional(),
      created: z.string().optional(),
      updated: z.string().optional(),
      sources: z.number().int().optional(),
      tags: z.array(z.string()).optional(),
      type: noteTypeSchema.optional(),
      url: z.string().url().optional()
    })
    .optional()
});

const noteLookupSchema = z.object({
  slug: slugSchema,
  vaultId: z.string().min(1).optional()
});

const deleteNoteSchema = z.object({
  slug: slugSchema,
  relativePath: z.string().min(1).optional(),
  vaultId: z.string().min(1).optional()
});

const createFolderSchema = z.object({
  name: z.string().min(1).max(120),
  parentPath: z.string().nullable().optional(),
  vaultId: z.string().min(1).optional()
});

const renameFolderSchema = z.object({
  path: folderPathSchema,
  name: z.string().min(1).max(120),
  parentPath: z.string().nullable().optional(),
  vaultId: z.string().min(1).optional()
});

const deleteFolderSchema = z.object({
  path: folderPathSchema,
  vaultId: z.string().min(1).optional()
});

const selectDirectorySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  buttonLabel: z.string().min(1).max(40).optional()
});

const importFromObsidianSchema = z.object({
  sourcePath: z.string().min(1),
  vaultId: z.string().min(1).optional()
});

const exportToObsidianSchema = z.object({
  targetPath: z.string().min(1),
  vaultId: z.string().min(1).optional()
});

const appendChatImageSchema = z.object({
  vaultId: z.string().min(1).optional(),
  fileId: z.string().uuid(),
  slug: slugSchema.optional(),
  alt: z.string().max(200).optional()
});

const importNoteImageSchema = z.object({
  vaultId: z.string().min(1).optional(),
  fileId: z.string().uuid(),
  noteRelativePath: z.string().min(1),
  alt: z.string().max(200).optional()
});

const readNoteAssetDataUrlSchema = z.object({
  vaultId: z.string().min(1).optional(),
  noteRelativePath: z.string().min(1),
  assetPath: z.string().min(1).max(1000)
});

const imageMimeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

function extensionForMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();

  if (lower.includes("png")) {
    return ".png";
  }

  if (lower.includes("jpeg") || lower.includes("jpg")) {
    return ".jpg";
  }

  if (lower.includes("webp")) {
    return ".webp";
  }

  if (lower.includes("gif")) {
    return ".gif";
  }

  return ".png";
}

function assertImageMime(mimeType: string): void {
  const lower = mimeType.toLowerCase();

  if (
    !lower.includes("png") &&
    !lower.includes("jpeg") &&
    !lower.includes("jpg") &&
    !lower.includes("webp") &&
    !lower.includes("gif")
  ) {
    throw new Error("Only PNG, JPEG, WebP, and GIF images can be attached to notes.");
  }
}

function encodeMarkdownPathSegments(rel: string): string {
  return rel
    .split("/")
    .map((segment) => {
      if (segment === "." || segment === "..") {
        return segment;
      }

      return encodeURIComponent(segment);
    })
    .join("/");
}

function relativeMarkdownPathToFile(fromDir: string, toFile: string): string {
  let rel = path.relative(fromDir, toFile);
  rel = rel.split(path.sep).join("/");

  if (rel.length === 0) {
    return "";
  }

  const encoded = encodeMarkdownPathSegments(rel);

  if (!encoded.startsWith(".")) {
    return `./${encoded}`;
  }

  return encoded;
}

function decodeMarkdownPathSegments(rel: string): string {
  return rel
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function stripMarkdownPathSuffixes(src: string): string {
  return src.split("#")[0]?.split("?")[0] ?? "";
}

function isRemoteOrInlineAsset(src: string): boolean {
  const lower = src.trim().toLowerCase();
  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("file:")
  );
}

function resolveNoteAssetPath(
  vaultPath: string,
  input: VaultReadNoteAssetDataUrlInput
): string | null {
  const src = stripMarkdownPathSuffixes(input.assetPath.trim());

  if (!src || isRemoteOrInlineAsset(src) || path.isAbsolute(src)) {
    return null;
  }

  const wikiRoot = path.join(vaultPath, "wiki");
  const notePath = ensureInsideVault(vaultPath, path.join(wikiRoot, input.noteRelativePath));
  const assetPath = ensureInsideVault(
    vaultPath,
    path.resolve(path.dirname(notePath), decodeMarkdownPathSegments(src))
  );
  const relativeToWiki = path.relative(wikiRoot, assetPath);

  if (relativeToWiki.startsWith("..") || path.isAbsolute(relativeToWiki)) {
    return null;
  }

  return assetPath;
}

async function importNoteImageForVault(
  vaultPath: string,
  input: { fileId: string; noteRelativePath: string; alt?: string }
): Promise<VaultImportNoteImageResult> {
  const got = await readMediaCacheBytes(input.fileId);

  if (!got) {
    throw new Error("That image is no longer in local cache. Attach it again.");
  }

  return importNoteImageBytesForVault(vaultPath, {
    bytes: got.bytes,
    mimeType: got.mimeType,
    noteRelativePath: input.noteRelativePath,
    alt: input.alt
  });
}

async function importNoteImageBytesForVault(
  vaultPath: string,
  input: { bytes: Uint8Array; mimeType: string; noteRelativePath: string; alt?: string }
): Promise<VaultImportNoteImageResult> {
  assertImageMime(input.mimeType);
  await ensureVaultLayout(vaultPath);

  const ext = extensionForMime(input.mimeType);
  const fileName = `note-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  const assetsDir = ensureInsideVault(
    vaultPath,
    path.join(vaultPath, "wiki", ".trellis-note-assets")
  );
  await ensureDirectory(assetsDir);

  const imageAbsolutePath = ensureInsideVault(vaultPath, path.join(assetsDir, fileName));
  await fs.writeFile(imageAbsolutePath, input.bytes);

  const wikiRoot = path.join(vaultPath, "wiki");
  const noteAbsolutePath = ensureInsideVault(vaultPath, path.join(wikiRoot, input.noteRelativePath));
  const markdownPath = relativeMarkdownPathToFile(path.dirname(noteAbsolutePath), imageAbsolutePath);

  if (!markdownPath) {
    throw new Error("Could not compute a link path for that image.");
  }

  return {
    markdownPath,
    alt: input.alt?.trim() || path.basename(fileName, ext)
  };
}

async function readNoteAssetDataUrlForVault(
  vaultPath: string,
  input: VaultReadNoteAssetDataUrlInput
): Promise<string | null> {
  let assetPath: string | null;

  try {
    assetPath = resolveNoteAssetPath(vaultPath, input);
  } catch {
    return null;
  }

  if (!assetPath) {
    return null;
  }

  const ext = path.extname(assetPath).toLowerCase();
  const mimeType = imageMimeByExtension[ext];

  if (!mimeType) {
    return null;
  }

  try {
    const bytes = await fs.readFile(assetPath);
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

async function appendChatImageToNoteForVault(
  vaultPath: string,
  vaultId: string,
  input: { fileId: string; slug?: string; alt?: string }
): Promise<SaveNoteResult> {
  const got = await readMediaCacheBytes(input.fileId);

  if (!got) {
    throw new Error("That image is no longer in local cache. Generate it again.");
  }

  assertImageMime(got.mimeType);
  const ext = extensionForMime(got.mimeType);
  const fileName = `chat-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  await ensureVaultLayout(vaultPath);
  const mediaDirAbsolute = ensureInsideVault(
    vaultPath,
    path.join(vaultPath, "wiki", ".trellis-chat-media")
  );
  await ensureDirectory(mediaDirAbsolute);
  const imageAbsolutePath = path.join(mediaDirAbsolute, fileName);
  await fs.writeFile(imageAbsolutePath, got.bytes);

  const targetSlug = input.slug ?? TRELLIS_DEFAULT_CHAT_IMAGE_NOTE_SLUG;
  const note = await readNoteOrCreateIfMissing(vaultPath, targetSlug);
  const wikiRoot = path.join(vaultPath, "wiki");
  const noteAbsolutePath = ensureInsideVault(vaultPath, path.join(wikiRoot, note.relativePath));
  const rel = relativeMarkdownPathToFile(path.dirname(noteAbsolutePath), imageAbsolutePath);

  if (!rel) {
    throw new Error("Could not compute a link path for that image.");
  }

  const alt = input.alt?.trim() || "Generated image";
  const addition = `\n\n![${alt}](${rel})\n`;
  const nextContent = `${note.content.trimEnd()}${addition}`;

  return writeNoteFile(vaultPath, vaultId, {
    vaultId,
    slug: note.slug,
    relativePath: note.relativePath,
    folderPath: note.folderPath,
    title: note.title,
    content: nextContent,
    frontmatter: {
      tags: note.tags,
      type: note.type,
      sources: note.sources,
      url: note.url
    }
  });
}

interface ObsidianImportCandidate {
  content: string;
  folderPath: string;
  originalSlug: string;
  relativePath: string;
  title: string;
  frontmatter: Partial<NoteFrontmatter>;
}

interface ObsidianResolvedImportCandidate extends ObsidianImportCandidate {
  resolvedSlug: string;
  resolvedTitle: string;
}

function slugifyNoteTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled-note";
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .trim();

  return sanitized || "Untitled";
}

function normalizeFolderPath(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean)
    .join("/");
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractWikiLinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) =>
    slugifyNoteTitle(match[1] ?? "")
  );
}

function extractWikiLinkTargets(content: string): Array<{ slug: string; title: string }> {
  return [...content.matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((match) => {
      const rawTitle = match[1]?.trim() ?? "";

      return {
        slug: slugifyNoteTitle(rawTitle),
        title: rawTitle
      };
    })
    .filter(
      (target): target is { slug: string; title: string } =>
        target.slug.length > 0 && target.title.length > 0
    );
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildFrontmatter(
  title: string,
  existing: Partial<NoteFrontmatter> | undefined,
  overrides: Partial<NoteFrontmatter> | undefined
): NoteFrontmatter {
  const today = getToday();
  const nextTags = [...new Set((overrides?.tags ?? existing?.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

  return {
    title,
    created: overrides?.created ?? existing?.created ?? today,
    updated: overrides?.updated ?? today,
    sources: overrides?.sources ?? existing?.sources ?? 0,
    tags: nextTags,
    type: overrides?.type ?? existing?.type ?? "concept",
    url: overrides?.url ?? existing?.url
  };
}

function serializeNote(frontmatter: NoteFrontmatter, content: string): string {
  const yamlFrontmatter = YAML.stringify({
    title: frontmatter.title,
    created: frontmatter.created,
    updated: frontmatter.updated,
    sources: frontmatter.sources,
    tags: frontmatter.tags,
    type: frontmatter.type,
    ...(frontmatter.url ? { url: frontmatter.url } : {})
  }).trimEnd();

  return `---\n${yamlFrontmatter}\n---\n\n${content.trim()}\n`;
}

function summariseContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 160);
}

function toPosixRelative(from: string, targetPath: string): string {
  return path.relative(from, targetPath).split(path.sep).join("/");
}

async function ensureDirectory(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureVaultLayout(vaultPath: string): Promise<void> {
  await ensureDirectory(path.join(vaultPath, "wiki"));
  await ensureDirectory(path.join(vaultPath, "raw"));
}

function ensureInsideVault(vaultPath: string, targetPath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedTarget = path.resolve(targetPath);
  const relativeTarget = path.relative(resolvedVault, resolvedTarget);

  if (
    relativeTarget.startsWith("..") ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new Error("Attempted to access a path outside the configured vault.");
  }

  return resolvedTarget;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Loads a wiki note; if the file is missing (e.g. graph placeholder never materialized),
 * creates a minimal empty page so navigation and editors succeed.
 */
export async function readNoteOrCreateIfMissing(vaultPath: string, slug: string): Promise<WikiNote> {
  await ensureVaultLayout(vaultPath);
  const existingPath = await findNotePathBySlug(vaultPath, slug);
  const targetPath =
    existingPath ??
    ensureInsideVault(vaultPath, path.join(vaultPath, "wiki", `${slug}.md`));

  try {
    await fs.access(targetPath);
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
    const title = humanizeSlug(slug);
    const frontmatter = buildFrontmatter(title, undefined, {
      type: "concept",
      tags: []
    });
    await ensureDirectory(path.dirname(targetPath));
    await fs.writeFile(targetPath, serializeNote(frontmatter, ""), "utf8");
  }

  return parseNote(vaultPath, targetPath);
}

async function parseNote(vaultPath: string, filePath: string): Promise<WikiNote> {
  const file = await fs.readFile(filePath, "utf8");
  const parsed = matter(file);
  const slug = path.basename(filePath, ".md");
  const wikiRoot = path.join(vaultPath, "wiki");
  const relativePath = toPosixRelative(wikiRoot, filePath);
  const folderPath = path.posix.dirname(relativePath) === "."
    ? ""
    : path.posix.dirname(relativePath);
  const frontmatter = parsed.data as Partial<NoteFrontmatter>;
  const links = extractWikiLinks(parsed.content);

  return {
    slug,
    title: typeof frontmatter.title === "string" ? frontmatter.title : slug,
    updated:
      typeof frontmatter.updated === "string" ? frontmatter.updated : getToday(),
    tags: Array.isArray(frontmatter.tags)
      ? frontmatter.tags.filter((value): value is string => typeof value === "string")
      : [],
    type: noteTypeSchema.catch("concept").parse(frontmatter.type),
    excerpt: summariseContent(parsed.content),
    inboundCount: 0,
    folderPath,
    relativePath,
    content: parsed.content.trim(),
    links,
    sources: typeof frontmatter.sources === "number" ? frontmatter.sources : 0,
    url: typeof frontmatter.url === "string" ? frontmatter.url : undefined
  };
}

async function walkWikiTree(
  vaultPath: string,
  currentPath: string,
  relativeFolder = ""
): Promise<{ notes: WikiNote[]; folderPaths: string[] }> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const notes: WikiNote[] = [];
  const folderPaths: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      const nextFolder = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name;
      folderPaths.push(nextFolder);
      const nested = await walkWikiTree(vaultPath, entryPath, nextFolder);
      notes.push(...nested.notes);
      folderPaths.push(...nested.folderPaths);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    try {
      notes.push(await parseNote(vaultPath, entryPath));
    } catch (error) {
      console.warn(`Skipping invalid note: ${entry.name}`, error);
    }
  }

  return { notes, folderPaths };
}

async function findNotePathBySlug(vaultPath: string, slug: string): Promise<string | null> {
  const notes = await readAllNotes(vaultPath);
  const match = notes.find((note) => note.slug === slug);

  if (!match) {
    return null;
  }

  return ensureInsideVault(vaultPath, path.join(vaultPath, "wiki", match.relativePath));
}

async function ensureUniqueSlug(
  vaultPath: string,
  desiredSlug: string,
  ignoreRelativePath?: string
): Promise<string> {
  const existing = await readAllNotes(vaultPath);
  const usedSlugs = new Set(
    existing
      .filter((note) => note.relativePath !== ignoreRelativePath)
      .map((note) => note.slug)
  );

  if (!usedSlugs.has(desiredSlug)) {
    return desiredSlug;
  }

  let index = 2;
  while (usedSlugs.has(`${desiredSlug}-${index}`)) {
    index += 1;
  }

  return `${desiredSlug}-${index}`;
}

function buildFolderSummaries(notes: WikiNote[], folderPaths: string[]): FolderSummary[] {
  const uniquePaths = [...new Set(folderPaths)].sort((left, right) => left.localeCompare(right));

  return uniquePaths.map((folderPath) => ({
    path: folderPath,
    name: folderPath.split("/").at(-1) ?? folderPath,
    noteCount: notes.filter(
      (note) => note.folderPath === folderPath || note.folderPath.startsWith(`${folderPath}/`)
    ).length
  }));
}

function tagAssociationStrength(sourceTags: string[], targetTags: string[]): number {
  if (sourceTags.length === 0 && targetTags.length === 0) {
    return 0;
  }

  const left = new Set(sourceTags);
  let intersection = 0;

  for (const tag of targetTags) {
    if (left.has(tag)) {
      intersection += 1;
    }
  }

  const union = new Set([...sourceTags, ...targetTags]).size;
  return union === 0 ? 0 : intersection / union;
}

function buildGraph(notes: WikiNote[]): GraphData {
  const inbound = new Map<string, number>();
  const rawEdges: Array<{ source: string; target: string }> = [];
  const existingSlugs = new Set(notes.map((note) => note.slug));
  const placeholderTitles = new Map<string, string>();

  for (const note of notes) {
    for (const target of extractWikiLinkTargets(note.content)) {
      rawEdges.push({
        source: note.slug,
        target: target.slug
      });
      inbound.set(target.slug, (inbound.get(target.slug) ?? 0) + 1);

      if (!existingSlugs.has(target.slug) && !placeholderTitles.has(target.slug)) {
        placeholderTitles.set(target.slug, target.title);
      }
    }
  }

  const directedKeys = new Set(rawEdges.map((edge) => `${edge.source}->${edge.target}`));
  const tagsBySlug = new Map<string, string[]>(notes.map((note) => [note.slug, note.tags]));

  const edges: GraphEdge[] = [];
  const seenEdgeIds = new Set<string>();

  for (const { source, target } of rawEdges) {
    const id = `${source}->${target}`;
    if (seenEdgeIds.has(id)) {
      continue;
    }

    seenEdgeIds.add(id);

    const mutual = directedKeys.has(`${target}->${source}`);
    const tagA = tagsBySlug.get(source) ?? [];
    const tagB = tagsBySlug.get(target) ?? [];
    let association = tagAssociationStrength(tagA, tagB);
    if (mutual) {
      association = Math.min(1, association * 1.15 + 0.08);
    }

    edges.push({
      id,
      source,
      target,
      association
    });
  }

  const nodes: GraphNode[] = notes.map((note) => {
    const inboundCount = inbound.get(note.slug) ?? 0;
    return {
      id: note.slug,
      slug: note.slug,
      title: note.title,
      tags: note.tags,
      type: note.type,
      inboundCount,
      size: 10 + Math.min(inboundCount * 2, 18),
      cluster: note.tags[0],
      isPlaceholder: false
    };
  });

  for (const [slug, rawTitle] of placeholderTitles.entries()) {
    const inboundCount = inbound.get(slug) ?? 0;

    nodes.push({
      id: slug,
      slug,
      title: rawTitle || humanizeSlug(slug),
      tags: [],
      type: "concept",
      inboundCount,
      size: 8 + Math.min(inboundCount * 2, 14),
      cluster: "placeholder",
      isPlaceholder: true
    });
  }

  notes.forEach((note, index) => {
    notes[index] = {
      ...note,
      inboundCount: inbound.get(note.slug) ?? 0
    };
  });

  return { nodes, edges };
}

async function readAllNotes(vaultPath: string): Promise<WikiNote[]> {
  await ensureVaultLayout(vaultPath);
  const wikiPath = path.join(vaultPath, "wiki");
  const { notes: validNotes } = await walkWikiTree(vaultPath, wikiPath);
  buildGraph(validNotes);

  return validNotes.sort((left, right) => right.updated.localeCompare(left.updated));
}

export function resolveVault(settings: AppSettings, vaultId?: string) {
  const resolvedVault =
    settings.vaults.find((vault) => vault.id === vaultId) ??
    settings.vaults.find((vault) => vault.id === settings.activeVaultId) ??
    settings.vaults[0];

  if (!resolvedVault) {
    throw new Error("Trellis needs at least one configured vault.");
  }

  return resolvedVault;
}

export async function buildSnapshot(
  vaultPath: string,
  vaultId = "active-vault",
  vaultName = "Current Vault"
): Promise<VaultSnapshot> {
  const notes = await readAllNotes(vaultPath);
  const { folderPaths } = await walkWikiTree(vaultPath, path.join(vaultPath, "wiki"));
  const graph = buildGraph(notes);

  return {
    vaultId,
    vaultName,
    vaultPath,
    folders: buildFolderSummaries(notes, folderPaths),
    graph,
    notes: notes.map((note) => ({
      slug: note.slug,
      title: note.title,
      updated: note.updated,
      tags: note.tags,
      type: note.type,
      excerpt: note.excerpt,
      inboundCount: note.inboundCount,
      folderPath: note.folderPath,
      relativePath: note.relativePath
    }))
  };
}

async function readExistingFrontmatter(filePath: string): Promise<Partial<NoteFrontmatter> | undefined> {
  try {
    const file = await fs.readFile(filePath, "utf8");
    return matter(file).data as Partial<NoteFrontmatter>;
  } catch {
    return undefined;
  }
}

function normalizeImportedTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function normalizeImportedType(value: unknown): NoteFrontmatter["type"] | undefined {
  const parsed = noteTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function normalizeImportedDate(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function rewriteImportedLinks(
  content: string,
  titleByOriginalSlug: ReadonlyMap<string, string>
): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (fullMatch, rawTarget: string) => {
    const target = rawTarget.trim();

    if (!target || target.includes("|") || target.includes("#")) {
      return fullMatch;
    }

    const nextTitle = titleByOriginalSlug.get(slugifyNoteTitle(target));
    return nextTitle ? `[[${nextTitle}]]` : fullMatch;
  });
}

function buildImportRootFolder(sourcePath: string): string {
  const sourceName = slugifyNoteTitle(path.basename(sourcePath)) || "obsidian-vault";
  return path.posix.join("imports", `obsidian-${sourceName}`);
}

async function listObsidianMarkdownFiles(rootPath: string): Promise<string[]> {
  const resolvedRoot = path.resolve(rootPath);
  const results: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        results.push(ensureInsideVault(resolvedRoot, entryPath));
      }
    }
  }

  await walk(resolvedRoot);
  return results;
}

async function writeImportedNoteAtRelativePath(
  vaultPath: string,
  relativePath: string,
  title: string,
  content: string,
  frontmatterOverrides: Partial<NoteFrontmatter>
): Promise<void> {
  const wikiRoot = path.join(vaultPath, "wiki");
  const targetPath = ensureInsideVault(vaultPath, path.join(wikiRoot, relativePath));
  const existingFrontmatter = await readExistingFrontmatter(targetPath);
  const frontmatter = buildFrontmatter(title, existingFrontmatter, frontmatterOverrides);

  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, serializeNote(frontmatter, content), "utf8");
}

async function readObsidianImportCandidates(sourcePath: string): Promise<ObsidianImportCandidate[]> {
  const markdownFiles = await listObsidianMarkdownFiles(sourcePath);

  return Promise.all(
    markdownFiles.map(async (filePath) => {
      const file = await fs.readFile(filePath, "utf8");
      const parsed = matter(file);
      const fileName = path.basename(filePath, path.extname(filePath));
      const wikiTitle =
        typeof parsed.data.title === "string" && parsed.data.title.trim().length > 0
          ? parsed.data.title.trim()
          : humanizeFileName(fileName) || humanizeSlug(slugifyNoteTitle(fileName));
      const relativePath = toPosixRelative(path.resolve(sourcePath), filePath);
      const folderPath = path.posix.dirname(relativePath) === "."
        ? ""
        : path.posix.dirname(relativePath);
      const today = getToday();

      return {
        content: parsed.content.trim(),
        folderPath,
        originalSlug: slugifyNoteTitle(wikiTitle),
        relativePath,
        title: wikiTitle,
        frontmatter: {
          created: normalizeImportedDate(parsed.data.created, today),
          updated: normalizeImportedDate(parsed.data.updated, today),
          sources:
            typeof parsed.data.sources === "number" && Number.isFinite(parsed.data.sources)
              ? parsed.data.sources
              : 0,
          tags: normalizeImportedTags(parsed.data.tags),
          type: normalizeImportedType(parsed.data.type) ?? "concept",
          url: typeof parsed.data.url === "string" ? parsed.data.url : undefined
        }
      } satisfies ObsidianImportCandidate;
    })
  );
}

function resolveImportedTitles(
  candidates: ObsidianImportCandidate[],
  existingSlugs: Set<string>,
  sourceName: string
): {
  resolved: ObsidianResolvedImportCandidate[];
  titleByOriginalSlug: Map<string, string>;
} {
  const usedSlugs = new Set(existingSlugs);
  const originalSlugCounts = new Map<string, number>();

  for (const candidate of candidates) {
    originalSlugCounts.set(
      candidate.originalSlug,
      (originalSlugCounts.get(candidate.originalSlug) ?? 0) + 1
    );
  }

  const titleByOriginalSlug = new Map<string, string>();
  const resolved = candidates.map((candidate) => {
    let resolvedTitle = candidate.title;
    let resolvedSlug = slugifyNoteTitle(resolvedTitle);
    let suffix = 1;

    while (!resolvedSlug || usedSlugs.has(resolvedSlug)) {
      const suffixLabel = suffix === 1 ? sourceName : `${sourceName} ${suffix}`;
      resolvedTitle = `${candidate.title} (${suffixLabel})`;
      resolvedSlug = slugifyNoteTitle(resolvedTitle);
      suffix += 1;
    }

    usedSlugs.add(resolvedSlug);

    if ((originalSlugCounts.get(candidate.originalSlug) ?? 0) === 1) {
      titleByOriginalSlug.set(candidate.originalSlug, resolvedTitle);
    }

    return {
      ...candidate,
      resolvedSlug,
      resolvedTitle
    };
  });

  return {
    resolved,
    titleByOriginalSlug
  };
}

export async function importFromObsidianVault(
  vaultPath: string,
  vaultId: string,
  input: ImportFromObsidianInput
): Promise<ImportFromObsidianResult> {
  await ensureVaultLayout(vaultPath);
  const resolvedSourcePath = path.resolve(input.sourcePath);

  if (!(await pathExists(resolvedSourcePath))) {
    throw new Error("That Obsidian vault could not be found.");
  }

  const candidates = await readObsidianImportCandidates(resolvedSourcePath);

  if (candidates.length === 0) {
    throw new Error("No markdown notes were found in that Obsidian vault.");
  }

  const sourceName = sanitizePathSegment(path.basename(resolvedSourcePath) || "Obsidian");
  const existingNotes = await readAllNotes(vaultPath);
  const importRootFolder = buildImportRootFolder(resolvedSourcePath);
  const { resolved, titleByOriginalSlug } = resolveImportedTitles(
    candidates,
    new Set(existingNotes.map((note) => note.slug)),
    sourceName
  );

  for (const candidate of resolved) {
    const rewrittenContent = rewriteImportedLinks(candidate.content, titleByOriginalSlug);
    const targetRelativePath = path.posix.join(
      importRootFolder,
      candidate.folderPath,
      `${candidate.resolvedSlug}.md`
    );

    await writeImportedNoteAtRelativePath(
      vaultPath,
      targetRelativePath,
      candidate.resolvedTitle,
      rewrittenContent,
      candidate.frontmatter
    );
  }

  const notes = await readAllNotes(vaultPath);
  await rebuildVaultEmbeddings(vaultId, notes);

  return {
    sourcePath: resolvedSourcePath,
    targetPath: ensureInsideVault(vaultPath, path.join(vaultPath, "wiki", importRootFolder)),
    targetFolder: importRootFolder,
    importedNoteCount: resolved.length,
    folderCount: new Set(resolved.map((candidate) => candidate.folderPath).filter(Boolean)).size
  };
}

export async function exportToObsidianVault(
  vaultPath: string,
  input: ExportToObsidianInput,
  vaultName: string
): Promise<ExportToObsidianResult> {
  await ensureVaultLayout(vaultPath);
  const resolvedTargetPath = path.resolve(input.targetPath);

  if (!(await pathExists(resolvedTargetPath))) {
    throw new Error("That Obsidian vault could not be found.");
  }

  const wikiRoot = path.join(vaultPath, "wiki");
  const notes = await readAllNotes(vaultPath);
  const exportRootPath = path.join(
    resolvedTargetPath,
    "Trellis",
    sanitizePathSegment(vaultName)
  );

  await ensureDirectory(exportRootPath);

  for (const note of notes) {
    const sourceFilePath = ensureInsideVault(vaultPath, path.join(wikiRoot, note.relativePath));
    const targetFilePath = path.join(exportRootPath, note.relativePath);
    await ensureDirectory(path.dirname(targetFilePath));
    await fs.copyFile(sourceFilePath, targetFilePath);
  }

  return {
    targetPath: resolvedTargetPath,
    exportRootPath,
    exportedNoteCount: notes.length,
    folderCount: new Set(notes.map((note) => note.folderPath).filter(Boolean)).size
  };
}

async function removeEmptyWikiDirectories(vaultPath: string, startingDirectory: string): Promise<void> {
  const wikiRoot = path.join(vaultPath, "wiki");
  let currentPath = startingDirectory;

  while (currentPath.startsWith(wikiRoot) && currentPath !== wikiRoot) {
    const entries = await fs.readdir(currentPath);

    if (entries.length > 0) {
      break;
    }

    await fs.rmdir(currentPath);
    currentPath = path.dirname(currentPath);
  }
}

export async function writeNoteFile(
  vaultPath: string,
  vaultId: string,
  input: SaveNoteInput
): Promise<SaveNoteResult> {
  await ensureVaultLayout(vaultPath);
  const wikiRoot = path.join(vaultPath, "wiki");
  const existingPath = input.relativePath
    ? ensureInsideVault(vaultPath, path.join(wikiRoot, input.relativePath))
    : input.slug
    ? await findNotePathBySlug(vaultPath, input.slug)
    : null;
  const existingRelativePath = existingPath ? toPosixRelative(wikiRoot, existingPath) : undefined;
  const slug =
    input.slug && input.slug.length > 0
      ? input.slug
      : await ensureUniqueSlug(vaultPath, slugifyNoteTitle(input.title), existingRelativePath);
  const folderPath = normalizeFolderPath(
    input.folderPath ??
      (existingRelativePath
        ? path.posix.dirname(existingRelativePath) === "."
          ? ""
          : path.posix.dirname(existingRelativePath)
        : "")
  );
  const targetPath = ensureInsideVault(vaultPath, path.join(wikiRoot, folderPath, `${slug}.md`));
  const parsedContent = input.content.trim().startsWith("---")
    ? matter(input.content)
    : { content: input.content, data: {} };
  const existingFrontmatter = await readExistingFrontmatter(existingPath ?? targetPath);
  const frontmatter = buildFrontmatter(input.title, existingFrontmatter, {
    ...parsedContent.data,
    ...input.frontmatter
  });

  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, serializeNote(frontmatter, parsedContent.content), "utf8");

  if (existingPath && existingPath !== targetPath) {
    await fs.unlink(existingPath);
    await removeEmptyWikiDirectories(vaultPath, path.dirname(existingPath));
  }

  const note = await parseNote(vaultPath, targetPath);
  await syncNoteEmbeddings(vaultId, note);

  return {
    note,
    graph: (await buildSnapshot(vaultPath)).graph
  };
}

async function createStubNote(
  vaultPath: string,
  vaultId: string,
  input: CreateStubInput
): Promise<SaveNoteResult> {
  const title = input.title.trim();
  return writeNoteFile(vaultPath, vaultId, {
    title,
    folderPath: input.folderPath,
    content: `# ${title}\n\nThis note is ready for expansion.\n`,
    frontmatter: {
      type: "concept",
      tags: []
    }
  });
}

async function deleteNoteFile(
  vaultPath: string,
  vaultId: string,
  input: DeleteNoteInput
): Promise<VaultSnapshot> {
  await ensureVaultLayout(vaultPath);
  const wikiRoot = path.join(vaultPath, "wiki");
  const targetPath = input.relativePath
    ? ensureInsideVault(vaultPath, path.join(wikiRoot, input.relativePath))
    : await findNotePathBySlug(vaultPath, input.slug);

  if (!targetPath) {
    throw new Error("Could not find that note.");
  }

  await fs.unlink(targetPath);
  await removeEmptyWikiDirectories(vaultPath, path.dirname(targetPath));
  const snapshot = await buildSnapshot(vaultPath);
  await rebuildVaultEmbeddings(vaultId, await readAllNotes(vaultPath));
  return snapshot;
}

export async function createFolder(
  vaultPath: string,
  input: CreateFolderInput
): Promise<VaultSnapshot> {
  await ensureVaultLayout(vaultPath);
  const parentPath = normalizeFolderPath(input.parentPath);
  const folderName = sanitizePathSegment(input.name);
  const targetPath = ensureInsideVault(
    vaultPath,
    path.join(vaultPath, "wiki", parentPath, folderName)
  );
  await ensureDirectory(targetPath);
  return buildSnapshot(vaultPath);
}

async function renameFolder(
  vaultPath: string,
  input: RenameFolderInput
): Promise<VaultSnapshot> {
  await ensureVaultLayout(vaultPath);
  const sourcePath = ensureInsideVault(vaultPath, path.join(vaultPath, "wiki", input.path));
  const targetParentPath = ensureInsideVault(
    vaultPath,
    path.join(vaultPath, "wiki", normalizeFolderPath(input.parentPath))
  );
  const targetPath = ensureInsideVault(
    vaultPath,
    path.join(targetParentPath, sanitizePathSegment(input.name))
  );

  if (sourcePath === targetPath) {
    return buildSnapshot(vaultPath);
  }

  if (targetPath.startsWith(`${sourcePath}${path.sep}`)) {
    throw new Error("A folder cannot be moved inside itself.");
  }

  await ensureDirectory(path.dirname(targetPath));

  await fs.rename(sourcePath, targetPath);
  return buildSnapshot(vaultPath);
}

async function deleteFolder(
  vaultPath: string,
  vaultId: string,
  input: DeleteFolderInput
): Promise<VaultSnapshot> {
  await ensureVaultLayout(vaultPath);
  const targetPath = ensureInsideVault(vaultPath, path.join(vaultPath, "wiki", input.path));
  await fs.rm(targetPath, { recursive: true, force: true });
  const notes = await readAllNotes(vaultPath);
  await rebuildVaultEmbeddings(vaultId, notes);
  return buildSnapshot(vaultPath);
}

export function registerVaultIpc(getSettings: () => AppSettings): void {
  ipcMain.handle(ipcChannels.vaultListIndex, async (_event, vaultId: unknown) => {
    const resolvedVaultId = z.string().min(1).optional().parse(vaultId);
    const vault = resolveVault(getSettings(), resolvedVaultId);
    return buildSnapshot(vault.path, vault.id, vault.name);
  });
  ipcMain.handle(ipcChannels.vaultReadNote, async (_event, payload: unknown) => {
    const parsed = noteLookupSchema.parse(payload);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return readNoteOrCreateIfMissing(vault.path, parsed.slug);
  });
  ipcMain.handle(ipcChannels.vaultWriteNote, async (_event, input: unknown) => {
    const parsed = saveNoteSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return writeNoteFile(vault.path, vault.id, parsed);
  });
  ipcMain.handle(ipcChannels.vaultAppendChatImage, async (_event, input: unknown) => {
    const parsed = appendChatImageSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return appendChatImageToNoteForVault(vault.path, vault.id, parsed);
  });
  ipcMain.handle(ipcChannels.vaultImportNoteImage, async (_event, input: unknown) => {
    const parsed = importNoteImageSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return importNoteImageForVault(vault.path, parsed);
  });
  ipcMain.handle(ipcChannels.vaultReadNoteAssetDataUrl, async (_event, input: unknown) => {
    const parsed = readNoteAssetDataUrlSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return readNoteAssetDataUrlForVault(vault.path, parsed);
  });
  ipcMain.handle(ipcChannels.vaultCreateStub, async (_event, input: unknown) => {
    const parsed = createStubSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return createStubNote(vault.path, vault.id, parsed);
  });
  ipcMain.handle(ipcChannels.vaultDeleteNote, async (_event, input: unknown) => {
    const parsed = deleteNoteSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return deleteNoteFile(vault.path, vault.id, parsed);
  });
  ipcMain.handle(ipcChannels.vaultCreateFolder, async (_event, input: unknown) => {
    const parsed = createFolderSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return createFolder(vault.path, parsed);
  });
  ipcMain.handle(ipcChannels.vaultRenameFolder, async (_event, input: unknown) => {
    const parsed = renameFolderSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return renameFolder(vault.path, parsed);
  });
  ipcMain.handle(ipcChannels.vaultDeleteFolder, async (_event, input: unknown) => {
    const parsed = deleteFolderSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return deleteFolder(vault.path, vault.id, parsed);
  });
  ipcMain.handle(ipcChannels.vaultSelectDirectory, async (_event, payload: unknown) => {
    const parsed = selectDirectorySchema.parse(payload ?? {});
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: parsed.title ?? "Choose a folder",
      buttonLabel: parsed.buttonLabel
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return result.filePaths[0];
  });
  ipcMain.handle(ipcChannels.vaultImportFromObsidian, async (_event, input: unknown) => {
    const parsed = importFromObsidianSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return importFromObsidianVault(vault.path, vault.id, parsed);
  });
  ipcMain.handle(ipcChannels.vaultExportToObsidian, async (_event, input: unknown) => {
    const parsed = exportToObsidianSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return exportToObsidianVault(vault.path, parsed, vault.name);
  });
}

export async function saveRawSource(
  vaultPath: string,
  fileName: string,
  bytes: Uint8Array
): Promise<string> {
  await ensureVaultLayout(vaultPath);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const targetPath = ensureInsideVault(
    vaultPath,
    path.join(vaultPath, "raw", safeName)
  );
  await fs.writeFile(targetPath, bytes);
  return targetPath;
}

export {
  ensureVaultLayout,
  importNoteImageBytesForVault,
  readAllNotes,
  readNoteAssetDataUrlForVault,
  slugifyNoteTitle
};
