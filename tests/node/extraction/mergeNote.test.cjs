const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  applyMerge,
  containsGfmPipeTable,
  mergeBulletLists,
  normalizeHeadingForMatch,
  parseNoteSections,
  reconcileNoteContent,
  renderNoteSections,
  splitConnectedNotesFromBody,
  stripGfmPipeTables
} = require(fromRepoRoot("electron", "lib", "extraction", "mergeNote.ts"));

test("parseNoteSections round-trips simple headings", () => {
  const md = ["Intro line", "", "## One", "", "Body one", "", "### Two", "", "Nested"].join("\n");
  const sections = parseNoteSections(md);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].heading, null);
  assert.match(sections[1].heading, /^## One/);
  assert.match(sections[2].heading, /^### Two/);
  assert.equal(renderNoteSections(sections).includes("Intro line"), true);
});

test("applyMerge replaces section body and preserves Connected Notes", () => {
  const existing = [
    "## Plan",
    "",
    "Old plan text.",
    "",
    "## Connected Notes",
    "",
    "- [[Other]]"
  ].join("\n");

  const { content, appliedHeadings, skippedHeadings } = applyMerge(
    existing,
    [{ heading: "## Plan", body: "New plan text.", mode: "replace" }],
    undefined
  );

  assert.deepEqual(appliedHeadings, ["## Plan"]);
  assert.deepEqual(skippedHeadings, []);
  assert.match(content, /New plan text/);
  assert.ok(!content.includes("Old plan text"));
  assert.match(content, /## Connected Notes/);
  assert.match(content, /\[\[Other\]\]/);
});

test("applyMerge puts skipped patch headings into residual before Connected Notes", () => {
  const existing = ["## A", "", "a"].join("\n");
  const { content, skippedHeadings } = applyMerge(
    existing,
    [{ heading: "## Missing", body: "x", mode: "replace" }],
    undefined
  );
  assert.deepEqual(skippedHeadings, ["## Missing"]);
  assert.match(content, /Missing/);
  assert.match(content, /## A/);
});

test("mergeBulletLists replaces value for matching key", () => {
  const merged = mergeBulletLists("- Workload: 3 days/week", "- Workload: 4 days/week");
  assert.match(merged, /4 days/);
  assert.ok(!merged.includes("3 days"));
});

test("normalizeHeadingForMatch ignores case and hashes", () => {
  assert.equal(normalizeHeadingForMatch("##  Foo Bar "), normalizeHeadingForMatch("foo bar"));
});

test("splitConnectedNotesFromBody separates main and suffix", () => {
  const { main, connectedSuffix } = splitConnectedNotesFromBody(
    "x\n\n## Connected Notes\n\n- [[N]]"
  );
  assert.equal(main.trim(), "x");
  assert.match(connectedSuffix, /Connected Notes/);
});

test("reconcileNoteContent collapses duplicate kv bullets keeping last", () => {
  const out = reconcileNoteContent(["## S", "", "- k: 1", "- k: 2"].join("\n"));
  assert.ok(!out.includes("k: 1"));
  assert.match(out, /k: 2/);
});

test("containsGfmPipeTable and stripGfmPipeTables detect/remove pipe tables", () => {
  const md = ["## T", "", "| Week | Run |", "| --- | --- |", "| 1 | easy |"].join("\n");
  assert.equal(containsGfmPipeTable(md), true);
  assert.equal(containsGfmPipeTable("## T\n\nJust text."), false);
  const stripped = stripGfmPipeTables(md);
  assert.ok(!stripped.includes("| Week |"));
  assert.match(stripped, /## T/);
});
