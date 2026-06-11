const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { extractParsedCloudWikiLinks } = require(fromRepoRoot("shared", "cloud", "wikiLinks.ts"));

test("extractParsedCloudWikiLinks returns unique slugged wiki links", () => {
  const parsed = extractParsedCloudWikiLinks(
    [
      "See [[Alpha Project]] and [[Beta Team|team alias]].",
      "Repeat [[Alpha Project]] should collapse."
    ].join("\n")
  );

  assert.deepEqual(parsed, [
    { title: "Alpha Project", slug: "alpha-project" },
    { title: "Beta Team", slug: "beta-team" }
  ]);
});
