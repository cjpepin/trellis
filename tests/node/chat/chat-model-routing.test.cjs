const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { inferChatComplexity } = require(fromRepoRoot("shared", "chat", "inferChatComplexity.ts"));

test("inferChatComplexity returns low for short, early-thread messages", () => {
  assert.equal(
    inferChatComplexity({
      userTextLength: 100,
      transcriptMessageCount: 3,
      hasVisionInTurn: false,
      nonImageAttachmentCount: 0
    }),
    "low"
  );
});

test("inferChatComplexity escalates with long text and deep transcripts", () => {
  assert.equal(
    inferChatComplexity({
      userTextLength: 9000,
      transcriptMessageCount: 50,
      hasVisionInTurn: true,
      nonImageAttachmentCount: 0
    }),
    "high"
  );
});
