require("sucrase/register/ts");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  planSessionExtraction,
  resolveExtractionExecutionStrategy
} = require("../electron/lib/extraction/jobs.ts");

function createMessage(id, role, content) {
  return {
    id,
    sessionId: "session-1",
    role,
    content,
    createdAt: Date.now(),
    tokens: null
  };
}

function createCompletedJob(overrides = {}) {
  return {
    id: "job-1",
    sessionId: "session-1",
    vaultId: "vault-1",
    status: "completed",
    trigger: "idle",
    mode: "auto",
    provider: "embedded",
    model: "qwen3:4b",
    transcriptStartIndex: 0,
    transcriptEndIndex: 2,
    transcriptDigest: "digest",
    attemptCount: 1,
    appliedUpdateCount: 1,
    sessionTitle: "Strategy Notes",
    errorMessage: null,
    createdAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: Date.now(),
    ...overrides
  };
}

test("planSessionExtraction returns null when the transcript digest already ran", () => {
  const messages = [
    createMessage("1", "user", "We should focus on onboarding."),
    createMessage("2", "assistant", "I agree. Keep the first run lighter.")
  ];
  const initialPlan = planSessionExtraction(messages, null);

  assert.ok(initialPlan);

  const nextPlan = planSessionExtraction(
    messages,
    createCompletedJob({
      transcriptEndIndex: initialPlan.transcriptEndIndex,
      transcriptDigest: initialPlan.transcriptDigest
    })
  );

  assert.equal(nextPlan, null);
});

test("planSessionExtraction can force a full rerun for the same transcript", () => {
  const messages = [
    createMessage("1", "user", "We should capture the product bets."),
    createMessage("2", "assistant", "Let’s keep the extracted notes compact.")
  ];
  const initialPlan = planSessionExtraction(messages, null);

  assert.ok(initialPlan);

  const forcedPlan = planSessionExtraction(
    messages,
    createCompletedJob({
      transcriptEndIndex: initialPlan.transcriptEndIndex,
      transcriptDigest: initialPlan.transcriptDigest
    }),
    true
  );

  assert.ok(forcedPlan);
  assert.equal(forcedPlan.transcriptStartIndex, 0);
  assert.equal(forcedPlan.transcriptEndIndex, initialPlan.transcriptEndIndex);
  assert.equal(forcedPlan.transcriptDigest, initialPlan.transcriptDigest);
});

test("planSessionExtraction reprocesses the full transcript when messages were replaced", () => {
  const messages = [
    createMessage("1", "user", "We should focus on durable notes."),
    createMessage("2", "assistant", "Let’s keep the note count low."),
    createMessage("3", "user", "Actually, synthesize more aggressively."),
    createMessage("4", "assistant", "Okay, we can rebalance that.")
  ];

  const plan = planSessionExtraction(
    messages,
    createCompletedJob({
      transcriptEndIndex: 4,
      transcriptDigest: "older-digest"
    })
  );

  assert.ok(plan);
  assert.equal(plan.transcriptStartIndex, 0);
  assert.equal(plan.transcriptEndIndex, 4);
});

test("resolveExtractionExecutionStrategy prefers local first in auto mode", () => {
  const strategy = resolveExtractionExecutionStrategy("auto", [
    { id: "cloud", label: "Cloud", available: true },
    { id: "embedded", label: "On-device", available: true }
  ]);

  assert.deepEqual(strategy, {
    action: "run",
    initialMode: "local",
    fallbackMode: "cloud",
    localRetryCount: 1
  });
});

test("resolveExtractionExecutionStrategy skips unavailable local-only runs", () => {
  const strategy = resolveExtractionExecutionStrategy("local", [
    { id: "cloud", label: "Cloud", available: true },
    {
      id: "embedded",
      label: "On-device",
      available: false,
      reason: "Download the on-device note processor once to turn chats into notes on this device."
    }
  ]);

  assert.deepEqual(strategy, {
    action: "skip",
    reason: "Download the on-device note processor once to turn chats into notes on this device."
  });
});
