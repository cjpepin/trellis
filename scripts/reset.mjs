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

  if (!["all", "personal", "preview", "preview-heavy"].includes(value)) {
    throw new Error(
      `Unknown workspace ${value}. Use --workspace=all|personal|preview|preview-heavy.`
    );
  }

  return value;
}

/** When set with `--workspace=all`, skip preview + preview-heavy (vault wiki/raw + local DB only for personal). */
function parseExcludePreview(argv) {
  if (argv.includes("--exclude-preview") || argv.includes("--no-preview")) {
    return true;
  }
  const raw = process.env.TRELLIS_RESET_EXCLUDE_PREVIEW?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

function parseResetArgs(argv) {
  const workspaceSelection = parseWorkspaceArg(argv);
  let excludePreviewWorkspaces = parseExcludePreview(argv);

  if (excludePreviewWorkspaces && workspaceSelection !== "all") {
    console.warn(
      "Trellis reset: --exclude-preview / TRELLIS_RESET_EXCLUDE_PREVIEW only apply with --workspace=all; ignoring.\n"
    );
    excludePreviewWorkspaces = false;
  }

  return { workspaceSelection, excludePreviewWorkspaces };
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

/** Remove a SQLite database file and any WAL/SHM sidecars. */
function removeSqliteDatabase(filePath) {
  const targets = [filePath, `${filePath}-wal`, `${filePath}-shm`];
  let removed = false;

  for (const p of targets) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
      removed = true;
    }
  }

  return { filePath, removed };
}

/** Legacy PGlite workspace directory (pre-SQLite). */
function removePgliteDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return { dirPath, removed: false };
  }

  fs.rmSync(dirPath, { recursive: true, force: true });
  return { dirPath, removed: true };
}

const appName = readAppName();
const userDataDir = getUserDataDir(appName);
const argv = process.argv.slice(2);
const { workspaceSelection, excludePreviewWorkspaces } = parseResetArgs(argv);

const resetLabel =
  workspaceSelection === "all" && excludePreviewWorkspaces
    ? `${workspaceSelection} (excluding preview workspaces)`
    : workspaceSelection;

console.log(`Trellis reset (app data: ${userDataDir}, workspace: ${resetLabel})\n`);

if (excludePreviewWorkspaces && workspaceSelection === "all") {
  console.log(
    "Only the personal workspace is reset: vault paths come from workspaces/personal/settings.json (or legacy root settings.json if personal settings are missing). Preview workspaces are skipped.\n"
  );
}

const extraVaults = process.env.TRELLIS_EXTRA_VAULT_PATHS
  ? process.env.TRELLIS_EXTRA_VAULT_PATHS.split(path.delimiter)
      .map((p) => p.trim())
      .filter(Boolean)
  : [];

/** Keep in sync with `workspaceIds` in `electron/lib/workspaces.ts` (each has `workspaces/<id>/local.sqlite`). */
const allAppWorkspaceIds = ["personal", "preview", "preview-heavy"];
const workspaceIds =
  workspaceSelection === "all"
    ? excludePreviewWorkspaces
      ? ["personal"]
      : allAppWorkspaceIds
    : [workspaceSelection];

const legacyRootSettingsPath = path.join(userDataDir, "settings.json");
const personalSettingsPath = path.join(userDataDir, "workspaces", "personal", "settings.json");

/** With --exclude-preview, do not read preview settings (avoids clearing their vault trees via legacy multi-vault root files). */
const settingsPaths =
  workspaceSelection === "all" && excludePreviewWorkspaces
    ? fs.existsSync(personalSettingsPath)
      ? [personalSettingsPath]
      : fs.existsSync(legacyRootSettingsPath)
        ? [legacyRootSettingsPath]
        : []
    : [
        legacyRootSettingsPath,
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

const sqlitePaths = workspaceIds.map((workspaceId) =>
  path.join(userDataDir, "workspaces", workspaceId, "local.sqlite")
);

for (const sqliteFile of sqlitePaths) {
  const { filePath, removed } = removeSqliteDatabase(sqliteFile);

  if (removed) {
    console.log(`Removed local SQLite (and WAL/SHM if present): ${filePath}`);
  } else {
    console.log(`Local SQLite not present (ok): ${filePath}`);
  }
}

if (excludePreviewWorkspaces && workspaceSelection === "all") {
  const skipped = allAppWorkspaceIds.filter((id) => id !== "personal");
  console.log(
    `Skipped local SQLite (exclude-preview): ${skipped.map((id) => `workspaces/${id}/local.sqlite`).join(", ")}`
  );
}

const legacyPgliteDirs = [
  path.join(userDataDir, "pglite-data"),
  ...workspaceIds.map((workspaceId) =>
    path.join(userDataDir, "workspaces", workspaceId, "pglite-data")
  )
];

for (const pgDir of legacyPgliteDirs) {
  const { dirPath, removed } = removePgliteDir(pgDir);

  if (removed) {
    console.log(`Removed legacy PGlite directory: ${dirPath}`);
  }
}

console.log(
  "\nQuit Trellis before running this script if the app is open. Next launch recreates local SQLite and empty wiki/raw folders as needed."
);
