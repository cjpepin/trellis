const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { scoreVaultNoteAgainstExtractionQuery } = require(
  fromRepoRoot("electron", "lib", "extraction", "relatedNotesLexical.ts")
);

function note(overrides) {
  return {
    slug: "default-slug",
    title: "Default",
    updated: "2024-01-01",
    tags: [],
    type: "concept",
    excerpt: "",
    inboundCount: 0,
    folderPath: "",
    relativePath: "wiki/default.md",
    ...overrides
  };
}

test("scoreVaultNoteAgainstExtractionQuery boosts title phrase in query", () => {
  const q = "Please update my running schedule for next week";
  const s = scoreVaultNoteAgainstExtractionQuery(
    note({ slug: "running-schedule", title: "Running Schedule" }),
    q
  );
  assert.ok(s >= 8);
});

test("scoreVaultNoteAgainstExtractionQuery is low when topic unrelated", () => {
  const q = "Only discussing bench press programming";
  const s = scoreVaultNoteAgainstExtractionQuery(
    note({ slug: "running-schedule", title: "Running Schedule" }),
    q
  );
  assert.ok(s < 8);
});

test("scoreVaultNoteAgainstExtractionQuery matches slug tokens in query", () => {
  const q = "Change the swimming plan";
  const s = scoreVaultNoteAgainstExtractionQuery(
    note({ slug: "swimming-plan", title: "Other Title" }),
    q
  );
  assert.ok(s >= 8);
});
