const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const matter = require("gray-matter");

const rootDir = path.join(__dirname, "..");
const seedDir = path.join(rootDir, "preview-seed");
const manifestPath = path.join(seedDir, "manifest.json");
const databasePath = path.join(seedDir, "db.json");
const wikiDir = path.join(seedDir, "vault", "wiki");
const rawDir = path.join(seedDir, "vault", "raw");

function listMarkdownFilesRecursive(rootPath) {
  const results = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(entryPath);
      }
    }
  }

  walk(rootPath);
  return results.sort();
}

function slugify(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

test("preview seed fixture is complete and internally consistent", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const database = JSON.parse(fs.readFileSync(databasePath, "utf8"));
  const wikiFiles = listMarkdownFilesRecursive(wikiDir);
  const rawFiles = fs.readdirSync(rawDir).sort();

  assert.equal(manifest.version, "preview-v2");
  assert.equal(manifest.vaultName, "Preview Vault");
  assert.equal(database.sessions.length, 18);
  assert.equal(wikiFiles.length, 42);
  assert.equal(rawFiles.length, 10);
  const rootNoteCount = wikiFiles.filter((filePath) => path.dirname(filePath) === wikiDir).length;
  const nestedNoteCount = wikiFiles.length - rootNoteCount;
  assert.equal(rootNoteCount, 11);
  assert.equal(nestedNoteCount, 31);

  const noteTitles = new Set();
  const createdDates = [];
  const sessionIds = new Set(database.sessions.map((session) => session.id));

  for (const filePath of wikiFiles) {
    const relativePath = path.relative(wikiDir, filePath);
    assert.match(relativePath, /^(?:[a-z0-9-]+\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.md$/);
    const parsed = matter(fs.readFileSync(filePath, "utf8"));
    const frontmatter = parsed.data;
    const fileName = path.basename(filePath);

    assert.equal(typeof frontmatter.title, "string");
    assert.equal(slugify(frontmatter.title), fileName.replace(/\.md$/, ""));
    assert.equal(typeof frontmatter.created, "string");
    assert.equal(typeof frontmatter.updated, "string");
    assert.equal(typeof frontmatter.sources, "number");
    assert.ok(Array.isArray(frontmatter.tags));
    assert.ok(["concept", "entity", "source-summary", "synthesis"].includes(frontmatter.type));
    noteTitles.add(frontmatter.title);
    createdDates.push(frontmatter.created);
  }

  for (const filePath of wikiFiles) {
    const parsed = matter(fs.readFileSync(filePath, "utf8"));
    const links = [...parsed.content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]);

    for (const linkTitle of links) {
      assert.ok(noteTitles.has(linkTitle), `Missing linked note for ${linkTitle}`);
    }
  }

  const sortedCreatedDates = [...createdDates].sort();
  const firstCreated = new Date(sortedCreatedDates[0]);
  const lastCreated = new Date(sortedCreatedDates.at(-1));
  const createdSpanDays = Math.round((lastCreated - firstCreated) / (24 * 60 * 60 * 1000));
  assert.ok(createdSpanDays >= 150, `Expected note history to span at least 150 days, got ${createdSpanDays}`);

  const sessionCreated = database.sessions.map((session) => session.createdAt).sort((a, b) => a - b);
  const sessionSpanDays = Math.round((sessionCreated.at(-1) - sessionCreated[0]) / (24 * 60 * 60 * 1000));
  assert.ok(sessionSpanDays >= 150, `Expected session history to span at least 150 days, got ${sessionSpanDays}`);

  for (const session of database.sessions) {
    assert.match(session.id, /^[0-9a-f-]{36}$/);
    assert.ok(session.updatedAt >= session.createdAt);
    assert.ok(typeof session.title === "string" && session.title.trim().length > 0);
    assert.ok(session.title.trim().split(/\s+/).length <= 6, `Session title too long: ${session.title}`);
  }

  for (const message of database.messages) {
    assert.match(message.id, /^[0-9a-f-]{36}$/);
    assert.ok(sessionIds.has(message.sessionId), `Message points at unknown session ${message.sessionId}`);
    assert.ok(typeof message.content === "string" && message.content.trim().length > 0);
  }
});
