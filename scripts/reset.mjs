import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fromRepoRoot } from "./lib/repo-paths.mjs";

function readAppName() {
  const pkgPath = fromRepoRoot("package.json");
  const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const name = typeof raw.name === "string" ? raw.name : "trellis";
  return name;
}

function parseWorkspaceArg(argv) {
  const flag = argv.find((arg) => arg.startsWith("--workspace="));
  const value = flag ? flag.split("=")[1] : "all";

  if (!["all", "personal", "preview"].includes(value)) {
    throw new Error(`Unknown workspace ${value}. Use --workspace=all|personal|preview.`);
  }

  return value;
}

/** Mirrors Electron `app.getPath("userData")` for unpackaged apps using `package.json` `name`. */
function getUserDataDir(appName) {
  const home = os.homedir();

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", appName);
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, appName);
  }

  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdg, appName);
}

function emptySubdir(parent, sub) {
  const dir = path.join(parent, sub);

  if (!fs.existsSync(dir)) {
    return { dir, removed: 0, errors: 0, skipped: true };
  }

  let removed = 0;
  let errors = 0;

  for (const name of fs.readdirSync(dir)) {
    const target = path.join(dir, name);

    try {
      fs.rmSync(target, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  warning: could not remove ${target}: ${message}`);
    }
  }

  return { dir, removed, errors, skipped: false };
}

function readVaultPaths(settingsPath) {
  if (!fs.existsSync(settingsPath)) {
    return [];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

    if (typeof raw.vaultPath === "string" && raw.vaultPath.length > 0) {
      return [raw.vaultPath];
    }

    if (Array.isArray(raw.vaults)) {
      return raw.vaults
        .map((v) => (v && typeof v.path === "string" ? v.path : null))
        .filter((p) => p !== null);
    }
  } catch {
    console.warn(`Could not parse settings at ${settingsPath}; skipping wiki/raw cleanup.`);
  }

  return [];
}

function removePglite(userDataDir) {
  const pglitePath = path.join(userDataDir, "pglite-data");

  if (!fs.existsSync(pglitePath)) {
    return { pglitePath, removed: false };
  }

  fs.rmSync(pglitePath, { recursive: true, force: true });
  return { pglitePath, removed: true };
}

const appName = readAppName();
const userDataDir = getUserDataDir(appName);
const workspaceSelection = parseWorkspaceArg(process.argv.slice(2));

console.log(`Trellis reset (app data: ${userDataDir}, workspace: ${workspaceSelection})\n`);

const extraVaults = process.env.TRELLIS_EXTRA_VAULT_PATHS
  ? process.env.TRELLIS_EXTRA_VAULT_PATHS.split(path.delimiter)
      .map((p) => p.trim())
      .filter(Boolean)
  : [];

const workspaceIds =
  workspaceSelection === "all" ? ["personal", "preview"] : [workspaceSelection];
const settingsPaths = [
  path.join(userDataDir, "settings.json"),
  ...workspaceIds.map((workspaceId) =>
    path.join(userDataDir, "workspaces", workspaceId, "settings.json")
  )
];
const vaultPaths = [
  ...new Set([
    ...settingsPaths.flatMap((settingsPath) => readVaultPaths(settingsPath)),
    ...extraVaults
  ])
];

if (vaultPaths.length === 0) {
  console.log("No vault paths found (missing or empty settings.json). Skipping wiki/raw.");
  console.log("Set TRELLIS_EXTRA_VAULT_PATHS to a colon-separated list to clear specific vaults.\n");
} else {
  for (const vaultPath of vaultPaths) {
    const resolved = path.resolve(vaultPath);
    console.log(`Vault: ${resolved}`);

    for (const sub of ["wiki", "raw"]) {
      const { removed, errors, skipped } = emptySubdir(resolved, sub);

      if (skipped) {
        console.log(`  ${sub}/ (missing, skipped)`);
      } else {
        const errNote = errors > 0 ? `, ${errors} error${errors === 1 ? "" : "s"}` : "";
        console.log(`  ${sub}/ cleared (${removed} top-level entr${removed === 1 ? "y" : "ies"}${errNote})`);
      }
    }
  }

  console.log("");
}

const databasePaths =
  workspaceSelection === "all"
    ? [path.join(userDataDir, "pglite-data"), ...workspaceIds.map((workspaceId) => path.join(userDataDir, "workspaces", workspaceId, "pglite-data"))]
    : [path.join(userDataDir, "workspaces", workspaceSelection, "pglite-data")];

for (const databasePath of databasePaths) {
  const { pglitePath, removed } = removePglite(path.dirname(databasePath));

  if (removed) {
    console.log(`Removed PGlite data: ${pglitePath}`);
  } else {
    console.log(`PGlite data not present (ok): ${pglitePath}`);
  }
}

console.log("\nQuit Trellis before running this script if the app is open. Next launch recreates PGlite and empty wiki/raw folders as needed.");
