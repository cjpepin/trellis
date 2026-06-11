const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "../../..");
const manifestPath = path.join(rootDir, "apps/web/public/demo-vault/manifest.json");

test("sync-web-demo-seed builds a multi-note demo vault manifest", () => {
  const result = spawnSync(process.execPath, ["scripts/sync-web-demo-seed.mjs"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok(Array.isArray(manifest.notes));
  assert.ok(manifest.notes.length >= 10, `expected >= 10 notes, got ${manifest.notes.length}`);
  assert.ok(Array.isArray(manifest.graph.edges));
  assert.ok(manifest.graph.edges.length >= 10);
});
