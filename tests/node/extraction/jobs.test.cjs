const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  getDirectNoteActionExcludedMessageIds,
  planSessionExtraction,
  resolveExtractionExecutionStrategy
} = require(fromRepoRoot("electron", "lib", "extraction", "jobs.ts"));

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
    mode: "local",
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

test("planSessionExtraction excludes messages covered by direct note actions", () => {
  const draft = createMessage("11111111-1111-4111-8111-111111111111", "assistant", "Template draft");
  const saveRequest = createMessage(
    "22222222-2222-4222-8222-222222222222",
    "user",
    "Save it as a reusable template"
  );
  const proposal = {
    ...createMessage("33333333-3333-4333-8333-333333333333", "assistant", "Review this diff."),
    noteActions: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        kind: "create_template",
        status: "pending",
        targetTitle: "Daily Reflection Template",
        targetSlug: "daily-reflection-template",
        targetFolderPath: "templates",
        beforeMarkdown: "",
        afterMarkdown: "## Mood\n\n- How did you feel?",
        frontmatter: {
          tags: ["template"],
          type: "concept",
          sources: 0
        },
        rationale: "Save the template we drafted.",
        sourceMessageIds: [draft.id, saveRequest.id],
        createdAt: Date.now()
      }
    ]
  };
  const followUp = createMessage(
    "55555555-5555-4555-8555-555555555555",
    "user",
    "Now let's talk about onboarding."
  );
  const reply = createMessage(
    "66666666-6666-4666-8666-666666666666",
    "assistant",
    "Onboarding should stay calm."
  );

  const excluded = getDirectNoteActionExcludedMessageIds([
    draft,
    saveRequest,
    proposal,
    followUp,
    reply
  ]);
  assert.equal(excluded.has(draft.id), true);
  assert.equal(excluded.has(saveRequest.id), true);
  assert.equal(excluded.has(proposal.id), true);
  assert.equal(excluded.has(followUp.id), false);

  const plan = planSessionExtraction([draft, saveRequest, proposal, followUp, reply], null);
  assert.ok(plan);
  assert.equal(plan.transcript.length, 2);
  assert.match(plan.retrievalQuery, /onboarding/);
  assert.doesNotMatch(plan.retrievalQuery, /Template draft/);
});

test("resolveExtractionExecutionStrategy runs when embedded is available", () => {
  const strategy = resolveExtractionExecutionStrategy("local", [
    { id: "embedded", label: "On-device", available: true }
  ]);

  assert.deepEqual(strategy, {
    action: "run",
    initialMode: "local",
    localRetryCount: 1
  });
});

test("resolveExtractionExecutionStrategy skips unavailable local-only runs", () => {
  const strategy = resolveExtractionExecutionStrategy("local", [
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
