const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  buildRequestedProviderOrder,
  createExtractionDebugRun,
  updateExtractionDebugRun
} = require(fromRepoRoot("electron", "lib", "extraction", "debug.ts"));

test("buildRequestedProviderOrder prefers cloud then embedded when mode and vendor match", () => {
  assert.deepEqual(buildRequestedProviderOrder("local"), ["embedded"]);
  assert.deepEqual(buildRequestedProviderOrder("local", null), ["embedded"]);
  assert.deepEqual(buildRequestedProviderOrder("cloud", "openai"), ["cloud-openai", "embedded"]);
  assert.deepEqual(buildRequestedProviderOrder("cloud", "anthropic"), ["cloud-anthropic", "embedded"]);
});

test("createExtractionDebugRun initializes phase timings to null", () => {
  const run = createExtractionDebugRun({
    scope: "direct",
    mode: "local",
    transcriptMessageCount: 4
  });

  assert.equal(run.prepDurationMs, null);
  assert.equal(run.llmPrimaryDurationMs, null);
  assert.equal(run.llmRetryThoroughDurationMs, null);
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
