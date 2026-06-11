const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { getChatModelMediaCapabilities } = require(fromRepoRoot("shared", "chat", "capabilities.ts"));

test("GPT-4o exposes vision and image generation", () => {
  const caps = getChatModelMediaCapabilities("gpt-4o");
  assert.equal(caps.visionInput, true);
  assert.equal(caps.imageGeneration, true);
  assert.equal(caps.speechToText, true);
});

test("GPT-4.1 Mini has no vision input", () => {
  const caps = getChatModelMediaCapabilities("gpt-4.1-mini");
  assert.equal(caps.visionInput, false);
});

test("unknown models fall back to conservative capabilities", () => {
  const caps = getChatModelMediaCapabilities("future-model-stub");
  assert.equal(caps.visionInput, false);
  assert.equal(caps.imageGeneration, false);
});
