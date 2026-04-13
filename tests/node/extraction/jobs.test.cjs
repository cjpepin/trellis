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

test("planSessionExtraction can reprocess the full changed transcript for background capture", () => {
  const messages = [
    createMessage("1", "user", "We should focus on durable notes."),
    createMessage("2", "assistant", "Let’s keep the note count low."),
    createMessage("3", "user", "Also make automatic capture more decisive."),
    createMessage("4", "assistant", "We should refresh the note instead of piling fragments at the end.")
  ];
  const initialPlan = planSessionExtraction(messages.slice(0, 2), null);

  assert.ok(initialPlan);

  const plan = planSessionExtraction(
    messages,
    createCompletedJob({
      transcriptEndIndex: initialPlan.transcriptEndIndex,
      transcriptDigest: initialPlan.transcriptDigest
    }),
    false,
    { fullTranscriptWhenChanged: true }
  );

  assert.ok(plan);
  assert.equal(plan.transcriptStartIndex, 0);
  assert.equal(plan.transcriptEndIndex, 4);
  assert.equal(plan.transcript.length, 4);
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

test("planSessionExtraction excludes messages consumed by template instances", () => {
  const first = createMessage(
    "11111111-1111-4111-8111-111111111111",
    "user",
    "Fill out [[Daily Log Template]]."
  );
  const answer = createMessage(
    "22222222-2222-4222-8222-222222222222",
    "user",
    "I hung out with Aidan."
  );
  const state = {
    templateSlug: "daily-log-template",
    templateTitle: "Daily Log Template",
    instanceSlug: "daily-log-2026-04-10-abcdef12",
    instanceTitle: "Daily Log - Apr 10, 2026",
    status: "active",
    sourceUserMessageIds: [first.id, answer.id],
    answerUserMessageIds: [answer.id],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const trackedAnswer = {
    ...answer,
    templateInstance: state
  };
  const followUp = createMessage(
    "33333333-3333-4333-8333-333333333333",
    "user",
    "Now let's talk about onboarding."
  );
  const reply = createMessage(
    "44444444-4444-4444-8444-444444444444",
    "assistant",
    "Onboarding should stay calm."
  );
  const templateReply = {
    ...createMessage(
      "55555555-5555-4555-8555-555555555555",
      "assistant",
      "I updated that daily log. Anything else to add?"
    ),
    templateInstance: state
  };

  const excluded = getDirectNoteActionExcludedMessageIds([
    first,
    trackedAnswer,
    templateReply,
    followUp,
    reply
  ]);
  assert.equal(excluded.has(first.id), true);
  assert.equal(excluded.has(answer.id), true);
  assert.equal(excluded.has(templateReply.id), true);
  assert.equal(excluded.has(followUp.id), false);

  const plan = planSessionExtraction([first, trackedAnswer, templateReply, followUp, reply], null);
  assert.ok(plan);
  assert.equal(plan.transcript.length, 2);
  assert.match(plan.retrievalQuery, /onboarding/);
  assert.doesNotMatch(plan.retrievalQuery, /Aidan/);
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
