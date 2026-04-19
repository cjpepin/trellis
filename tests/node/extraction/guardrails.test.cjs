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

test("prepareExtractionWrite merges append sections when heading already exists", () => {
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
  assert.match(prepared.content, /^## Decisions/m);
  assert.match(prepared.content, /Retention matters more than breadth/);
  assert.ok(!prepared.content.includes("**Decisions**"));
  assert.match(prepared.content, /\[\[Habit Loop\]\]/);
  assert.equal(prepared.content.match(/## Connected Notes/g)?.length, 1);
  assert.deepEqual(prepared.tags, ["product", "strategy"]);
  assert.equal(prepared.folderPath, "");
});

test("prepareExtractionWrite replaces key-value bullets on append supersession", () => {
  const prepared = prepareExtractionWrite({
    update: createUpdate({
      body: [
        "## Schedule",
        "",
        "- Workload: 4 days/week across the training block for this cycle.",
        "",
        "## Connected Notes",
        "",
        "- [[habit loop]]"
      ].join("\n"),
      links: ["habit loop"]
    }),
    existingNote: createExistingNote({
      content: [
        "## Decisions",
        "",
        "Keep onboarding calm.",
        "",
        "## Schedule",
        "",
        "- Workload: 3 days/week across the training block for this cycle.",
        "",
        "## Connected Notes",
        "",
        "- [[Habit Loop]]"
      ].join("\n")
    }),
    index
  });

  assert.ok(prepared);
  assert.match(prepared.content, /Workload: 4 days\/week/);
  assert.ok(!prepared.content.includes("Workload: 3 days"));
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

test("prepareExtractionWrite strips conversational Summary bridges and trailing chat offers", () => {
  const prepared = prepareExtractionWrite({
    update: createUpdate({
      operation: "create",
      targetSlug: "model-modes",
      targetTitle: "Advisor vs Execution Modes",
      body: [
        "## Summary",
        "",
        "That tracks, and it's a useful distinction: Opus often wins on advisor-style planning.",
        "",
        "Here are the main reasons Claude can feel thoughtful while still feeling costly.",
        "",
        "## Key details",
        "",
        "- Execution mode favors fast iteration.",
        "",
        "If you want, tell me what you were planning and I'll give you a template you can reuse."
      ].join("\n")
    }),
    existingNote: null,
    index: []
  });

  assert.ok(prepared);
  assert.ok(!prepared.content.toLowerCase().includes("that tracks"));
  assert.ok(!prepared.content.toLowerCase().includes("here are the main reasons"));
  assert.ok(!prepared.content.toLowerCase().includes("if you want"));
  assert.match(prepared.content, /Key details/);
  assert.match(prepared.content, /Execution mode/);
});

test("prepareExtractionWrite strips conclusion and AI-polite closing paragraphs", () => {
  const body = [
    "## Key Details",
    "",
    "The approach uses a queue-based pipeline for extraction jobs.",
    "",
    "## Architecture",
    "",
    "Each job runs through a provider chain with fallback support.",
    "",
    "In conclusion, this architecture provides a robust foundation for extraction processing."
  ].join("\n");

  const prepared = prepareExtractionWrite({
    update: createUpdate({ operation: "create", body }),
    existingNote: null,
    index: []
  });

  assert.ok(prepared);
  assert.ok(!prepared.content.toLowerCase().includes("in conclusion"));
  assert.match(prepared.content, /queue-based pipeline/);
  assert.match(prepared.content, /provider chain/);
});

test("prepareExtractionWrite strips 'I hope this helps' and 'Overall' closing paragraphs", () => {
  const body = [
    "## Summary",
    "",
    "The system handles three extraction modes: local, cloud, and hybrid.",
    "",
    "## Modes",
    "",
    "Local mode uses an embedded GGUF model. Cloud mode routes to OpenAI or Anthropic.",
    "",
    "Overall, this gives you flexibility to choose the right tradeoff for your use case.",
    "",
    "I hope this helps clarify the extraction architecture."
  ].join("\n");

  const prepared = prepareExtractionWrite({
    update: createUpdate({ operation: "create", body }),
    existingNote: null,
    index: []
  });

  assert.ok(prepared);
  assert.ok(!prepared.content.toLowerCase().includes("overall, this gives"));
  assert.ok(!prepared.content.toLowerCase().includes("i hope this helps"));
  assert.match(prepared.content, /embedded GGUF/);
});

test("skipIfDuplicatePreparedExtractionContent detects duplicate normalized bodies", () => {
  const seen = new Set();
  const body =
    "## Plan\n\n- Run three times per week.\n\n## Connected Notes\n\n- [[Habit Loop]]";

  assert.equal(skipIfDuplicatePreparedExtractionContent(seen, body), false);
  assert.equal(skipIfDuplicatePreparedExtractionContent(seen, body), true);
  assert.equal(skipIfDuplicatePreparedExtractionContent(seen, `\n\n${body}\n`), true);
});
