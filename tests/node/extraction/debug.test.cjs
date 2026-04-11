const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  buildRequestedProviderOrder,
  createExtractionDebugRun,
  updateExtractionDebugRun
} = require(fromRepoRoot("electron", "lib", "extraction", "debug.ts"));

test("buildRequestedProviderOrder is on-device only", () => {
  assert.deepEqual(buildRequestedProviderOrder("local"), ["embedded"]);
});

test("updateExtractionDebugRun calculates duration after a run finishes", () => {
  const run = createExtractionDebugRun({
    scope: "direct",
    mode: "local",
    transcriptMessageCount: 4
  });

  const updated = updateExtractionDebugRun(run.id, {
    status: "completed",
    startedAt: 1_000,
    finishedAt: 3_250
  });

  assert.ok(updated);
  assert.equal(updated.durationMs, 2_250);
});
