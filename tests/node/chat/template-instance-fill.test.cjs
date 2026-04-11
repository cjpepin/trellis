const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { buildDeterministicTemplateFillBody } = require(
  fromRepoRoot("electron", "lib", "chat", "templateInstanceFill.ts")
);

test("deterministic template fill appends user text without role headings", () => {
  const body = buildDeterministicTemplateFillBody(
    {
      title: "Daily Log Template",
      content:
        "# Daily Log Template\n\nDate:\n\nMood:\n\n## Notes\n\n"
    },
    [
      { role: "assistant", content: "Please tell me your mood." },
      { role: "user", content: "April 11 — pretty good, 8/10." }
    ]
  );

  assert.ok(!body.includes("### User"));
  assert.ok(!body.includes("### Assistant"));
  assert.ok(!body.includes("From this chat"));
  assert.match(body, /April 11 — pretty good/);
  assert.ok(!body.includes("Please tell me"));
});

test("deterministic template fill uses only user messages in the tail", () => {
  const body = buildDeterministicTemplateFillBody(
    { title: "T", content: "# T\n\nLine one\n" },
    [
      { role: "user", content: "First answer." },
      { role: "user", content: "Second answer." }
    ]
  );

  assert.match(body, /First answer/);
  assert.match(body, /Second answer/);
});
