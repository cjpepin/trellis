/**
 * Resolve workspace TS path aliases when running `node --test` against `.ts` sources
 * (used by `scripts/run-node-tests.mjs` before `sucrase/register/ts`).
 */
const path = require("node:path");
const Module = require("node:module");

const repoRoot = path.resolve(__dirname, "..");

const origResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveWorkspaceAliases(request, parent, isMain, options) {
  let nextRequest = request;

  if (request.startsWith("@trellis/shared/")) {
    const subPath = request.slice("@trellis/shared/".length);
    nextRequest = path.join(repoRoot, "packages", "shared", "src", subPath);
  } else if (request === "@trellis/contracts") {
    nextRequest = path.join(repoRoot, "packages", "contracts", "src", "index.ts");
  } else if (request.startsWith("@trellis/contracts/")) {
    const subPath = request.slice("@trellis/contracts/".length);
    nextRequest = path.join(repoRoot, "packages", "contracts", "src", subPath);
  }

  return origResolveFilename.call(this, nextRequest, parent, isMain, options);
};
