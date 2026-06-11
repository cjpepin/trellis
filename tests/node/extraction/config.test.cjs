const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  cloudExtractionMaxOutputTokens,
  embeddedExtractionMaxTokensPrimary,
  embeddedExtractionMaxTokensRetry,
  extractionFeatureFlagNames,
  extractionRetryShortTranscriptMaxTurns,
  extractionThresholds,
  parseBooleanFlag
} = require(fromRepoRoot("shared", "extraction", "config.ts"));

test("parseBooleanFlag supports common rollout flag values", () => {
  assert.equal(parseBooleanFlag("1", false), true);
  assert.equal(parseBooleanFlag("true", false), true);
  assert.equal(parseBooleanFlag("on", false), true);
  assert.equal(parseBooleanFlag("0", true), false);
  assert.equal(parseBooleanFlag("false", true), false);
  assert.equal(parseBooleanFlag("off", true), false);
  assert.equal(parseBooleanFlag(undefined, true), true);
});

test("extraction config exports rollout flag names and stable thresholds", () => {
  assert.equal(
    extractionFeatureFlagNames.localExtraction,
    "TRELLIS_FEATURE_LOCAL_EXTRACTION"
  );
  assert.equal(
    extractionFeatureFlagNames.heuristicFallback,
    "TRELLIS_ENABLE_HEURISTIC_EXTRACTION_FALLBACK"
  );
  assert.equal(
    extractionFeatureFlagNames.cloudExtraction,
    "TRELLIS_FEATURE_CLOUD_EXTRACTION"
  );
  assert.equal(extractionThresholds.maxTagsPerNote, 6);
  assert.ok(
    extractionThresholds.rewriteConfidenceFloor >= 0.55 &&
      extractionThresholds.rewriteConfidenceFloor <= 0.78
  );
  assert.equal(cloudExtractionMaxOutputTokens, 3072);
  assert.equal(embeddedExtractionMaxTokensPrimary, 2048);
  assert.equal(embeddedExtractionMaxTokensRetry, 1536);
  assert.equal(extractionRetryShortTranscriptMaxTurns, 2);
});
