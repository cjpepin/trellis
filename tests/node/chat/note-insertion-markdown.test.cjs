const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  wantsAiRichMarkdownInstruction,
  stripLeadingMarkdownFence,
  extractMarkdownSectionExcerpt
} = require(fromRepoRoot("apps", "desktop", "electron", "lib", "chat", "noteInsertionMarkdown.ts"));

test("wantsAiRichMarkdownInstruction detects tables, formatting, and multiline asks", () => {
  assert.equal(wantsAiRichMarkdownInstruction("Update [[X]] to include hello"), false);
  assert.equal(
    wantsAiRichMarkdownInstruction("Add a **bold** status line to [[Roadmap]]"),
    true
  );
  assert.equal(wantsAiRichMarkdownInstruction("Append a table with | A | B |"), true);
  assert.equal(
    wantsAiRichMarkdownInstruction("Update [[R]] to include\n- one\n- two"),
    true
  );
});

test("stripLeadingMarkdownFence unwraps fenced markdown", () => {
  assert.equal(stripLeadingMarkdownFence("hello"), "hello");
  assert.equal(
    stripLeadingMarkdownFence("```markdown\n# Hi\n```").trim(),
    "# Hi"
  );
});

test("extractMarkdownSectionExcerpt returns heading block", () => {
  const body = ["## Alpha", "", "x", "", "## Beta", "", "y"].join("\n");
  assert.equal(extractMarkdownSectionExcerpt(body, "Beta", 500)?.includes("y"), true);
  assert.equal(extractMarkdownSectionExcerpt(body, "Gamma", 500), null);
});
