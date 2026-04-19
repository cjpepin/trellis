#!/usr/bin/env node
/**
 * When `better-sqlite3` was built for a different Node/Electron ABI, startup or tests fail with ERR_DLOPEN_FAILED.
 * `package.json` runs `electron-builder install-app-deps` on postinstall so Electron gets the right binary after
 * `better-sqlite3`'s own install script builds for system Node.
 * `npm run test:node` rebuilds for Node, runs tests, then runs `rebuild:native` again for the Electron app.
 * Run manually if needed: `node scripts/rebuild-native-if-needed.mjs` or `npm run rebuild:native`.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

try {
  require("better-sqlite3");
  process.exit(0);
} catch {
  // continue
}

console.warn("better-sqlite3 did not load; running electron-builder install-app-deps…");
const result = spawnSync(
  "npx",
  ["--no-install", "electron-builder", "install-app-deps"],
  { stdio: "inherit", shell: true }
);
process.exit(result.status ?? 1);
