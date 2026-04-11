const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { normalizeExternalHttpsUrl } = require(fromRepoRoot("shared", "shell", "externalHttpsUrl.ts"));

test("normalizeExternalHttpsUrl accepts https and normalizes", () => {
  assert.equal(
    normalizeExternalHttpsUrl("HTTPS://Example.COM/path?q=1#h"),
    "https://example.com/path?q=1#h"
  );
});

test("normalizeExternalHttpsUrl rejects non-https and invalid input", () => {
  assert.equal(normalizeExternalHttpsUrl("http://example.com"), null);
  assert.equal(normalizeExternalHttpsUrl("ftp://example.com"), null);
  assert.equal(normalizeExternalHttpsUrl("javascript:alert(1)"), null);
  assert.equal(normalizeExternalHttpsUrl(""), null);
  assert.equal(normalizeExternalHttpsUrl("   "), null);
  assert.equal(normalizeExternalHttpsUrl(null), null);
});
