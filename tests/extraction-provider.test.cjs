require("sucrase/register/ts");

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildExtractionUserMessage } = require("../shared/extraction/buildPrompt.ts");
const { pickSelectedProviderId } = require("../electron/lib/extraction/providerSelection.ts");

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

test("pickSelectedProviderId prefers local in auto mode", () => {
  const selected = pickSelectedProviderId(
    [
      { id: "cloud", label: "Cloud", available: true },
      { id: "embedded", label: "On-device", available: true }
    ],
    "auto"
  );

  assert.equal(selected, "embedded");
});

test("pickSelectedProviderId respects forced cloud mode", () => {
  const selected = pickSelectedProviderId(
    [
      { id: "cloud", label: "Cloud", available: true },
      { id: "embedded", label: "On-device", available: true }
    ],
    "cloud"
  );

  assert.equal(selected, "cloud");
});

test("pickSelectedProviderId returns null when requested mode is unavailable", () => {
  const selected = pickSelectedProviderId(
    [
      { id: "cloud", label: "Cloud", available: false },
      { id: "embedded", label: "On-device", available: true }
    ],
    "cloud"
  );

  assert.equal(selected, null);
});
