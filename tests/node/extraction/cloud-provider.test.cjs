const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { createCloudExtractionProvider } = require(fromRepoRoot(
  "electron",
  "lib",
  "extraction",
  "providers",
  "cloudApi.ts"
));
const { fetchSafeHttpsPost } = require(fromRepoRoot("electron", "lib", "fetchSafe.ts"));

test("createCloudExtractionProvider getStatus reflects API key presence", async () => {
  const withoutKey = createCloudExtractionProvider("openai", () => null);
  const st0 = await withoutKey.getStatus();
  assert.equal(st0.available, false);
  assert.equal(st0.id, "cloud-openai");
  assert.match(st0.reason ?? "", /OPENAI_API_KEY/);

  const withKey = createCloudExtractionProvider("anthropic", () => "sk-test");
  const st1 = await withKey.getStatus();
  assert.equal(st1.available, true);
  assert.equal(st1.id, "cloud-anthropic");
});

test("fetchSafeHttpsPost rejects non-allowlisted hosts", async () => {
  await assert.rejects(
    () => fetchSafeHttpsPost("https://example.com/api", { body: "{}" }),
    /allowlisted/
  );
});
