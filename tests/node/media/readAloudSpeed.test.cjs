const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  normalizeReadAloudSpeedTier,
  readAloudSpeedTierToOpenAiSpeed,
  READ_ALOUD_SPEED_DEFAULT_TIER
} = require(fromRepoRoot("shared", "media", "readAloudSpeed.ts"));

test("normalizeReadAloudSpeedTier defaults unknown values to tier 3 (Medium)", () => {
  assert.equal(normalizeReadAloudSpeedTier(undefined), READ_ALOUD_SPEED_DEFAULT_TIER);
  assert.equal(normalizeReadAloudSpeedTier(null), READ_ALOUD_SPEED_DEFAULT_TIER);
  assert.equal(normalizeReadAloudSpeedTier("3"), READ_ALOUD_SPEED_DEFAULT_TIER);
});

test("normalizeReadAloudSpeedTier accepts tiers 1–5", () => {
  assert.equal(normalizeReadAloudSpeedTier(1), 1);
  assert.equal(normalizeReadAloudSpeedTier(2), 2);
  assert.equal(normalizeReadAloudSpeedTier(3), 3);
  assert.equal(normalizeReadAloudSpeedTier(4), 4);
  assert.equal(normalizeReadAloudSpeedTier(5), 5);
});

test("readAloudSpeedTierToOpenAiSpeed maps tiers to OpenAI speed values", () => {
  assert.equal(readAloudSpeedTierToOpenAiSpeed(1), 0.5);
  assert.equal(readAloudSpeedTierToOpenAiSpeed(2), 0.75);
  assert.equal(readAloudSpeedTierToOpenAiSpeed(3), 1);
  assert.equal(readAloudSpeedTierToOpenAiSpeed(4), 1.5);
  assert.equal(readAloudSpeedTierToOpenAiSpeed(5), 2);
});

test("each tier maps to a distinct OpenAI speed where applicable", () => {
  const speeds = [1, 2, 3, 4, 5].map((tier) => readAloudSpeedTierToOpenAiSpeed(tier));
  assert.equal(new Set(speeds).size, speeds.length);
});
