const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  buildTranscriptFindMatches,
  markdownWithTranscriptFindMark
} = require(fromRepoRoot("src", "lib", "chatTranscriptFind.ts"));

test("buildTranscriptFindMatches is case-insensitive and non-overlapping", () => {
  const messages = [
    { id: "a", content: "Hello hello" },
    { id: "b", content: "Say hello" }
  ];
  const matches = buildTranscriptFindMatches(messages, "hello");
  assert.equal(matches.length, 3);
  assert.deepEqual(matches[0], { messageId: "a", start: 0, end: 5 });
  assert.deepEqual(matches[1], { messageId: "a", start: 6, end: 11 });
  assert.deepEqual(matches[2], { messageId: "b", start: 4, end: 9 });
});

test("buildTranscriptFindMatches returns empty for blank query", () => {
  assert.equal(buildTranscriptFindMatches([{ id: "a", content: "hi" }], "   ").length, 0);
});

test("markdownWithTranscriptFindMark wraps slice and escapes HTML in the match", () => {
  const out = markdownWithTranscriptFindMark('a <x> b', { start: 2, end: 5 });
  assert.equal(
    out,
    'a <mark class="trellis-transcript-find-mark">&lt;x&gt;</mark> b'
  );
});
