const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  executeVaultOrganize,
  hasVaultOrganizeIntent,
  planVaultOrganize
} = require(fromRepoRoot("electron", "lib", "chat", "vaultOrganize.ts"));

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

test("hasVaultOrganizeIntent detects create-new-folder phrasing", () => {
  assert.equal(
    hasVaultOrganizeIntent("create a new folder for daily log notes and add today's note"),
    true
  );
  assert.equal(hasVaultOrganizeIntent("what is the weather"), false);
});

test("planVaultOrganize proposes folder and daily log move", () => {
  const fixed = new Date("2026-04-10T12:00:00Z");
  const msg =
    "Can you create a new folder for daily log notes and add today's daily log note to it?";

  const notes = [
    {
      slug: "daily-log-2026-04-10-abcdef12",
      title: "Daily Log - Apr 10, 2026",
      updated: "2026-04-10",
      tags: [],
      type: "concept",
      excerpt: "",
      inboundCount: 0,
      folderPath: "",
      relativePath: "daily-log-2026-04-10-abcdef12.md"
    }
  ];

  const plan = planVaultOrganize(msg, notes, fixed);

  assert.ok(plan);
  assert.equal(plan.createFolders[0]?.name, "daily-log-notes");
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.moves[0]?.slug, "daily-log-2026-04-10-abcdef12");
  assert.equal(plan.moves[0]?.folderPath, "daily-log-notes");
});

test("planVaultOrganize handles daily log files under a quoted new folder", () => {
  const fixed = new Date("2026-04-10T12:00:00Z");
  const msg = 'can you put any daily log files under a new "Daily Logs" folder';

  const notes = [
    {
      slug: "daily-log-2026-04-09-abcdef12",
      title: "Daily Log - Apr 9, 2026",
      updated: "2026-04-09",
      tags: [],
      type: "concept",
      excerpt: "",
      inboundCount: 0,
      folderPath: "",
      relativePath: "daily-log-2026-04-09-abcdef12.md"
    },
    {
      slug: "daily-log-2026-04-10-bcdefa23",
      title: "Daily Log - Apr 10, 2026",
      updated: "2026-04-10",
      tags: [],
      type: "concept",
      excerpt: "",
      inboundCount: 0,
      folderPath: "",
      relativePath: "daily-log-2026-04-10-bcdefa23.md"
    },
    {
      slug: "weekly-review-rhythm",
      title: "Weekly Review Rhythm",
      updated: "2026-04-10",
      tags: [],
      type: "concept",
      excerpt: "",
      inboundCount: 0,
      folderPath: "",
      relativePath: "weekly-review-rhythm.md"
    }
  ];

  const plan = planVaultOrganize(msg, notes, fixed);

  assert.ok(plan);
  assert.equal(plan.createFolders[0]?.name, "daily-logs");
  assert.equal(plan.moves.length, 2);
  assert.deepEqual(
    plan.moves.map((move) => move.slug),
    ["daily-log-2026-04-09-abcdef12", "daily-log-2026-04-10-bcdefa23"]
  );
  assert.deepEqual(
    plan.moves.map((move) => move.folderPath),
    ["daily-logs", "daily-logs"]
  );
});

test("executeVaultOrganize creates the requested daily logs folder", async () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-vault-organize-"));

  try {
    const result = await executeVaultOrganize(
      () => makeSettings(vaultPath),
      {
        vaultId: "vault-1",
        userMessage: 'can you put any daily log files under a new "Daily Logs" folder'
      }
    );

    assert.equal(result.applied, true);
    assert.equal(result.message, "Created wiki folder “daily-logs”.");
    assert.equal(fs.existsSync(path.join(vaultPath, "wiki", "daily-logs")), true);
  } finally {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});
