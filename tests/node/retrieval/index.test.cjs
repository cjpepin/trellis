const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { chunkNote } = require(fromRepoRoot("electron", "lib", "retrieval", "chunkNote.ts"));
const { searchRelevantNotes } = require(fromRepoRoot("electron", "lib", "retrieval", "index.ts"));
const database = require(fromRepoRoot("electron", "lib", "database.ts"));

test("chunkNote splits markdown into heading-aware chunks", () => {
  const chunks = chunkNote({
    slug: "habit-tracker",
    title: "Habit Tracker",
    updated: "2026-04-07",
    tags: ["product", "habit"],
    type: "entity",
    excerpt: "",
    inboundCount: 0,
    content: [
      "Intro paragraph for the note.",
      "",
      "## Decisions",
      "",
      "- Use streaks sparingly.",
      "",
      "## Next Steps",
      "",
      "- Build onboarding."
    ].join("\n"),
    links: [],
    sources: 0
  });

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].headingPath, "Habit Tracker > Overview");
  assert.equal(chunks[1].headingPath, "Habit Tracker > Decisions");
  assert.equal(chunks[2].headingPath, "Habit Tracker > Next Steps");
});

test("searchRelevantNotes includes explicit matches and ranks lexical hits without embeddings", async () => {
  const originalList = database.listNoteEmbeddings;

  database.listNoteEmbeddings = async () => [
    {
      vaultId: "vault-1",
      noteSlug: "product-strategy",
      chunkId: "0",
      noteTitle: "Product Strategy",
      noteType: "concept",
      tags: ["product"],
      headingPath: "Product Strategy > Overview",
      content: "The product strategy emphasizes retention and habit loops.",
      contentHash: "a",
      embedding: null,
      updatedAt: Date.now()
    },
    {
      vaultId: "vault-1",
      noteSlug: "api-design",
      chunkId: "0",
      noteTitle: "API Design",
      noteType: "concept",
      tags: ["backend"],
      headingPath: "API Design > Overview",
      content: "This note covers API versioning and authentication.",
      contentHash: "b",
      embedding: null,
      updatedAt: Date.now()
    }
  ];

  try {
    const results = await searchRelevantNotes({
      vaultId: "vault-1",
      query: "How should product strategy inform onboarding?",
      explicitSlugs: ["api-design"],
      limit: 6
    });

    assert.equal(results.length, 2);
    assert.equal(results[0].slug, "api-design");
    assert.equal(results[0].isExplicitMatch, true);
    assert.equal(results[1].slug, "product-strategy");
  } finally {
    database.listNoteEmbeddings = originalList;
  }
});

test("searchRelevantNotes boosts prioritySlugs when lexical match is weak", async () => {
  const originalList = database.listNoteEmbeddings;

  database.listNoteEmbeddings = async () => [
    {
      vaultId: "vault-1",
      noteSlug: "hub-note",
      chunkId: "0",
      noteTitle: "Hub Note",
      noteType: "concept",
      tags: ["x"],
      headingPath: "Hub Note > Overview",
      content: "Minimal.",
      contentHash: "a",
      embedding: null,
      updatedAt: Date.now()
    },
    {
      vaultId: "vault-1",
      noteSlug: "other-note",
      chunkId: "0",
      noteTitle: "Other Note",
      noteType: "concept",
      tags: ["y"],
      headingPath: "Other Note > Overview",
      content: "Different content here.",
      contentHash: "b",
      embedding: null,
      updatedAt: Date.now()
    }
  ];

  try {
    const results = await searchRelevantNotes({
      vaultId: "vault-1",
      query: "zzzzzz unrelated query tokens",
      explicitSlugs: [],
      prioritySlugs: ["hub-note"],
      limit: 6
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].slug, "hub-note");
  } finally {
    database.listNoteEmbeddings = originalList;
  }
});
