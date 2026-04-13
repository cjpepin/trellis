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

test("template instance titles expand date macros without appending a second date", () => {
  const date = new Date("2026-04-10T12:00:00");
  const title = buildTemplateInstanceTitleShared("Daily Log - {{date}} Template", date);
  const slug = buildTemplateInstanceSlug("daily-log-date-template", "abcdef12-3456-7890-abcd-ef1234567890", date);

  assert.match(title, /^Daily Log - /);
  assert.match(title, /2026|Apr/);
  assert.ok(!title.includes("{{date}}"));
  assert.doesNotMatch(title, /Template/);
  assert.doesNotMatch(title, /Apr 10, 2026 - Apr 10, 2026/);
  assert.equal(slug, "daily-log-2026-04-10-abcdef12");
});

test("AI template prompt asks chat to draft a reusable template note", () => {
  const prompt = buildTemplateCreationPrompt("a daily reflection");

  assert.match(prompt, /reusable Trellis template/);
  assert.match(prompt, /editable reusable template draft/);
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

test("stripAssistantTemplateDraftMarkdown removes false template save footer", () => {
  const raw = [
    "Great! I'll create a reusable template note in your vault called Daily Reflection (template) with the content below:",
    "",
    "# Daily Reflection - {{date}}",
    "",
    "## How did I feel today?",
    "- ",
    "",
    "## What went well today?",
    "- ",
    "",
    "I'm adding this as Daily Reflection (template) under your templates. You can now instantiate a fresh daily reflection note from this template whenever you want."
  ].join("\n");

  const cleaned = stripAssistantTemplateDraftMarkdown(raw);

  assert.match(cleaned, /^# Daily Reflection - \{\{date\}\}/);
  assert.ok(!cleaned.includes("Great!"));
  assert.ok(!cleaned.includes("I'm adding this"));
  assert.ok(!cleaned.includes("You can now"));
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
