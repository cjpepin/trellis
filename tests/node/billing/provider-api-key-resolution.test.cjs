const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { resolveCloudProviderApiKey } = require(
  fromRepoRoot("shared", "billing", "providerApiKeyResolution.ts")
);

test("resolveCloudProviderApiKey prefers stored key only for BYOK", () => {
  assert.equal(
    resolveCloudProviderApiKey({
      subscriptionTier: "byok",
      storedKey: "sk-stored",
      envKey: "sk-env"
    }),
    "sk-stored"
  );
});

test("resolveCloudProviderApiKey uses env for trial even when stored exists", () => {
  assert.equal(
    resolveCloudProviderApiKey({
      subscriptionTier: "trial",
      storedKey: "sk-stored",
      envKey: "sk-env"
    }),
    "sk-env"
  );
});

test("resolveCloudProviderApiKey uses env for BYOK when no stored key", () => {
  assert.equal(
    resolveCloudProviderApiKey({
      subscriptionTier: "byok",
      storedKey: null,
      envKey: "sk-env"
    }),
    "sk-env"
  );
});

test("resolveCloudProviderApiKey returns null when no keys", () => {
  assert.equal(
    resolveCloudProviderApiKey({
      subscriptionTier: "pro",
      storedKey: null,
      envKey: null
    }),
    null
  );
});
