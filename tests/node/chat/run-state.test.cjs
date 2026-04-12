const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  canStartChatRun,
  filterChatRunsBySessionIds,
  getRunningChatRunCount,
  maxParallelChatRuns
} = require(fromRepoRoot("src", "lib", "chatRunState.ts"));

function run(sessionId) {
  return {
    sessionId,
    assistantMessageId: null,
    startedAt: Date.now(),
    awaitingFirstToken: true
  };
}

test("chat run state enforces one active run per session", () => {
  const runs = {
    "session-a": run("session-a")
  };

  assert.deepEqual(canStartChatRun(runs, "session-a"), {
    allowed: false,
    reason: "session_running"
  });
  assert.deepEqual(canStartChatRun(runs, "session-b"), { allowed: true });
});

test("chat run state caps concurrent sessions", () => {
  const runs = Object.fromEntries(
    Array.from({ length: maxParallelChatRuns }, (_, index) => [
      `session-${index}`,
      run(`session-${index}`)
    ])
  );

  assert.equal(getRunningChatRunCount(runs), 3);
  assert.deepEqual(canStartChatRun(runs, "session-extra"), {
    allowed: false,
    reason: "limit_reached"
  });

  const { ["session-0"]: _finished, ...remaining } = runs;
  assert.deepEqual(canStartChatRun(remaining, "session-extra"), { allowed: true });
});

test("chat run state drops runs for removed sessions", () => {
  const filtered = filterChatRunsBySessionIds(
    {
      "session-a": run("session-a"),
      "session-b": run("session-b")
    },
    new Set(["session-b"])
  );

  assert.deepEqual(Object.keys(filtered), ["session-b"]);
});
