const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { buildExtractionUserMessage } = require(
  fromRepoRoot("shared", "extraction", "buildPrompt.ts")
);
const { pickSelectedProviderId } = require(
  fromRepoRoot("electron", "lib", "extraction", "providerSelection.ts")
);

test("buildExtractionUserMessage includes related notes and transcript context", () => {
  const message = buildExtractionUserMessage({
    transcript: [
      {
        role: "user",
        content: "We decided to keep onboarding lightweight."
      }
    ],
    index: [
      {
        slug: "product-strategy",
        title: "Product Strategy",
        tags: ["product"]
      }
    ],
    relatedNotes: [
      {
        slug: "product-strategy",
        title: "Product Strategy",
        tags: ["product"],
        headingPath: "Product Strategy > Overview",
        content: "Retention matters more than feature breadth for the MVP.",
        score: 23.4
      }
    ]
  });

  assert.match(message, /## Relevant Existing Notes/);
  assert.match(message, /Title: Product Strategy/);
  assert.match(message, /We decided to keep onboarding lightweight/);
});

test("pickSelectedProviderId selects embedded when available", () => {
  const selected = pickSelectedProviderId([
    { id: "embedded", label: "On-device", available: true }
  ]);

  assert.equal(selected, "embedded");
});

test("pickSelectedProviderId returns null when the on-device provider is unavailable", () => {
  const selected = pickSelectedProviderId([
    { id: "embedded", label: "On-device", available: false, reason: "missing model" }
  ]);

  assert.equal(selected, null);
});
