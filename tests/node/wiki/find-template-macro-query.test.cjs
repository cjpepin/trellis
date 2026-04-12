const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { matchTemplateMacroInTextBefore } = require(
  fromRepoRoot("shared", "chat", "templateMacros.ts")
);

test("matchTemplateMacroInTextBefore detects open {{ with empty query", () => {
  const m = matchTemplateMacroInTextBefore("Hello {{");
  assert.ok(m);
  assert.equal(m.query, "");
  assert.equal(m.fullLength, 2);
});

test("matchTemplateMacroInTextBefore captures partial token before }}", () => {
  const m = matchTemplateMacroInTextBefore("x {{iso_d");
  assert.ok(m);
  assert.equal(m.query, "iso_d");
  assert.equal(m.fullLength, "{{iso_d".length);
});

test("matchTemplateMacroInTextBefore does not match after closed }}", () => {
  assert.equal(matchTemplateMacroInTextBefore("done {{date}}"), null);
});

test("matchTemplateMacroInTextBefore does not match a lone } before }} is complete", () => {
  assert.equal(matchTemplateMacroInTextBefore("{{date}"), null);
});
