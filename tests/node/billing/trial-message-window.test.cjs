const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  TRIAL_MESSAGE_WINDOW_MS,
  effectiveTrialMessagesUsed,
  trialMessageWindowResetAtIso,
  formatTrialQuotaChatError
} = require(fromRepoRoot("shared", "billing", "trialMessageWindow.ts"));

test("effectiveTrialMessagesUsed returns zero after window elapses", () => {
  const start = new Date(Date.now() - TRIAL_MESSAGE_WINDOW_MS - 60_000).toISOString();
  assert.equal(effectiveTrialMessagesUsed(40, start), 0);
});

test("effectiveTrialMessagesUsed uses stored count inside window", () => {
  const start = new Date(Date.now() - 60_000).toISOString();
  assert.equal(effectiveTrialMessagesUsed(3, start), 3);
});

test("trialMessageWindowResetAtIso adds 24h to window start", () => {
  const start = "2026-04-12T12:00:00.000Z";
  assert.equal(trialMessageWindowResetAtIso(start), "2026-04-13T12:00:00.000Z");
});

test("formatTrialQuotaChatError mentions hours when reset is in the future", () => {
  const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const text = formatTrialQuotaChatError(future);
  assert.match(text, /about 3 hours/);
});
