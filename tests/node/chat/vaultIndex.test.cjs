const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  buildWikiNoteIndexContent,
  WIKI_NOTE_INDEX_MEMORY_TITLE
} = require(fromRepoRoot("shared", "chat", "vaultIndex.ts"));

test("buildWikiNoteIndexContent sorts by inbound count and respects maxChars", () => {
  const text = buildWikiNoteIndexContent(
    [
      {
        slug: "a",
        title: "Low links",
        tags: ["x"],
        folderPath: "",
        inboundCount: 0,
        excerpt: "alpha"
      },
      {
        slug: "b",
        title: "Hub",
        tags: ["y"],
        folderPath: "projects",
        inboundCount: 9,
        excerpt: "beta"
      }
    ],
    { maxChars: 5000 }
  );

  assert.ok(text.includes("2 wiki note"));
  assert.ok(text.indexOf("Hub") < text.indexOf("Low links"));
  assert.equal(WIKI_NOTE_INDEX_MEMORY_TITLE, "Wiki note index");
});

test("buildWikiNoteIndexContent reports omission when truncated", () => {
  const tiny = buildWikiNoteIndexContent(
    [
      {
        slug: "a",
        title: "One",
        tags: [],
        folderPath: "",
        inboundCount: 0,
        excerpt: "e"
      },
      {
        slug: "b",
        title: "Two",
        tags: [],
        folderPath: "",
        inboundCount: 0,
        excerpt: "e"
      }
    ],
    { maxChars: 50 }
  );

  assert.match(tiny, /omitted/i);
});

test("buildWikiNoteIndexContent handles empty vault", () => {
  assert.match(buildWikiNoteIndexContent([]), /no notes/i);
});
