import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { dialog, ipcMain } from "electron";
import YAML from "yaml";
import { z } from "zod";
import type {
  AppSettings,
  CreateStubInput,
  GraphData,
  GraphEdge,
  GraphNode,
  NoteFrontmatter,
  NoteSummary,
  SaveNoteInput,
  SaveNoteResult,
  VaultSnapshot,
  WikiNote
} from "./types";
import { ipcChannels } from "./types";

const noteTypeSchema = z.enum([
  "concept",
  "entity",
  "source-summary",
  "synthesis"
] as const);

const createStubSchema = z.object({
  title: z.string().min(1).max(120),
  vaultId: z.string().min(1).optional()
});

const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const saveNoteSchema = z.object({
  vaultId: z.string().min(1).optional(),
  slug: slugSchema.optional(),
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

function slugifyNoteTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled-note";
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

function buildFrontmatter(
  title: string,
  existing: Partial<NoteFrontmatter> | undefined,
  overrides: Partial<NoteFrontmatter> | undefined
): NoteFrontmatter {
  const today = getToday();

  return {
    title,
    created: overrides?.created ?? existing?.created ?? today,
    updated: overrides?.updated ?? today,
    sources: overrides?.sources ?? existing?.sources ?? 0,
    tags: overrides?.tags ?? existing?.tags ?? [],
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

async function ensureDirectory(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
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
async function readNoteOrCreateIfMissing(vaultPath: string, slug: string): Promise<WikiNote> {
  await ensureVaultLayout(vaultPath);
  const targetPath = ensureInsideVault(
    vaultPath,
    path.join(vaultPath, "wiki", `${slug}.md`)
  );

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
    await fs.writeFile(targetPath, serializeNote(frontmatter, ""), "utf8");
  }

  return parseNote(targetPath);
}

async function parseNote(filePath: string): Promise<WikiNote> {
  const file = await fs.readFile(filePath, "utf8");
  const parsed = matter(file);
  const slug = path.basename(filePath, ".md");
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
    content: parsed.content.trim(),
    links,
    sources: typeof frontmatter.sources === "number" ? frontmatter.sources : 0
  };
}

function buildGraph(notes: WikiNote[]): GraphData {
  const inbound = new Map<string, number>();
  const edges: GraphEdge[] = [];
  const existingSlugs = new Set(notes.map((note) => note.slug));
  const placeholderTitles = new Map<string, string>();

  for (const note of notes) {
    for (const target of extractWikiLinkTargets(note.content)) {
      edges.push({
        id: `${note.slug}->${target.slug}`,
        source: note.slug,
        target: target.slug
      });
      inbound.set(target.slug, (inbound.get(target.slug) ?? 0) + 1);

      if (!existingSlugs.has(target.slug) && !placeholderTitles.has(target.slug)) {
        placeholderTitles.set(target.slug, target.title);
      }
    }
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
  const files = await fs.readdir(wikiPath);
  const notes = await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map(async (file) => {
        try {
          return await parseNote(path.join(wikiPath, file));
        } catch (error) {
          console.warn(`Skipping invalid note: ${file}`, error);
          return null;
        }
      })
  );

  const validNotes = notes.filter((note): note is WikiNote => note !== null);
  buildGraph(validNotes);

  return validNotes.sort((left, right) => right.updated.localeCompare(left.updated));
}

function resolveVault(settings: AppSettings, vaultId?: string) {
  const resolvedVault =
    settings.vaults.find((vault) => vault.id === vaultId) ??
    settings.vaults.find((vault) => vault.id === settings.activeVaultId) ??
    settings.vaults[0];

  if (!resolvedVault) {
    throw new Error("Trellis needs at least one configured vault.");
  }

  return resolvedVault;
}

async function buildSnapshot(
  vaultPath: string,
  vaultId = "active-vault",
  vaultName = "Current Vault"
): Promise<VaultSnapshot> {
  const notes = await readAllNotes(vaultPath);
  const graph = buildGraph(notes);

  return {
    vaultId,
    vaultName,
    vaultPath,
    graph,
    notes: notes.map((note) => ({
      slug: note.slug,
      title: note.title,
      updated: note.updated,
      tags: note.tags,
      type: note.type,
      excerpt: note.excerpt,
      inboundCount: note.inboundCount
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

async function writeNoteFile(vaultPath: string, input: SaveNoteInput): Promise<SaveNoteResult> {
  await ensureVaultLayout(vaultPath);
  const slug = input.slug && input.slug.length > 0 ? input.slug : slugifyNoteTitle(input.title);
  const targetPath = ensureInsideVault(
    vaultPath,
    path.join(vaultPath, "wiki", `${slug}.md`)
  );
  const parsedContent = input.content.trim().startsWith("---")
    ? matter(input.content)
    : { content: input.content, data: {} };
  const existingFrontmatter = await readExistingFrontmatter(targetPath);
  const frontmatter = buildFrontmatter(input.title, existingFrontmatter, {
    ...parsedContent.data,
    ...input.frontmatter
  });

  await fs.writeFile(targetPath, serializeNote(frontmatter, parsedContent.content), "utf8");

  return {
    note: await parseNote(targetPath),
    graph: (await buildSnapshot(vaultPath)).graph
  };
}

async function createStubNote(vaultPath: string, input: CreateStubInput): Promise<SaveNoteResult> {
  const title = input.title.trim();
  return writeNoteFile(vaultPath, {
    title,
    content: `# ${title}\n\nThis note is ready for expansion.\n`,
    frontmatter: {
      type: "concept",
      tags: []
    }
  });
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
    return writeNoteFile(vault.path, parsed);
  });
  ipcMain.handle(ipcChannels.vaultCreateStub, async (_event, input: unknown) => {
    const parsed = createStubSchema.parse(input);
    const vault = resolveVault(getSettings(), parsed.vaultId);
    return createStubNote(vault.path, parsed);
  });
  ipcMain.handle(ipcChannels.vaultSelectDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose your Trellis vault"
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    await ensureVaultLayout(result.filePaths[0]);
    return result.filePaths[0];
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

export { buildSnapshot, ensureVaultLayout, slugifyNoteTitle };
