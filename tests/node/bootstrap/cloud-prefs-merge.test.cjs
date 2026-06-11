const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { mergeCloudSyncEnabledFromPlatform } = require(
  fromRepoRoot("shared", "cloud", "mergePreferences.ts")
);

test("mergeCloudSyncEnabledFromPlatform applies platform.cloudSyncEnabled", () => {
  assert.equal(
    mergeCloudSyncEnabledFromPlatform(true, { cloudSyncEnabled: false }),
    false
  );
});

test("mergeCloudSyncEnabledFromPlatform keeps current when platform omits flag", () => {
  assert.equal(
    mergeCloudSyncEnabledFromPlatform(false, { otherFlag: true }),
    false
  );
  assert.equal(mergeCloudSyncEnabledFromPlatform(true, {}), true);
});
