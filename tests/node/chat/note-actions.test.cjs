const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { hasDirectNoteActionIntent, proposeChatNoteActions } = require(
  fromRepoRoot("apps", "desktop", "electron", "lib", "chat", "noteActions.ts")
);

function makeMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content
  };
}

function makeSettings(bucketPath) {
  return {
    buckets: [
      {
        id: "vault-1",
        name: "Test bucket",
        path: bucketPath
      }
    ],
    activeBucketId: "vault-1",
    theme: "dark",
    rememberSession: true,
    cloudSyncEnabled: true,
    chat: {
      privacyMode: "auto"
    },
    extraction: {
      mode: "local",
      preferredLocalModelId: null
    }
  };
}

test("hasDirectNoteActionIntent detects explicit save to vault", () => {
  assert.equal(hasDirectNoteActionIntent("Save this takeaway to my wiki"), true);
  assert.equal(hasDirectNoteActionIntent("Just brainstorming ideas"), false);
});

test("hasDirectNoteActionIntent does not treat bare affirmations as save intent", () => {
  assert.equal(hasDirectNoteActionIntent("yes"), false);
});

test("proposeChatNoteActions merges assistant draft into pinned note", async () => {
  const bucketPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-note-action-pinned-"));

  try {
    const wikiPath = path.join(bucketPath, "wiki");
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

    const opener = makeMessage("user", "Add a section to Roadmap from our chat.");
    const assistant = makeMessage(
      "assistant",
      ["## New section from chat", "", "- Capture decisions quickly."].join("\n")
    );
    const user = makeMessage("user", "Save that into my wiki note please");
    const result = await proposeChatNoteActions(
      () => makeSettings(bucketPath),
      {
        mode: "local",
        bucketId: "vault-1",
        pinnedNoteSlugs: ["roadmap"],
        messages: [opener, assistant, user]
      }
    );

    assert.equal(result.clarification, null);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].kind, "update_note");
    assert.equal(result.actions[0].targetSlug, "roadmap");
    assert.match(result.actions[0].afterMarkdown, /New section from chat/);
  } finally {
    fs.rmSync(bucketPath, { recursive: true, force: true });
  }
});

test("proposeChatNoteActions proposes update for active note when user says this note", async () => {
  const bucketPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-note-action-active-"));

  try {
    const wikiPath = path.join(bucketPath, "wiki");
    fs.mkdirSync(wikiPath, { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, "focus.md"),
      [
        "---",
        "title: Focus",
        "created: 2026-04-10",
        "updated: 2026-04-10",
        "sources: 0",
        "tags: []",
        "type: concept",
        "---",
        "",
        "Original."
      ].join("\n"),
      "utf8"
    );

    const opener = makeMessage("user", "Let's extend the Focus note.");
    const assistant = makeMessage("assistant", "## Addendum\n\nMore from the thread.");
    const user = makeMessage("user", "Save changes to the active note");
    const result = await proposeChatNoteActions(
      () => makeSettings(bucketPath),
      {
        mode: "local",
        bucketId: "vault-1",
        activeNoteSlug: "focus",
        messages: [opener, assistant, user]
      }
    );

    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].kind, "update_note");
    assert.equal(result.actions[0].targetSlug, "focus");
  } finally {
    fs.rmSync(bucketPath, { recursive: true, force: true });
  }
});

test("proposeChatNoteActions returns no actions without pins or active-note targeting", async () => {
  const bucketPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-note-action-none-"));

  try {
    const opener = makeMessage("user", "Draft something.");
    const assistant = makeMessage("assistant", "## Draft\n\nHello.");
    const user = makeMessage("user", "Save that to a note");
    const result = await proposeChatNoteActions(
      () => makeSettings(bucketPath),
      {
        mode: "local",
        bucketId: "vault-1",
        messages: [opener, assistant, user]
      }
    );

    assert.equal(result.actions.length, 0);
  } finally {
    fs.rmSync(bucketPath, { recursive: true, force: true });
  }
});

test("proposeChatNoteActions does not propose without paired assistant draft", async () => {
  const bucketPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-note-action-solo-"));

  try {
    const user = makeMessage("user", "Update [[Roadmap]] to include approvals.");
    const result = await proposeChatNoteActions(
      () => makeSettings(bucketPath),
      {
        mode: "auto",
        bucketId: "vault-1",
        messages: [user]
      }
    );

    assert.equal(result.actions.length, 0);
  } finally {
    fs.rmSync(bucketPath, { recursive: true, force: true });
  }
});
