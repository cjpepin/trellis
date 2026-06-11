#!/usr/bin/env node
/**
 * Sync preview-seed fixture into the Trellis web demo (chat JSON + static vault).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedDir = path.join(rootDir, "fixtures/preview-seed");
const wikiSourceDir = path.join(seedDir, "bucket/wiki");
const dbSource = path.join(seedDir, "db.json");
const dbTarget = path.join(rootDir, "apps/web/src/lib/demo/seed/db.json");
const vaultTargetDir = path.join(rootDir, "apps/web/public/demo-vault/wiki");
const manifestTarget = path.join(rootDir, "apps/web/public/demo-vault/manifest.json");

function slugFromTitle(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else {
      meta[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }

  return { meta, body: match[2] };
}

function collectMarkdownFiles(dir, relativeBase = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(absolutePath, relativePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push({ relativePath, absolutePath });
    }
  }

  return files;
}

function extractWikilinks(body) {
  const links = new Set();
  const pattern = /\[\[([^\]]+)\]\]/g;
  let match = pattern.exec(body);
  while (match) {
    links.add(slugFromTitle(match[1]));
    match = pattern.exec(body);
  }
  return [...links];
}

function copyVaultAndBuildManifest() {
  fs.rmSync(vaultTargetDir, { recursive: true, force: true });
  fs.mkdirSync(vaultTargetDir, { recursive: true });

  const notes = [];
  const edges = [];
  const markdownFiles = collectMarkdownFiles(wikiSourceDir);

  for (const file of markdownFiles) {
    const raw = fs.readFileSync(file.absolutePath, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const title = String(meta.title ?? path.basename(file.relativePath, ".md"));
    const slug = slugFromTitle(title);
    const folderPath = path.dirname(file.relativePath).replace(/\\/g, "/");
    const normalizedFolder = folderPath === "." ? "wiki" : `wiki/${folderPath}`;
    const links = extractWikilinks(body);

    const targetRelative = file.relativePath.replace(/\\/g, "/");
    const targetAbsolute = path.join(vaultTargetDir, targetRelative);
    fs.mkdirSync(path.dirname(targetAbsolute), { recursive: true });
    fs.copyFileSync(file.absolutePath, targetAbsolute);

    notes.push({
      slug,
      title,
      updated: String(meta.updated ?? meta.created ?? new Date().toISOString()),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      type: String(meta.type ?? "note"),
      excerpt: body.trim().split(/\r?\n/).find((line) => line.trim().length > 0)?.slice(0, 160) ?? "",
      inboundCount: Number(meta.sources ?? 0),
      folderPath: normalizedFolder,
      relativePath: `wiki/${targetRelative}`,
      links,
      vaultPath: targetRelative,
    });

    for (const target of links) {
      edges.push({ id: `${slug}->${target}`, source: slug, target });
    }
  }

  const inboundCounts = new Map(notes.map((note) => [note.slug, 0]));
  for (const edge of edges) {
    inboundCounts.set(edge.target, (inboundCounts.get(edge.target) ?? 0) + 1);
  }

  const enrichedNotes = notes.map((note) => ({
    ...note,
    inboundCount: inboundCounts.get(note.slug) ?? note.inboundCount,
  }));

  const folders = [...new Set(enrichedNotes.map((note) => note.folderPath))]
    .sort()
    .map((folderPath) => ({
      id: folderPath,
      name: folderPath.split("/").pop() ?? folderPath,
      path: folderPath,
    }));

  const manifest = {
    version: "trellis-web-demo-vault-v1",
    notes: enrichedNotes,
    folders,
    graph: {
      nodes: enrichedNotes.map((note) => ({
        id: note.slug,
        slug: note.slug,
        title: note.title,
        tags: note.tags,
        type: note.type,
        size: 1,
        inboundCount: note.inboundCount,
      })),
      edges,
    },
  };

  fs.writeFileSync(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { noteCount: enrichedNotes.length, edgeCount: edges.length };
}

function main() {
  if (!fs.existsSync(dbSource)) {
    throw new Error(`Missing preview seed at ${dbSource}`);
  }
  if (!fs.existsSync(wikiSourceDir)) {
    throw new Error(`Missing preview wiki vault at ${wikiSourceDir}`);
  }

  fs.mkdirSync(path.dirname(dbTarget), { recursive: true });
  fs.copyFileSync(dbSource, dbTarget);

  const { noteCount, edgeCount } = copyVaultAndBuildManifest();

  console.log(`Synced preview seed to Trellis web demo`);
  console.log(`  chat: ${path.relative(rootDir, dbTarget)}`);
  console.log(`  vault: ${path.relative(rootDir, vaultTargetDir)} (${noteCount} notes)`);
  console.log(`  manifest: ${path.relative(rootDir, manifestTarget)} (${edgeCount} edges)`);
}

main();
