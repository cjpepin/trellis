#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "deno",
  ["test", "-A", "supabase/functions/_shared/auth.test.ts"],
  {
    stdio: "inherit",
    shell: false
  }
);

if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
  console.warn("Skipping Supabase Edge Function Deno tests: `deno` is not installed.");
  process.exit(0);
}

process.exit(result.status ?? 1);
