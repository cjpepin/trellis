const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  parseExtractionResponseJson,
  validateExtractionResponse
} = require(fromRepoRoot("shared", "extraction", "validate.ts"));
const { buildExtractionUserMessage } = require(
  fromRepoRoot("shared", "extraction", "buildPrompt.ts")
);

test("normalizes legacy extraction output and merges duplicate targets", () => {
  const payload = {
    sessionTitle: "Planning Habit Tracker",
    updates: [
      {
        file: "habit-tracker.md",
        action: "create",
        title: "Habit Tracker",
        type: "entity",
        content:
          "## Summary\n\nA durable habit tracker plan with clear goals.\n\n## Connected Notes\n\n- [[Unknown Link]]",
        tags: ["Product", "product"],
        linkedTo: ["product-strategy.md"],
        confidence: "0.62",
        evidence: ["planning transcript"]
      },
      {
        targetSlug: "habit-tracker",
        operation: "append",
        targetTitle: "Habit Tracker",
        targetType: "entity",
        body: "## Next Steps\n\n- Ship onboarding for the first beta users next.",
        tags: ["roadmap"],
        links: ["Product Strategy"],
        confidence: 0.7,
        evidence: [
          {
            kind: "transcript",
            ref: "assistant-turn-2",
            summary: "Added a concrete follow-up section."
          }
        ]
      }
    ]
  };

  const result = validateExtractionResponse(payload, {
    index: [
      {
        slug: "product-strategy",
        title: "Product Strategy",
        tags: ["product"]
      }
    ]
  });

  assert.ok(result.value);
  assert.equal(result.value.updates.length, 1);

  const [update] = result.value.updates;

  assert.equal(update.targetSlug, "habit-tracker");
  assert.equal(update.operation, "create");
  assert.deepEqual(update.links, ["Product Strategy"]);
  assert.match(update.body, /\[\[Product Strategy\]\]/);
  assert.ok(!update.body.includes("[[Unknown Link]]"));
  assert.deepEqual(update.tags, ["product", "roadmap"]);
});

test("downgrades low-confidence rewrite attempts to append for existing notes", () => {
  const result = validateExtractionResponse(
    {
      sessionTitle: "API Notes",
      updates: [
        {
          targetSlug: "api-design",
          operation: "rewrite",
          targetTitle: "API Design",
          targetType: "concept",
          summary: "Refines the existing API design note.",
          body: "## Revised Direction\n\nThe API should stay resource-oriented with one stable auth layer.",
          confidence: 0.42,
          evidence: [{ kind: "transcript", ref: "turn-3" }]
        }
      ]
    },
    {
      index: [
        {
          slug: "api-design",
          title: "API Design",
          tags: ["backend"]
        }
      ]
    }
  );

  assert.ok(result.value);
  assert.equal(result.value.updates[0].operation, "append");
});

test("rejects malformed top-level payloads", () => {
  const result = validateExtractionResponse({
    sessionTitle: "Broken Payload"
  });

  assert.equal(result.value, null);
  assert.equal(result.issues[0].path, "updates");
});

test("returns null for invalid JSON responses", () => {
  const result = parseExtractionResponseJson("{not-json}");

  assert.equal(result.value, null);
  assert.equal(result.issues[0].message, "Extraction payload was not valid JSON.");
});

test("extraction prompt marks template notes distinctly", () => {
  const message = buildExtractionUserMessage({
    transcript: [{ role: "user", content: "Use my daily reflection template." }],
    index: [
      {
        slug: "daily-reflection-template",
        title: "Daily Reflection Template",
        tags: ["template"],
        isTemplate: true
      }
    ]
  });

  assert.match(message, /Daily Reflection Template/);
  assert.match(message, /\{template\}/);
});
