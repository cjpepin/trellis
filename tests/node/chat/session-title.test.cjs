const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { deriveSessionTitle } = require(fromRepoRoot("shared", "chat", "deriveSessionTitle.ts"));

test("uses latest substantive user turn when the last message is trivial", () => {
  const title = deriveSessionTitle([
    { role: "user", content: "How do I tune Postgres for read-heavy workloads?" },
    { role: "assistant", content: "Here are practical steps for connection pooling and replicas." },
    { role: "user", content: "Thanks!" }
  ]);

  assert.match(title, /Postgres|Read|Pooling|Replicas|Workload/i);
});

test("combines user intent with the latest assistant reply when inferring keywords", () => {
  const title = deriveSessionTitle(
    [{ role: "user", content: "What are the tradeoffs?" }],
    {
      assistantReply:
        "Between REST and GraphQL, REST is simpler to cache; GraphQL reduces round trips but adds server complexity."
    }
  );

  assert.match(title, /Rest|Graphql|Cache|Round|Server/i);
});

test("prefers a short topic line after stripping question framing", () => {
  const title = deriveSessionTitle([
    { role: "user", content: "Can you explain how database indexing speeds up queries?" }
  ]);

  assert.equal(title.split(/\s+/).length <= 6, true);
  assert.match(title, /Database|Indexing|Queries/i);
});

test("falls back to New Conversation when there is no user content", () => {
  assert.equal(deriveSessionTitle([{ role: "assistant", content: "Hello there." }]), "New Conversation");
});
