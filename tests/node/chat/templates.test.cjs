const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  buildNoteContentFromTemplate,
  buildTemplateCreationPrompt,
  buildTemplateInstanceTitle,
  buildTemplateUsePrompt,
  defaultNewTemplateMarkdown,
  isTemplateNote,
  stripAssistantTemplateDraftMarkdown
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
  assert.match(prompt, /Substitute Trellis macros/);
  assert.match(prompt, /do not ask me for those/);
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
  assert.match(prompt, /\{\{date\}\}/);
});

test("template note content can seed a new editable note", () => {
  const content = buildNoteContentFromTemplate({
    title: "Daily Reflection Template",
    content: "# Daily Reflection Template\n\n## Wins\n\n## Friction"
  });

  assert.equal(content, "## Wins\n\n## Friction");
});

test("template macros expand for dated logs and titles", () => {
  const now = new Date("2026-04-11T15:30:00");
  const content = buildNoteContentFromTemplate(
    {
      title: "Daily log",
      content:
        "# Daily log\n\n" +
        "- {{iso_date}} | {{date}}\n" +
        "- New note: {{title}} (from {{template_title}})\n" +
        "- {{unknown_macro_should_stay}}\n"
    },
    { instanceTitle: "Practice block", now }
  );

  assert.match(content, /^- 2026-04-11 \| /);
  assert.match(content, /New note: Practice block \(from Daily log\)/);
  assert.match(content, /\{\{unknown_macro_should_stay\}\}/);
});

test("default new template markdown matches vault starter structure", () => {
  const md = defaultNewTemplateMarkdown("Weekly review");

  assert.match(md, /^# Weekly review\n/);
  assert.match(md, /## Prompt/);
  assert.match(md, /## Macros/);
  assert.match(md, /## Notes/);
});

test("stripAssistantTemplateDraftMarkdown removes assistant intro and footer around headings", () => {
  const raw = [
    "Absolutely — here's a **sports-specific Daily Practice Plan template** you can use:",
    "",
    "---",
    "",
    "# Daily Practice Plan",
    "",
    "**Date:**",
    "",
    "## Roster",
    "- ",
    "",
    "---",
    "",
    "If you want, I can also make this tailored to a specific sport like:",
    "- basketball",
    "- soccer"
  ].join("\n");

  const cleaned = stripAssistantTemplateDraftMarkdown(raw);

  assert.match(cleaned, /^# Daily Practice Plan\n/);
  assert.ok(!cleaned.includes("Absolutely"));
  assert.ok(!cleaned.includes("If you want, I can also"));
  assert.ok(!cleaned.includes("basketball"));
});

test("stripAssistantTemplateDraftMarkdown does not strip a middle hr when followed by another template", () => {
  const raw = [
    "# Full version",
    "",
    "## A",
    "",
    "---",
    "",
    "If you want a slightly more compact version:",
    "",
    "---",
    "",
    "# Compact version",
    "",
    "## B"
  ].join("\n");

  const cleaned = stripAssistantTemplateDraftMarkdown(raw);

  assert.ok(cleaned.includes("# Full version"));
  assert.ok(cleaned.includes("# Compact version"));
  // Middle "offer" lines stay; only the last `---` + chatter (no headings) is removed.
  assert.ok(cleaned.includes("If you want a slightly more compact"));
});
