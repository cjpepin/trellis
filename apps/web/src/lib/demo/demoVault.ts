import type { BucketSnapshot, FolderSummary, GraphData, NoteSummary, WikiNote } from "@trellis/contracts";
import { DEMO_BUCKET_ID } from "./config";

interface DemoVaultManifestNote extends NoteSummary {
  links: string[];
  vaultPath: string;
}

interface DemoVaultManifest {
  version: string;
  notes: DemoVaultManifestNote[];
  folders: Array<{ id: string; name: string; path: string }>;
  graph: GraphData;
}

let manifestPromise: Promise<DemoVaultManifest> | null = null;

function vaultBaseUrl(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base}demo-vault/`;
}

async function loadManifest(): Promise<DemoVaultManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${vaultBaseUrl()}manifest.json`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load demo vault manifest (${response.status})`);
        }
        return response.json() as Promise<DemoVaultManifest>;
      })
      .catch(() => ({
        version: "trellis-web-demo-vault-empty",
        notes: [],
        folders: [{ id: "wiki", name: "Wiki", path: "wiki" }],
        graph: { nodes: [], edges: [] },
      }));
  }
  return manifestPromise;
}

function toFolderSummaries(
  folders: Array<{ id: string; name: string; path: string }>,
  notes: NoteSummary[],
): FolderSummary[] {
  return folders.map((folder) => ({
    path: folder.path,
    name: folder.name,
    noteCount: notes.filter((note) => note.folderPath === folder.path).length,
  }));
}

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return { meta: {}, body: content };
  }

  const meta: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value: unknown = line.slice(separator + 1).trim();
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else if (typeof value === "string") {
      value = value.replace(/^['"]|['"]$/g, "");
    }
    meta[key] = value;
  }

  return { meta, body: match[2] };
}

export async function listDemoVaultIndex(bucketId?: string): Promise<BucketSnapshot> {
  const manifest = await loadManifest();
  const notes = manifest.notes.map(({ links: _links, vaultPath: _vaultPath, ...note }) => note);
  return {
    bucketId: bucketId ?? DEMO_BUCKET_ID,
    bucketName: "Preview Vault",
    bucketPath: "preview",
    notes,
    folders: toFolderSummaries(manifest.folders, notes),
    graph: manifest.graph,
  };
}

export async function readDemoVaultNote(slug: string, bucketId?: string): Promise<WikiNote> {
  const manifest = await loadManifest();
  const note = manifest.notes.find((row) => row.slug === slug);
  if (!note) {
    throw new Error(`Note not found: ${slug}`);
  }

  const response = await fetch(`${vaultBaseUrl()}wiki/${note.vaultPath}`);
  if (!response.ok) {
    throw new Error(`Failed to load note body for ${slug}`);
  }

  const raw = await response.text();
  const { meta, body } = parseFrontmatter(raw);

  return {
    slug: note.slug,
    title: note.title,
    updated: note.updated,
    tags: note.tags,
    type: note.type,
    excerpt: note.excerpt,
    inboundCount: note.inboundCount,
    folderPath: note.folderPath,
    relativePath: note.relativePath,
    content: body.trim(),
    links: note.links,
    sources: Number(meta.sources ?? note.inboundCount ?? 0),
    url: typeof meta.url === "string" ? meta.url : undefined,
  };
}

export async function getDemoVaultManifestForBootstrap(): Promise<{
  notes: NoteSummary[];
  folders: FolderSummary[];
  graph: GraphData;
}> {
  const manifest = await loadManifest();
  const notes = manifest.notes.map(({ links: _links, vaultPath: _vaultPath, ...note }) => note);
  return {
    notes,
    folders: toFolderSummaries(manifest.folders, notes),
    graph: manifest.graph,
  };
}
