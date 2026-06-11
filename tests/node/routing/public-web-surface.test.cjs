const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  WEB_APP_BASE_PATH,
  appShellPath,
  isAppShellPath,
  stripAppShellBase
} = require(fromRepoRoot("src", "lib", "appRoutes.ts"));
const {
  notesHashHref,
  notesRoutePath,
  slugFromInternalNoteHashHref,
  isInternalNoteHashHref
} = require(fromRepoRoot("src", "lib", "noteRoutes.ts"));

test("appShellPath prefixes hosted web routes under /app", () => {
  assert.equal(WEB_APP_BASE_PATH, "/app");
  assert.equal(appShellPath("/"), "/app");
  assert.equal(appShellPath("/chat"), "/app/chat");
  assert.equal(appShellPath("/settings"), "/app/settings");
});

test("app shell helpers recognize and strip hosted web app paths", () => {
  assert.equal(isAppShellPath("/app"), true);
  assert.equal(isAppShellPath("/app/chat"), true);
  assert.equal(isAppShellPath("/updates"), false);

  assert.equal(stripAppShellBase("/app"), "/");
  assert.equal(stripAppShellBase("/app/chat"), "/chat");
  assert.equal(stripAppShellBase("/updates"), "/updates");
});

test("note route helpers generate hosted web note links", () => {
  assert.equal(notesRoutePath(), "/app/notes");
  assert.equal(notesRoutePath("alpha-note"), "/app/notes?note=alpha-note");
  assert.equal(notesHashHref("alpha note"), "/app/notes?note=alpha%20note");
});

test("internal note link helpers accept hosted web, legacy, and hash formats", () => {
  const hostedHref = "/app/notes?note=alpha%20note";
  const legacyHref = "#/wiki?note=legacy-note";
  const hashHref = "#/notes?note=hash-note";

  assert.equal(isInternalNoteHashHref(hostedHref), true);
  assert.equal(isInternalNoteHashHref(legacyHref), true);
  assert.equal(isInternalNoteHashHref(hashHref), true);
  assert.equal(isInternalNoteHashHref("https://example.com"), false);

  assert.equal(slugFromInternalNoteHashHref(hostedHref), "alpha note");
  assert.equal(slugFromInternalNoteHashHref(legacyHref), "legacy-note");
  assert.equal(slugFromInternalNoteHashHref(hashHref), "hash-note");
});
