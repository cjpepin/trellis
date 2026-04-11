const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { prepareExtractionWrite } = require(
  fromRepoRoot("electron", "lib", "extraction", "guardrails.ts")
);
const { buildManualSaveFallbackResponse } = require(
  fromRepoRoot("electron", "lib", "extraction", "manualSaveFallback.ts")
);

test("manual save fallback body passes extraction guardrails", () => {
  const response = buildManualSaveFallbackResponse({
    transcript: [
      { role: "user", content: "What should we optimize for in the MVP?" },
      {
        role: "assistant",
        content:
          "Retention matters more than raw signups for an early product. Ship a tight loop before expanding surface area."
      }
    ],
    session: {
      id: "session-1",
      title: "Untitled Session",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: "gpt-4o-mini",
      messageCount: 2,
      vaultId: "vault-1"
    },
    suggestedSessionTitle: "",
    existingSlugs: new Set(),
    now: new Date("2026-04-11T12:00:00.000Z")
  });

  assert.equal(response.updates.length, 1);
  const prepared = prepareExtractionWrite({
    update: response.updates[0],
    existingNote: null,
    index: []
  });

  assert.ok(prepared);
  assert.match(prepared.content, /Overview/);
  assert.match(prepared.content, /What was asked/);
  assert.match(prepared.content, /Guidance/);
  assert.match(prepared.content, /Retention matters more/);
  assert.ok(!prepared.content.includes("### Exchange"));
});
