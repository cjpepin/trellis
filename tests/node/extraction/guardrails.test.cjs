const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  prepareExtractionWrite,
  skipIfDuplicatePreparedExtractionContent
} = require(fromRepoRoot("electron", "lib", "extraction", "guardrails.ts"));

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
    folderPath: "",
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
  assert.equal(prepared.content.match(/## Connected Notes/g)?.length, 1);
  assert.deepEqual(prepared.tags, ["product", "strategy"]);
  assert.equal(prepared.folderPath, "");
});

test("prepareExtractionWrite inserts appends before connected notes metadata", () => {
  const prepared = prepareExtractionWrite({
    update: createUpdate({
      body: "## New Direction\n\nAutomatic extraction should refresh dense notes instead of piling updates onto the bottom."
    }),
    existingNote: createExistingNote(),
    index
  });

  assert.ok(prepared);
  const addedIndex = prepared.content.indexOf("## New Direction");
  const connectedIndex = prepared.content.indexOf("## Connected Notes");

  assert.ok(addedIndex > -1);
  assert.ok(connectedIndex > -1);
  assert.ok(addedIndex < connectedIndex);
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

test("prepareExtractionWrite strips assistant preamble from Summary and opening", () => {
  const prepared = prepareExtractionWrite({
    update: createUpdate({
      operation: "create",
      targetSlug: "marathon-plan",
      targetTitle: "Marathon Training Plan",
      body: [
        "## Summary",
        "",
        "Absolutely — here's a structured marathon training program built for someone with a decent fitness base.",
        "",
        "## Weekly structure",
        "",
        "- Base phase: easy miles before intensity."
      ].join("\n")
    }),
    existingNote: null,
    index: []
  });

  assert.ok(prepared);
  assert.ok(!prepared.content.toLowerCase().includes("absolutely"));
  assert.ok(!prepared.content.toLowerCase().includes("here's a structured"));
  assert.match(prepared.content, /Weekly structure/);
  assert.match(prepared.content, /Base phase/);
});

test("skipIfDuplicatePreparedExtractionContent detects duplicate normalized bodies", () => {
  const seen = new Set();
  const body =
    "## Plan\n\n- Run three times per week.\n\n## Connected Notes\n\n- [[Habit Loop]]";

  assert.equal(skipIfDuplicatePreparedExtractionContent(seen, body), false);
  assert.equal(skipIfDuplicatePreparedExtractionContent(seen, body), true);
  assert.equal(skipIfDuplicatePreparedExtractionContent(seen, `\n\n${body}\n`), true);
});
