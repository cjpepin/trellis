const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { prepareExtractionWrite } = require(
  fromRepoRoot("electron", "lib", "extraction", "guardrails.ts")
);

function createUpdate(overrides = {}) {
  return {
    operation: "append",
    targetSlug: "product-strategy",
    targetTitle: "Product Strategy",
    targetType: "concept",
    summary: "Updated product strategy guidance.",
    body: "Retention matters more than breadth.",
    tags: ["product", "strategy"],
    links: [],
    evidence: [{ kind: "transcript", ref: "chat" }],
    confidence: 0.9,
    sources: 0,
    ...overrides
  };
}

function createExistingNote(overrides = {}) {
  return {
    title: "Product Strategy",
    content: [
      "## Decisions",
      "",
      "Keep onboarding calm.",
      "",
      "## Connected Notes",
      "",
      "- [[Habit Loop]]"
    ].join("\n"),
    tags: ["strategy", "product"],
    sources: 2,
    type: "concept",
    ...overrides
  };
}

const index = [
  {
    slug: "product-strategy",
    title: "Product Strategy",
    tags: ["product"]
  },
  {
    slug: "habit-loop",
    title: "Habit Loop",
    tags: ["behavior"]
  }
];

test("prepareExtractionWrite demotes duplicate headings and normalizes links", () => {
  const prepared = prepareExtractionWrite({
    update: createUpdate({
      body: [
        "## Decisions",
        "",
        "Retention matters more than breadth.",
        "",
        "## Connected Notes",
        "",
        "- [[habit loop]]"
      ].join("\n"),
      links: ["habit loop"]
    }),
    existingNote: createExistingNote(),
    index
  });

  assert.ok(prepared);
  assert.match(prepared.content, /\*\*Decisions\*\*/);
  assert.ok(!prepared.content.includes("\n## Decisions\n\nRetention matters more than breadth."));
  assert.match(prepared.content, /\[\[Habit Loop\]\]/);
  assert.deepEqual(prepared.tags, ["product", "strategy"]);
});

test("prepareExtractionWrite strips transcript-like lines", () => {
  const prepared = prepareExtractionWrite({
    update: createUpdate({
      body: [
        "User: What should we optimize for?",
        "",
        "Assistant: Retention matters most.",
        "",
        "Retention compounds better than feature breadth over time."
      ].join("\n")
    }),
    existingNote: null,
    index
  });

  assert.ok(prepared);
  assert.ok(!prepared.content.includes("User:"));
  assert.ok(!prepared.content.includes("Assistant:"));
  assert.match(prepared.content, /Retention compounds better/);
});

test("prepareExtractionWrite rejects weak bodies after cleanup", () => {
  const prepared = prepareExtractionWrite({
    update: createUpdate({
      operation: "create",
      body: "User: okay\n\nAssistant: sounds good"
    }),
    existingNote: null,
    index
  });

  assert.equal(prepared, null);
});
