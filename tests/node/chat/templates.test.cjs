const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  buildNoteContentFromTemplate,
  buildTemplateCreationPrompt,
  buildTemplateInstanceTitle,
  buildTemplateUsePrompt,
  defaultNewTemplateMarkdown,
  isTemplateNote
} = require(fromRepoRoot("src", "lib", "chatTemplates.ts"));
const {
  buildTemplateInstanceSlug,
  buildTemplateInstanceTitle: buildTemplateInstanceTitleShared
} = require(fromRepoRoot("shared", "chat", "templateInstance.ts"));

test("template notes are detected by normalized tag", () => {
  assert.equal(isTemplateNote({ tags: ["Template"] }), true);
  assert.equal(isTemplateNote({ tags: ["reflection"] }), false);
});

test("template use prompt creates a separate dated note target", () => {
  const prompt = buildTemplateUsePrompt("Daily Reflection Template");

  assert.match(prompt, /\[\[Daily Reflection Template\]\]/);
  assert.match(prompt, /new note titled "Daily Reflection - /);
  assert.match(prompt, /focused follow-up questions/);
});

test("template instance titles strip template suffix", () => {
  const title = buildTemplateInstanceTitle(
    "Daily Reflection Template",
    new Date("2026-04-10T12:00:00Z")
  );

  assert.match(title, /^Daily Reflection - /);
  assert.ok(!title.includes("Template -"));
});

test("template instance slug aligns with shared title date and session prefix", () => {
  const date = new Date("2026-04-10T12:00:00Z");
  const sessionId = "abcdef12-3456-7890-abcd-ef1234567890";
  const slug = buildTemplateInstanceSlug("daily-reflection-template", sessionId, date);
  const titleShared = buildTemplateInstanceTitleShared("Daily Reflection Template", date);

  assert.equal(slug, "daily-reflection-2026-04-10-abcdef12");
  assert.match(titleShared, /Apr 10, 2026/);
});

test("AI template prompt asks chat to save a reusable template note", () => {
  const prompt = buildTemplateCreationPrompt("a daily reflection");

  assert.match(prompt, /reusable Trellis template/);
  assert.match(prompt, /Trellis can save it as a reusable template note/);
});

test("template note content can seed a new editable note", () => {
  const content = buildNoteContentFromTemplate({
    title: "Daily Reflection Template",
    content: "# Daily Reflection Template\n\n## Wins\n\n## Friction"
  });

  assert.equal(content, "## Wins\n\n## Friction");
});

test("default new template markdown matches vault starter structure", () => {
  const md = defaultNewTemplateMarkdown("Weekly review");

  assert.match(md, /^# Weekly review\n/);
  assert.match(md, /## Prompt/);
  assert.match(md, /## Notes/);
});
