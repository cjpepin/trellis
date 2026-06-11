const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { mergeThoughtsIntoGraph } = require(fromRepoRoot("src", "lib", "thoughtGraphOverlay.ts"));

test("mergeThoughtsIntoGraph links enriched thoughts to existing Strand nodes", () => {
  const base = {
    nodes: [
      {
        id: "alpha-note",
        slug: "alpha-note",
        title: "Alpha",
        tags: ["x"],
        type: "concept",
        size: 12,
        inboundCount: 1
      }
    ],
    edges: []
  };

  const thoughts = [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      bucketId: "vault-1",
      content: "Thinking about alpha",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceType: "manual",
      status: "enriched",
      backingNoteSlug: null,
      relatedThoughtIds: [],
      extractedEntities: [],
      tags: ["alpha"],
      enrichment: {
        keywords: ["alpha"],
        relatedNotes: [
          {
            slug: "alpha-note",
            title: "Alpha",
            score: 10,
            reason: "Shared topic"
          }
        ],
        relatedThoughts: [],
        temporalSignals: []
      },
      enrichmentError: null
    }
  ];

  const merged = mergeThoughtsIntoGraph(base, thoughts);

  assert.equal(merged.nodes.length, 2);
  assert.ok(merged.edges.some((edge) => edge.target === "alpha-note"));
  assert.ok(
    merged.nodes.some(
      (node) => node.graphNodeKind === "thought" && node.slug.startsWith("thought-")
    )
  );
});
