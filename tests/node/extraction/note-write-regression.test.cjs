/**
 * Regression tests for vault note writes from extraction: append merge, pipe tables,
 * link handling, and validation→prepare pipeline. Run via:
 *   node scripts/run-node-tests.mjs tests/node/extraction/note-write-regression.test.cjs
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { validateExtractionResponse } = require(fromRepoRoot("shared", "extraction", "validate.ts"));
const { prepareExtractionWrite } = require(fromRepoRoot("packages", "contracts", "src", "extraction", "guardrails.ts"));
const { extractKnowledgeHeuristic } = require(fromRepoRoot("shared", "extraction", "heuristicKnowledge.ts"));

const marathonIndex = [
  { slug: "12-week-marathon-plan", title: "12-Week Marathon Plan", tags: ["running"] },
  { slug: "habit-loop", title: "Habit Loop", tags: ["behavior"] }
];

test("pipeline: validated append + prepareExtractionWrite supersedes mismatched pipe tables", () => {
  const raw = {
    sessionTitle: "Marathon training",
    updates: [
      {
        operation: "append",
        targetSlug: "12-week-marathon-plan",
        targetTitle: "12-Week Marathon Plan",
        targetType: "synthesis",
        summary: "User clarified volume; schedule table refreshed.",
        body: [
          "## Updated 12-week schedule",
          "",
          "| Week | Mon | Wed |",
          "| --- | --- | --- |",
          "| 1 | Easy | Tempo |"
        ].join("\n"),
        tags: ["running"],
        links: ["Habit Loop"],
        confidence: 0.85,
        evidence: [{ kind: "transcript", ref: "chat" }]
      }
    ]
  };

  const validated = validateExtractionResponse(raw, { index: marathonIndex });
  assert.ok(validated.value);
  assert.equal(validated.value.updates.length, 1);

  const [update] = validated.value.updates;
  assert.deepEqual(update.links, []);

  const existingNote = {
    title: "12-Week Marathon Plan",
    folderPath: "",
    content: [
      "## Original calendar",
      "",
      "| Week | Mon |",
      "| --- | --- |",
      "| 1 | Run |",
      "",
      "## Notes",
      "",
      "Base building first."
    ].join("\n"),
    tags: ["running"],
    sources: 1,
    type: "synthesis"
  };

  const prepared = prepareExtractionWrite({
    update,
    existingNote,
    index: marathonIndex
  });

  assert.ok(prepared);
  assert.ok(!prepared.content.includes("| 1 | Run |"), "prior table row should be superseded");
  assert.match(prepared.content, /\| 1 \| Easy \| Tempo \|/);
  assert.match(prepared.content, /Base building first/);
  assert.ok(
    (prepared.content.match(/^\| Week \|/gm) ?? []).length <= 1,
    "single header row for the schedule table"
  );
});

test("prepareExtractionWrite does not append Connected Notes for declared links missing from body", () => {
  const index = [
    { slug: "note-a", title: "Note A", tags: ["t"] },
    { slug: "habit-loop", title: "Habit Loop", tags: [] }
  ];

  const prepared = prepareExtractionWrite({
    update: {
      operation: "append",
      targetSlug: "note-a",
      targetTitle: "Note A",
      targetType: "concept",
      summary: "More detail.",
      body: "## Follow-up\n\nConcrete next steps without wiki links in this fragment.",
      tags: ["t"],
      links: ["Habit Loop"],
      evidence: [{ kind: "transcript", ref: "chat" }],
      confidence: 0.8,
      sources: 0
    },
    existingNote: {
      title: "Note A",
      folderPath: "",
      content: "## Context\n\nEarlier context.",
      tags: ["t"],
      sources: 1,
      type: "concept"
    },
    index
  });

  assert.ok(prepared);
  assert.ok(!prepared.content.includes("## Connected Notes"), "no synthetic Connected Notes section");
});

test("validateExtractionResponse keeps only links that appear as wikilinks in the body", () => {
  const result = validateExtractionResponse(
    {
      sessionTitle: "Test",
      updates: [
        {
          targetSlug: "alpha",
          operation: "create",
          targetTitle: "Alpha Note",
          targetType: "concept",
          summary: "Summary.",
          body: "See [[Habit Loop]] for habits. No mention of Marathon Plan.",
          tags: ["t"],
          links: ["Habit Loop", "12-Week Marathon Plan"],
          confidence: 0.8,
          evidence: [{ kind: "transcript", ref: "x" }]
        }
      ]
    },
    { index: marathonIndex }
  );

  assert.ok(result.value);
  const [u] = result.value.updates;
  assert.deepEqual(u.links, ["Habit Loop"]);
  assert.match(u.body, /\[\[Habit Loop\]\]/);
});

test("validateExtractionResponse strips self-wikilinks and drops self from links", () => {
  const result = validateExtractionResponse(
    {
      sessionTitle: "Test",
      updates: [
        {
          targetSlug: "12-week-marathon-plan",
          operation: "append",
          targetTitle: "12-Week Marathon Plan",
          targetType: "synthesis",
          summary: "Tweak.",
          body: "This repeats the title: [[12-Week Marathon Plan]] for no good reason.",
          tags: ["running"],
          links: ["12-Week Marathon Plan"],
          confidence: 0.8,
          evidence: [{ kind: "transcript", ref: "x" }]
        }
      ]
    },
    { index: marathonIndex }
  );

  assert.ok(result.value);
  const [u] = result.value.updates;
  assert.deepEqual(u.links, []);
  assert.ok(!u.body.includes("[["));
  assert.match(u.body, /12-Week Marathon Plan/);
});

test("extractKnowledgeHeuristic inlines related notes instead of a Connected Notes heading", () => {
  const out = extractKnowledgeHeuristic({
    transcript: [
      { role: "user", content: "Summarize my marathon block and link related vault pages." },
      { role: "assistant", content: "Here is a structured week-by-week view." }
    ],
    index: marathonIndex
  });

  assert.ok(out.updates.length >= 1);
  const body = out.updates[0].body;
  assert.ok(!body.includes("## Connected Notes"));
  if (body.includes("[[") && marathonIndex.length > 0) {
    assert.match(body, /Related notes:/);
  }
});
