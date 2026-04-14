const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { messageLikelyExpectsVaultContextForChat } = require(fromRepoRoot(
  "shared",
  "chat",
  "privacyVaultIntent.ts"
));

test("messageLikelyExpectsVaultContextForChat detects wiki links and vault phrasing", () => {
  assert.equal(messageLikelyExpectsVaultContextForChat("hi"), false);
  assert.equal(messageLikelyExpectsVaultContextForChat("See [[Project Plan]] for details"), true);
  assert.equal(messageLikelyExpectsVaultContextForChat("What are my notes about?"), true);
  assert.equal(messageLikelyExpectsVaultContextForChat("Summarize my notes"), true);
  assert.equal(messageLikelyExpectsVaultContextForChat("Short vault note"), false);
  assert.equal(
    messageLikelyExpectsVaultContextForChat(
      "Compare the wiki structure to what we discussed in the meeting notes."
    ),
    true
  );
});
