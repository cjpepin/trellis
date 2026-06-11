const test = require("node:test");
const assert = require("node:assert/strict");
const { fromRepoRoot } = require("./support/repo-paths.cjs");

const {
  folderPathToCreateParts,
  sortFolderPathsForRestore
} = require(fromRepoRoot("src", "lib", "wikiExplorerUndo.ts"));

test("sortFolderPathsForRestore orders shallow paths first", () => {
  const sorted = sortFolderPathsForRestore(["a/b/c", "a", "a/b"]);
  assert.deepEqual(sorted, ["a", "a/b", "a/b/c"]);
});

test("folderPathToCreateParts splits root and nested", () => {
  assert.deepEqual(folderPathToCreateParts("research"), { name: "research", parentPath: "" });
  assert.deepEqual(folderPathToCreateParts("research/2024"), {
    name: "2024",
    parentPath: "research"
  });
});
