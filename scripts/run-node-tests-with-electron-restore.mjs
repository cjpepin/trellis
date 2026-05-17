#!/usr/bin/env node
/**
 * Node regression tests need `better-sqlite3` built for **system Node** (e.g. vault tests).
 * `npm run dev` / Electron need the same module built for **Electron's Node ABI**.
 * Always run `rebuild:native` after tests so a failed test run does not leave ABI 127
 * and break the next `pnpm run dev`.
 */
import { spawnSync } from "node:child_process";
import { fromRepoRoot } from "./lib/repo-paths.mjs";

const repoRoot = fromRepoRoot();
const runNodeTests = fromRepoRoot("scripts", "run-node-tests.mjs");
const extraArgs = process.argv.slice(2);

function runPnpm(args) {
  return spawnSync("pnpm", args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
}

runPnpm(["rebuild", "better-sqlite3"]);

const testResult = spawnSync(process.execPath, [runNodeTests, ...extraArgs], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env
});

const exitCode = testResult.status ?? 1;

runPnpm(["run", "rebuild:native"]);

process.exit(exitCode);
