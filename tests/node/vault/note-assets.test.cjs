const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  ensureVaultLayout,
  importNoteImageBytesForVault,
  readNoteAssetDataUrlForVault
} = require(fromRepoRoot("electron", "ipc", "vault.ts"));

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("importNoteImageBytesForVault writes images inside the wiki asset folder", async (t) => {
  const workspaceRoot = createTempDir("trellis-note-assets-");
  const vaultPath = path.join(workspaceRoot, "vault");
  await ensureVaultLayout(vaultPath);

  t.after(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  const result = await importNoteImageBytesForVault(vaultPath, {
    bytes: Buffer.from("fake-png"),
    mimeType: "image/png",
    noteRelativePath: "projects/research.md",
    alt: "Diagram"
  });

  assert.equal(result.alt, "Diagram");
  assert.match(result.markdownPath, /^\.\.\/\.trellis-note-assets\/note-/);

  const absoluteImagePath = path.resolve(
    vaultPath,
    "wiki",
    "projects",
    result.markdownPath
  );
  assert.equal(absoluteImagePath.startsWith(path.join(vaultPath, "wiki")), true);
  assert.equal(fs.existsSync(absoluteImagePath), true);

  const dataUrl = await readNoteAssetDataUrlForVault(vaultPath, {
    noteRelativePath: "projects/research.md",
    assetPath: result.markdownPath
  });

  assert.equal(dataUrl, `data:image/png;base64,${Buffer.from("fake-png").toString("base64")}`);
});

test("readNoteAssetDataUrlForVault rejects traversal and non-image assets", async (t) => {
  const workspaceRoot = createTempDir("trellis-note-asset-reject-");
  const vaultPath = path.join(workspaceRoot, "vault");
  await ensureVaultLayout(vaultPath);
  fs.writeFileSync(path.join(vaultPath, "wiki", "plain.txt"), "nope", "utf8");

  t.after(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  assert.equal(
    await readNoteAssetDataUrlForVault(vaultPath, {
      noteRelativePath: "research.md",
      assetPath: "../outside.png"
    }),
    null
  );
  assert.equal(
    await readNoteAssetDataUrlForVault(vaultPath, {
      noteRelativePath: "research.md",
      assetPath: "./plain.txt"
    }),
    null
  );
});
