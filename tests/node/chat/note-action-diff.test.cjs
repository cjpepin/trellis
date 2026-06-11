const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { buildMarkdownDiff } = require(fromRepoRoot("src", "lib", "noteActionDiff.ts"));

test("buildMarkdownDiff marks added and removed markdown lines", () => {
  const diff = buildMarkdownDiff(
    ["## Mood", "", "- Tired"].join("\n"),
    ["## Mood", "", "- Calm", "- Tired"].join("\n")
  );

  assert.deepEqual(
    diff.map((line) => line.kind),
    ["same", "same", "add", "same"]
  );
  assert.equal(diff[2].text, "- Calm");
});
