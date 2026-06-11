const path = require("node:path");

const rootDir = path.resolve(__dirname, "..", "..", "..");

function fromRepoRoot(...segments) {
  return path.join(rootDir, ...segments);
}

module.exports = {
  rootDir,
  fromRepoRoot
};
