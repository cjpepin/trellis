const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { prepareExtractionWrite } = require(
  fromRepoRoot("packages", "contracts", "src", "extraction", "guardrails.ts")
);
const {
  buildAutomaticChatCaptureFallbackResponse,
  buildManualSaveFallbackResponse,
  shouldAutoCaptureStrandFromTranscript
} = require(fromRepoRoot("apps", "desktop", "electron", "lib", "extraction", "manualSaveFallback.ts"));

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
      bucketId: "vault-1"
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
  assert.match(prepared.content, /## Summary/);
  assert.ok(prepared.content.includes("Retention matters"));
  assert.ok(!prepared.content.includes("What should we optimize"));
  assert.ok(!prepared.content.includes("User:"));
  assert.ok(!prepared.content.includes("Auto-saved from Trellis chat when on-device extraction"));
});

test("fallback note title ignores model session placeholders like Brief Chat", () => {
  const response = buildManualSaveFallbackResponse({
    transcript: [
      { role: "user", content: "what's the word champ" },
      {
        role: "assistant",
        content:
          "Hey champ 😄\n\nWhat's up—are we talking about your next task, something you want to write, or just checking in?"
      }
    ],
    session: {
      id: "session-word-champ",
      title: "Word Champ",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: "gpt-4o-mini",
      messageCount: 2,
      bucketId: "vault-1"
    },
    suggestedSessionTitle: "Brief Chat",
    existingSlugs: new Set(),
    now: new Date("2026-04-11T12:00:00.000Z")
  });

  const u = response.updates[0];
  assert.ok(u);
  assert.notEqual(u.targetTitle.trim().toLowerCase(), "brief chat");
  assert.equal(u.targetTitle, "Word Champ");
});

test("automatic capture fallback also skips Brief Chat for note title", () => {
  const longAssistant = `${"Retention and habit loops. ".repeat(30)}`;
  const response = buildAutomaticChatCaptureFallbackResponse({
    transcript: [
      { role: "user", content: "What should we optimize for in the MVP?" },
      { role: "assistant", content: longAssistant }
    ],
    session: {
      id: "session-auto",
      title: "Strategy Thread",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: "gpt-4o-mini",
      messageCount: 2,
      bucketId: "vault-1"
    },
    suggestedSessionTitle: "Brief Chat",
    existingSlugs: new Set(),
    now: new Date("2026-04-11T12:00:00.000Z")
  });

  const u = response.updates[0];
  assert.ok(u);
  assert.notEqual(u.targetTitle.trim().toLowerCase(), "brief chat");
  assert.equal(u.targetTitle, "Strategy Thread");
});

test("fallback title avoids raw user-style session titles", () => {
  const response = buildManualSaveFallbackResponse({
    transcript: [
      {
        role: "user",
        content: "Can you make a volleyball rotation with serve receive options?"
      },
      {
        role: "assistant",
        content:
          "With seven players in the roles you described, you can run a 5-1 with three passers in serve receive. Here is a rotation table and when each player shifts."
      }
    ],
    session: {
      id: "session-2",
      title: "Can you make a volleyball rotation with ser…",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: "gpt-4o-mini",
      messageCount: 2,
      bucketId: "vault-1"
    },
    suggestedSessionTitle: "",
    existingSlugs: new Set(),
    now: new Date("2026-04-11T12:00:00.000Z")
  });

  const u = response.updates[0];
  assert.ok(u);
  assert.ok(!/^can you /i.test(u.targetTitle));
  assert.ok(!u.body.includes("Can you make a volleyball"));
});

test("automatic idle fallback body passes guardrails and defaults to vault root", () => {
  const longAssistant = `${"Week 1: base miles. ".repeat(25)}Add strides on Wednesdays.`;
  assert.equal(shouldAutoCaptureStrandFromTranscript([{ role: "user", content: "Plan my marathon build." }, { role: "assistant", content: longAssistant }]), true);
  assert.equal(shouldAutoCaptureStrandFromTranscript([{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello!" }]), false);

  const response = buildAutomaticChatCaptureFallbackResponse({
    transcript: [
      { role: "user", content: "Plan my marathon build." },
      { role: "assistant", content: longAssistant }
    ],
    session: {
      id: "session-3",
      title: "Marathon training program",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: "gpt-4o-mini",
      messageCount: 2,
      bucketId: "vault-1"
    },
    suggestedSessionTitle: "",
    existingSlugs: new Set(),
    now: new Date("2026-04-11T12:00:00.000Z")
  });

  assert.equal(response.updates.length, 1);
  const u = response.updates[0];
  assert.equal(u.folderPath, undefined);
  const prepared = prepareExtractionWrite({
    update: u,
    existingNote: null,
    index: []
  });
  assert.ok(prepared);
  assert.equal(prepared.folderPath, "");
  assert.ok(prepared.content.includes("Week 1"));
});
