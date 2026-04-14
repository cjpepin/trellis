const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { buildChatReplyContext } = require(fromRepoRoot("shared", "chat", "replyContext.ts"));
const { WIKI_NOTE_INDEX_MEMORY_TITLE } = require(fromRepoRoot("shared", "chat", "vaultIndex.ts"));

test("buildChatReplyContext keeps explicit notes and drops pure retrieval-only notes", () => {
  const result = buildChatReplyContext(
    {
      mode: "auto",
      references: [
        {
          type: "note",
          title: "Pinned topic",
          excerpt: "x",
          content: "body",
          slug: "pinned-topic",
          isExplicitMatch: true
        },
        {
          type: "note",
          title: "Semantic neighbor",
          excerpt: "y",
          content: "body2",
          slug: "semantic-neighbor",
          isExplicitMatch: false
        }
      ],
      sourceLabels: ["Saved notes"]
    },
    [],
    { activeNoteSlug: null }
  );

  assert.ok(result);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Pinned topic");
  assert.ok(result.sourceLabels.includes("Saved notes"));
});

test("buildChatReplyContext keeps active strand without explicit match", () => {
  const result = buildChatReplyContext(
    {
      mode: "auto",
      references: [
        {
          type: "note",
          title: "Open strand",
          excerpt: "x",
          content: "body",
          slug: "open-strand",
          isExplicitMatch: false
        }
      ],
      sourceLabels: ["Saved notes"]
    },
    [],
    { activeNoteSlug: "open-strand" }
  );

  assert.ok(result);
  assert.equal(result.items[0].slug, "open-strand");
});

test("buildChatReplyContext drops wiki index memory row", () => {
  const result = buildChatReplyContext(
    {
      mode: "auto",
      references: [
        {
          type: "memory",
          title: WIKI_NOTE_INDEX_MEMORY_TITLE,
          excerpt: "idx",
          content: "lots of titles"
        },
        {
          type: "memory",
          title: "Recent Chats",
          excerpt: "r",
          content: "sessions"
        }
      ],
      sourceLabels: ["Wiki index", "Private memory"]
    },
    []
  );

  assert.ok(result);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "r");
  assert.ok(!result.sourceLabels.includes("Wiki index"));
});

test("buildChatReplyContext uses memory excerpt so same-kind items do not look identical", () => {
  const result = buildChatReplyContext(
    {
      mode: "auto",
      references: [
        {
          type: "memory",
          title: "Fact",
          excerpt: "Useful fact: I use Neovim daily.",
          content: "Useful fact: I use Neovim daily.\n\nMore body."
        },
        {
          type: "memory",
          title: "Fact",
          excerpt: "Useful fact: My team is five people.",
          content: "Useful fact: My team is five people."
        }
      ],
      sourceLabels: ["Private memory"]
    },
    []
  );

  assert.ok(result);
  assert.equal(result.items.length, 2);
  assert.notEqual(result.items[0].title, result.items[1].title);
  assert.ok(result.items[0].title.includes("Neovim"));
  assert.ok(result.items[1].title.includes("five people"));
});

test("buildChatReplyContext returns undefined when nothing remains after filter", () => {
  const result = buildChatReplyContext(
    {
      mode: "auto",
      references: [
        {
          type: "memory",
          title: WIKI_NOTE_INDEX_MEMORY_TITLE,
          excerpt: "idx",
          content: "lots of titles"
        },
        {
          type: "note",
          title: "Only retrieval",
          excerpt: "y",
          content: "body",
          slug: "only-retrieval",
          isExplicitMatch: false
        }
      ],
      sourceLabels: ["Wiki index", "Saved notes"]
    },
    [],
    { activeNoteSlug: null }
  );

  assert.equal(result, undefined);
});
