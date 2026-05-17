const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  ensureBucketLayout,
  exportToObsidianVault,
  importFromObsidianVault
} = require(fromRepoRoot("apps", "desktop", "electron", "ipc", "bucket.ts"));
const {
  closeDatabase,
  initializeDatabase
} = require(fromRepoRoot("apps", "desktop", "electron", "lib", "database.ts"));

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeMarkdownNote(filePath, frontmatter, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      "---",
      `title: ${frontmatter.title}`,
      `created: ${frontmatter.created}`,
      `updated: ${frontmatter.updated}`,
      `sources: ${frontmatter.sources}`,
      `tags: [${frontmatter.tags.join(", ")}]`,
      `type: ${frontmatter.type}`,
      "---",
      "",
      content.trim(),
      ""
    ].join("\n"),
    "utf8"
  );
}

test("importFromObsidianVault keeps imported notes isolated and rewrites collided links", async (t) => {
  const workspaceRoot = createTempDir("trellis-obsidian-import-");
  const trellisVaultPath = path.join(workspaceRoot, "trellis-vault");
  const obsidianVaultPath = path.join(workspaceRoot, "Acme Obsidian");

  fs.mkdirSync(obsidianVaultPath, { recursive: true });
  await ensureBucketLayout(trellisVaultPath);
  await initializeDatabase(path.join(workspaceRoot, "db"));

  writeMarkdownNote(
    path.join(trellisVaultPath, "wiki", "product-plan.md"),
    {
      title: "Product Plan",
      created: "2026-01-02",
      updated: "2026-01-03",
      sources: 0,
      tags: [],
      type: "concept"
    },
    "Existing Trellis note."
  );
  writeMarkdownNote(
    path.join(trellisVaultPath, "wiki", "research-brief.md"),
    {
      title: "Research Brief",
      created: "2026-01-02",
      updated: "2026-01-03",
      sources: 0,
      tags: [],
      type: "concept"
    },
    "Existing research note."
  );

  fs.mkdirSync(path.join(obsidianVaultPath, ".obsidian"), { recursive: true });
  fs.writeFileSync(
    path.join(obsidianVaultPath, ".obsidian", "ignored.md"),
    "# ignore me\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(obsidianVaultPath, "Product Plan.md"),
    "# Product Plan\n\nLink to [[Research Brief]].\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(obsidianVaultPath, "Research Brief.md"),
    "# Research Brief\n\nImported research note.\n",
    "utf8"
  );

  const result = await importFromObsidianVault(trellisVaultPath, "vault-1", {
    sourcePath: obsidianVaultPath
  });

  t.after(async () => {
    await closeDatabase();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  assert.equal(result.importedNoteCount, 2);
  assert.equal(result.targetFolder, "imports/obsidian-acme-obsidian");

  const importedProductPlanPath = path.join(
    trellisVaultPath,
    "wiki",
    "imports",
    "obsidian-acme-obsidian",
    "product-plan-acme-obsidian.md"
  );
  const importedResearchBriefPath = path.join(
    trellisVaultPath,
    "wiki",
    "imports",
    "obsidian-acme-obsidian",
    "research-brief-acme-obsidian.md"
  );

  assert.equal(fs.existsSync(importedProductPlanPath), true);
  assert.equal(fs.existsSync(importedResearchBriefPath), true);
  assert.equal(
    fs.readFileSync(importedProductPlanPath, "utf8").includes(
      "[[Research Brief (Acme Obsidian)]]"
    ),
    true
  );
  assert.equal(
    fs.existsSync(path.join(trellisVaultPath, "wiki", "imports", "obsidian-acme-obsidian", ".obsidian")),
    false
  );
});

test("exportToObsidianVault copies the Trellis wiki into an Obsidian-safe folder", async (t) => {
  const workspaceRoot = createTempDir("trellis-obsidian-export-");
  const trellisVaultPath = path.join(workspaceRoot, "trellis-vault");
  const obsidianVaultPath = path.join(workspaceRoot, "obsidian-vault");

  fs.mkdirSync(obsidianVaultPath, { recursive: true });
  await ensureBucketLayout(trellisVaultPath);
  await initializeDatabase(path.join(workspaceRoot, "db"));

  writeMarkdownNote(
    path.join(trellisVaultPath, "wiki", "projects", "weekly-review.md"),
    {
      title: "Weekly Review",
      created: "2026-02-01",
      updated: "2026-02-04",
      sources: 2,
      tags: ["review"],
      type: "synthesis"
    },
    "Weekly review content."
  );

  const result = await exportToObsidianVault(
    trellisVaultPath,
    { targetPath: obsidianVaultPath },
    "Main Vault"
  );

  t.after(async () => {
    await closeDatabase();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  assert.equal(result.exportedNoteCount, 1);
  assert.equal(result.exportRootPath, path.join(obsidianVaultPath, "Trellis", "Main Vault"));

  const exportedFilePath = path.join(
    obsidianVaultPath,
    "Trellis",
    "Main Vault",
    "projects",
    "weekly-review.md"
  );
  assert.equal(fs.existsSync(exportedFilePath), true);
  assert.equal(
    fs.readFileSync(exportedFilePath, "utf8").includes("Weekly review content."),
    true
  );
});
