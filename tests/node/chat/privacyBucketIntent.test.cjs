const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { messageLikelyExpectsBucketContextForChat } = require(fromRepoRoot(
  "shared",
  "chat",
  "privacyBucketIntent.ts"
));

test("messageLikelyExpectsBucketContextForChat detects wiki links and bucket phrasing", () => {
  assert.equal(messageLikelyExpectsBucketContextForChat("hi"), false);
  assert.equal(messageLikelyExpectsBucketContextForChat("See [[Project Plan]] for details"), true);
  assert.equal(messageLikelyExpectsBucketContextForChat("What are my notes about?"), true);
  assert.equal(messageLikelyExpectsBucketContextForChat("Summarize my notes"), true);
  assert.equal(messageLikelyExpectsBucketContextForChat("Short vault note"), false);
  assert.equal(
    messageLikelyExpectsBucketContextForChat(
      "Compare the wiki structure to what we discussed in the meeting notes."
    ),
    true
  );
});
