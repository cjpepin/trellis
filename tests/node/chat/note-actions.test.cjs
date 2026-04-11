const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  hasDirectNoteActionIntent,
  hasTemplateCreationReviewIntent,
  isCombinedTemplateDraftAndSaveRequest,
  proposeChatNoteActions
} = require(fromRepoRoot("electron", "lib", "chat", "noteActions.ts"));

function makeMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content
  };
}

function makeSettings(vaultPath) {
  return {
    vaults: [
      {
        id: "vault-1",
        name: "Test Vault",
        path: vaultPath
      }
    ],
    activeVaultId: "vault-1",
    theme: "dark",
    rememberSession: true,
    chat: {
      privacyMode: "auto"
    },
    extraction: {
      mode: "local",
      preferredLocalModelId: null
    }
  };
}

test("direct note action intent ignores template drafting but catches explicit save", () => {
  assert.equal(
    hasDirectNoteActionIntent(
      "Help me create a reusable Trellis template for a daily reflection."
    ),
    false
  );
  assert.equal(
    hasDirectNoteActionIntent("I like that, save it as a reusable template"),
    true
  );
});

test("proposeChatNoteActions creates a pending reusable template proposal without writing", async () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-note-action-"));

  try {
    const userRequest = makeMessage("user", "Help me draft a daily reflection template.");
    const assistant = makeMessage(
      "assistant",
      [
        "# Daily Reflection",
        "",
        "## Mood",
        "- How did you feel overall today?",
        "",
        "## Energy",
        "- What was your energy level?"
      ].join("\n")
    );
    const user = makeMessage("user", "I like that, save it as a reusable template");
    const result = await proposeChatNoteActions(
      () => makeSettings(vaultPath),
      {
        mode: "local",
        vaultId: "vault-1",
        messages: [userRequest, assistant, user]
      }
    );

    assert.equal(result.clarification, null);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].kind, "create_template");
    assert.equal(result.actions[0].status, "pending");
    assert.equal(result.actions[0].targetTitle, "Daily Reflection Template");
    assert.equal(result.actions[0].targetSlug, "daily-reflection-template");
    assert.equal(result.actions[0].targetFolderPath, "templates");
    assert.deepEqual(result.actions[0].frontmatter.tags, ["template"]);
    assert.match(result.actions[0].afterMarkdown, /## Mood/);
    assert.equal(
      fs.existsSync(path.join(vaultPath, "wiki", "templates", "daily-reflection-template.md")),
      false
    );
  } finally {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

test("proposeChatNoteActions proposes create_template when user says please do after a drafted template", async () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-note-action-please-do-"));

  try {
    const userRequest = makeMessage(
      "user",
      [
        "Help me create a reusable Trellis template for a daily log.",
        "Include a clear markdown structure and the prompts you should ask me when I use it, so Trellis can save it as a reusable template note."
      ].join("\n")
    );
    const assistant = makeMessage(
      "assistant",
      [
        "Here's a reusable daily log template:",
        "",
        "```markdown",
        "# Daily Log - [Date]",
        "",
        "## Sleep",
        "- Hours slept?",
        "",
        "## Vibe",
        "- Mood today?",
        "```"
      ].join("\n")
    );
    const user = makeMessage("user", "please do!");
    const result = await proposeChatNoteActions(
      () => makeSettings(vaultPath),
      {
        mode: "local",
        vaultId: "vault-1",
        messages: [userRequest, assistant, user]
      }
    );

    assert.equal(result.clarification, null);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].kind, "create_template");
    assert.equal(result.actions[0].targetSlug, "daily-log-date-template");
    assert.match(result.actions[0].afterMarkdown, /## Sleep/);
  } finally {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

test("proposeChatNoteActions skips pre-LLM template save when the user still needs a draft", async () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-note-action-combined-"));

  try {
    const seededAssistant = makeMessage(
      "assistant",
      "Yes: new users understand what to do within minutes, important conversations turn into useful notes without cleanup, and people trust where their context lives when cloud features or providers are unavailable."
    );
    const user = makeMessage(
      "user",
      [
        "Help me create a reusable Trellis template for a daily log to track sleep, vibe, and goals.",
        "Include a clear markdown structure and the prompts you should ask me when I use it, so Trellis can save it as a reusable template note."
      ].join("\n")
    );
    const result = await proposeChatNoteActions(
      () => makeSettings(vaultPath),
      {
        mode: "local",
        vaultId: "vault-1",
        messages: [seededAssistant, user]
      }
    );

    assert.equal(result.actions.length, 0);
    assert.ok(isCombinedTemplateDraftAndSaveRequest(user.content));
  } finally {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

test("hasTemplateCreationReviewIntent only when saving a template", () => {
  assert.equal(hasTemplateCreationReviewIntent("Update [[Roadmap]] to include template approvals."), false);
  assert.equal(hasTemplateCreationReviewIntent("I like that, save it as a reusable template"), true);
});

test("proposeChatNoteActions does not propose vault diffs for ordinary note updates", async () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-note-action-"));

  try {
    const wikiPath = path.join(vaultPath, "wiki");
    fs.mkdirSync(wikiPath, { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, "roadmap.md"),
      [
        "---",
        "title: Roadmap",
        "created: 2026-04-10",
        "updated: 2026-04-10",
        "sources: 0",
        "tags: [product]",
        "type: concept",
        "---",
        "",
        "## Bets",
        "",
        "- Keep onboarding calm."
      ].join("\n"),
      "utf8"
    );

    const user = makeMessage("user", "Update [[Roadmap]] to include template approvals.");
    const result = await proposeChatNoteActions(
      () => makeSettings(vaultPath),
      {
        mode: "auto",
        vaultId: "vault-1",
        messages: [user]
      }
    );

    assert.equal(result.clarification, null);
    assert.equal(result.actions.length, 0);
  } finally {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

test("proposeChatNoteActions does not propose when overwriting an existing template file", async () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-note-action-update-template-"));

  try {
    const templatesDir = path.join(vaultPath, "wiki", "templates");
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(templatesDir, "daily-reflection-template.md"),
      [
        "---",
        "title: Daily Reflection Template",
        "created: 2026-04-10",
        "updated: 2026-04-10",
        "sources: 0",
        "tags: [template]",
        "type: concept",
        "---",
        "",
        "## Old"
      ].join("\n"),
      "utf8"
    );

    const userRequest = makeMessage("user", "Draft a daily reflection template.");
    const assistant = makeMessage(
      "assistant",
      ["# Daily Reflection", "", "## Mood", "- Prompt"].join("\n")
    );
    const user = makeMessage("user", "Save it as a reusable template");
    const result = await proposeChatNoteActions(
      () => makeSettings(vaultPath),
      {
        mode: "local",
        vaultId: "vault-1",
        messages: [userRequest, assistant, user]
      }
    );

    assert.equal(result.clarification, null);
    assert.equal(result.actions.length, 0);
  } finally {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});
