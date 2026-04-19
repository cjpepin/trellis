const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { providerForChatModel } = require(fromRepoRoot("shared", "chat", "providerForModel.ts"));
const {
  resolveExtractionMode,
  buildExtractionProviderIdsForOrder
} = require(fromRepoRoot("electron", "lib", "extraction", "providerOrder.ts"));
const { extractionFeatureFlagNames } = require(fromRepoRoot("shared", "extraction", "config.ts"));

test("providerForChatModel maps known vendor prefixes", () => {
  assert.equal(providerForChatModel("gpt-4.1-mini"), "openai");
  assert.equal(providerForChatModel("o3-mini"), "openai");
  assert.equal(providerForChatModel("claude-haiku-4-5"), "anthropic");
  assert.equal(providerForChatModel("trellis-ondevice-extractor"), null);
  assert.equal(providerForChatModel("e2e-stub"), null);
});

test("resolveExtractionMode follows cloud feature and session model", () => {
  const prev = process.env[extractionFeatureFlagNames.cloudExtraction];
  try {
    delete process.env[extractionFeatureFlagNames.cloudExtraction];
    assert.equal(resolveExtractionMode("gpt-4.1-mini"), "cloud");

    process.env[extractionFeatureFlagNames.cloudExtraction] = "0";
    assert.equal(resolveExtractionMode("gpt-4.1-mini"), "local");
    assert.equal(resolveExtractionMode("claude-haiku-4-5"), "local");

    process.env[extractionFeatureFlagNames.cloudExtraction] = "1";
    assert.equal(resolveExtractionMode("gpt-4.1-mini"), "cloud");
    assert.equal(resolveExtractionMode("claude-haiku-4-5"), "cloud");
    assert.equal(resolveExtractionMode("local-stub-model"), "local");
  } finally {
    if (prev === undefined) {
      delete process.env[extractionFeatureFlagNames.cloudExtraction];
    } else {
      process.env[extractionFeatureFlagNames.cloudExtraction] = prev;
    }
  }
});

test("buildExtractionProviderIdsForOrder lists cloud id before embedded when enabled", () => {
  const prevCloud = process.env[extractionFeatureFlagNames.cloudExtraction];
  const prevLocal = process.env[extractionFeatureFlagNames.localExtraction];
  try {
    process.env[extractionFeatureFlagNames.cloudExtraction] = "1";
    process.env[extractionFeatureFlagNames.localExtraction] = "1";
    assert.deepEqual(buildExtractionProviderIdsForOrder("cloud", "openai"), ["cloud-openai", "embedded"]);
    assert.deepEqual(buildExtractionProviderIdsForOrder("local", null), ["embedded"]);
  } finally {
    if (prevCloud === undefined) {
      delete process.env[extractionFeatureFlagNames.cloudExtraction];
    } else {
      process.env[extractionFeatureFlagNames.cloudExtraction] = prevCloud;
    }
    if (prevLocal === undefined) {
      delete process.env[extractionFeatureFlagNames.localExtraction];
    } else {
      process.env[extractionFeatureFlagNames.localExtraction] = prevLocal;
    }
  }
});
