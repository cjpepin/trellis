const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  buildExtractionRetrievalQuery,
  computeSessionExtractionPlan,
  foldIncrementalCreatesOntoSessionAnchor,
  getDirectNoteActionExcludedMessageIds,
  planSessionExtraction,
  resolveExtractionExecutionStrategy,
  shouldRunRetryThoroughPass
} = require(fromRepoRoot("apps", "desktop", "electron", "lib", "extraction", "jobs.ts"));

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
    bucketId: "vault-1",
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

test("computeSessionExtractionPlan returns ineligible reason when fewer than two turns", () => {
  const messages = [createMessage("1", "user", "Only one turn.")];
  const { plan, ineligibleReason } = computeSessionExtractionPlan(messages, null);

  assert.equal(plan, null);
  assert.equal(ineligibleReason, "fewer_than_two_turns");
});

test("buildExtractionRetrievalQuery combines last pair with full transcript for long threads", () => {
  const transcript = [
    { role: "user", content: "early topic" },
    { role: "assistant", content: "early reply" },
    { role: "user", content: "late topic" },
    { role: "assistant", content: "late reply" }
  ];
  const query = buildExtractionRetrievalQuery(transcript);

  assert.match(query, /late topic/);
  assert.match(query, /early topic/);
  assert.match(query, /---/);
});

test("buildExtractionRetrievalQuery returns full join for two or fewer turns", () => {
  const transcript = [
    { role: "user", content: "a" },
    { role: "assistant", content: "b" }
  ];
  assert.equal(buildExtractionRetrievalQuery(transcript), "a\n\nb");
});

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

test("planSessionExtraction processes only new turns when new messages are added", () => {
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
    })
  );

  assert.ok(plan);
  // Should start at the prior job’s end index (incremental, no overlap)
  assert.equal(plan.transcriptStartIndex, initialPlan.transcriptEndIndex);
  assert.equal(plan.transcriptEndIndex, 4);
  assert.equal(plan.transcript.length, 4 - initialPlan.transcriptEndIndex);
});

test("planSessionExtraction excludes messages covered by direct note actions", () => {
  const draft = createMessage("11111111-1111-4111-8111-111111111111", "assistant", "Note draft");
  const saveRequest = createMessage(
    "22222222-2222-4222-8222-222222222222",
    "user",
    "Save that as a new wiki note"
  );
  const proposal = {
    ...createMessage("33333333-3333-4333-8333-333333333333", "assistant", "Review this diff."),
    noteActions: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        kind: "create_note",
        status: "pending",
        targetTitle: "Daily Reflection",
        targetSlug: "daily-reflection",
        targetFolderPath: "",
        beforeMarkdown: "",
        afterMarkdown: "## Mood\n\n- How did you feel?",
        frontmatter: {
          type: "concept",
          sources: 0
        },
        rationale: "Save the note we drafted.",
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
  assert.doesNotMatch(plan.retrievalQuery, /Note draft/);
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

test("resolveExtractionExecutionStrategy runs cloud when a cloud or embedded provider is available", () => {
  const strategy = resolveExtractionExecutionStrategy("cloud", [
    {
      id: "cloud-openai",
      label: "Cloud",
      available: true
    },
    { id: "embedded", label: "On-device", available: false, reason: "no gguf" }
  ]);

  assert.deepEqual(strategy, {
    action: "run",
    initialMode: "cloud",
    localRetryCount: 0
  });
});

test("resolveExtractionExecutionStrategy skips cloud when no provider is runnable", () => {
  const strategy = resolveExtractionExecutionStrategy("cloud", [
    {
      id: "cloud-openai",
      label: "Cloud",
      available: false,
      reason: "No API key"
    },
    { id: "embedded", label: "On-device", available: false, reason: "No GGUF" }
  ]);

  assert.equal(strategy.action, "skip");
  assert.match(strategy.reason ?? "", /No API key/);
});

test("foldIncrementalCreatesOntoSessionAnchor keeps a new create when only one prior strand exists but titles differ", () => {
  const response = {
    updates: [
      {
        operation: "create",
        targetSlug: "topic-b",
        targetTitle: "Topic B",
        targetType: "concept",
        summary: "x",
        body: "More on the same thread.",
        tags: [],
        links: [],
        evidence: [{ kind: "transcript", ref: "t", summary: "x" }],
        confidence: 0.8
      }
    ],
    sessionTitle: "Chat"
  };
  const noteTitleBySlug = new Map([["topic-a", "Topic A"]]);
  const folded = foldIncrementalCreatesOntoSessionAnchor(response, {
    transcriptStartIndex: 4,
    priorSessionSlugs: ["topic-a"],
    noteTitleBySlug
  });

  assert.deepEqual(folded, response);
});

test("foldIncrementalCreatesOntoSessionAnchor is a no-op when multiple session notes exist and no title matches", () => {
  const response = {
    updates: [
      {
        operation: "create",
        targetSlug: "topic-b",
        targetTitle: "Topic B",
        targetType: "concept",
        summary: "x",
        body: "Body",
        tags: [],
        links: [],
        evidence: [{ kind: "transcript", ref: "t", summary: "x" }],
        confidence: 0.8
      }
    ],
    sessionTitle: "Chat"
  };
  const folded = foldIncrementalCreatesOntoSessionAnchor(response, {
    transcriptStartIndex: 4,
    priorSessionSlugs: ["topic-a", "topic-c"],
    noteTitleBySlug: new Map([
      ["topic-a", "Topic A"],
      ["topic-c", "Topic C"]
    ])
  });

  assert.deepEqual(folded, response);
});

test("foldIncrementalCreatesOntoSessionAnchor folds title-matched creates with multiple session notes", () => {
  const noteTitleBySlug = new Map([
    ["topic-a", "Topic A"],
    ["topic-c", "Topic C"]
  ]);
  const folded = foldIncrementalCreatesOntoSessionAnchor(
    {
      updates: [
        {
          operation: "create",
          targetSlug: "topic-a-update",
          targetTitle: "Topic A",
          targetType: "concept",
          summary: "x",
          body: "More about Topic A.",
          tags: [],
          links: [],
          evidence: [{ kind: "transcript", ref: "t", summary: "x" }],
          confidence: 0.8
        }
      ],
      sessionTitle: "Chat"
    },
    {
      transcriptStartIndex: 4,
      priorSessionSlugs: ["topic-a", "topic-c"],
      noteTitleBySlug
    }
  );

  assert.equal(folded.updates[0].operation, "append");
  assert.equal(folded.updates[0].targetSlug, "topic-a");
  assert.equal(folded.updates[0].targetTitle, "Topic A");
});

test("foldIncrementalCreatesOntoSessionAnchor folds second create onto first when no prior session slugs", () => {
  const folded = foldIncrementalCreatesOntoSessionAnchor(
    {
      updates: [
        {
          operation: "create",
          targetSlug: "first-topic",
          targetTitle: "First Topic",
          targetType: "concept",
          summary: "a",
          body: "Body A",
          tags: [],
          links: [],
          evidence: [{ kind: "transcript", ref: "t", summary: "x" }],
          confidence: 0.8
        },
        {
          operation: "create",
          targetSlug: "second-topic",
          targetTitle: "Second Topic",
          targetType: "concept",
          summary: "b",
          body: "Body B",
          tags: [],
          links: [],
          evidence: [{ kind: "transcript", ref: "t", summary: "x" }],
          confidence: 0.8
        }
      ],
      sessionTitle: "Chat"
    },
    {
      transcriptStartIndex: 0,
      priorSessionSlugs: [],
      noteTitleBySlug: new Map()
    }
  );

  assert.equal(folded.updates[0].operation, "create");
  assert.equal(folded.updates[0].targetSlug, "first-topic");
  assert.equal(folded.updates[1].operation, "append");
  assert.equal(folded.updates[1].targetSlug, "first-topic");
  assert.equal(folded.updates[1].targetTitle, "First Topic");
});

test("shouldRunRetryThoroughPass is true for embedded on manual trigger", () => {
  assert.equal(
    shouldRunRetryThoroughPass({
      trigger: "manual",
      primaryProvider: "embedded",
      transcriptTurnCount: 4
    }),
    true
  );
});

test("shouldRunRetryThoroughPass is false for cloud providers", () => {
  assert.equal(
    shouldRunRetryThoroughPass({
      trigger: "manual",
      primaryProvider: "cloud-openai",
      transcriptTurnCount: 10
    }),
    false
  );
  assert.equal(
    shouldRunRetryThoroughPass({
      trigger: "session-switch",
      primaryProvider: "cloud-anthropic",
      transcriptTurnCount: 6
    }),
    false
  );
});

test("shouldRunRetryThoroughPass is false for startup trigger", () => {
  assert.equal(
    shouldRunRetryThoroughPass({
      trigger: "startup",
      primaryProvider: "embedded",
      transcriptTurnCount: 8
    }),
    false
  );
});

test("shouldRunRetryThoroughPass is false for short transcripts with embedded", () => {
  assert.equal(
    shouldRunRetryThoroughPass({
      trigger: "idle",
      primaryProvider: "embedded",
      transcriptTurnCount: 2
    }),
    false
  );
});
