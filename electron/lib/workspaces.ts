import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppWorkspaceId, WorkspaceInfo } from "../ipc/types";
import { getUserDataRoot } from "./appPaths";

export const workspaceIds = ["personal", "preview"] as const satisfies readonly AppWorkspaceId[];

const workspaceStateSchema = z.object({
  activeWorkspaceId: z.enum(workspaceIds),
  hasCompletedSelection: z.boolean()
});

export interface WorkspaceState {
  activeWorkspaceId: AppWorkspaceId;
  hasCompletedSelection: boolean;
}

export interface WorkspacePaths {
  root: string;
  settingsPath: string;
  authPath: string;
  providerKeysPath: string;
  databasePath: string;
  previewSeedStatePath: string;
}

export interface SharedAccountStoragePaths {
  authPath: string;
  providerKeysPath: string;
}

function getGlobalStatePath(): string {
  return path.join(getUserDataRoot(), "workspace-state.json");
}

export function getLegacyStoragePaths() {
  const baseRoot = getUserDataRoot();
  return {
    settingsPath: path.join(baseRoot, "settings.json"),
    authPath: path.join(baseRoot, "supabase-session.bin"),
    databasePath: path.join(baseRoot, "pglite-data")
  };
}

export function getWorkspacePaths(workspaceId: AppWorkspaceId): WorkspacePaths {
  const root = path.join(getUserDataRoot(), "workspaces", workspaceId);

  return {
    root,
    settingsPath: path.join(root, "settings.json"),
    authPath: path.join(root, "supabase-session.bin"),
    providerKeysPath: path.join(root, "provider-keys.bin"),
    databasePath: path.join(root, "pglite-data"),
    previewSeedStatePath: path.join(root, "preview-seed-state.json")
  };
}

export function getSharedAccountStoragePaths(): SharedAccountStoragePaths {
  const personalPaths = getWorkspacePaths("personal");

  return {
    authPath: personalPaths.authPath,
    providerKeysPath: personalPaths.providerKeysPath
  };
}

function hasPathContent(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const stats = fs.statSync(targetPath);

  if (stats.isDirectory()) {
    return fs.readdirSync(targetPath).length > 0;
  }

  return stats.size > 0;
}

export function hasLegacyPersonalData(): boolean {
  const legacy = getLegacyStoragePaths();
  return [legacy.settingsPath, legacy.authPath, legacy.databasePath].some(hasPathContent);
}

function copyIfPresent(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
}

export function migrateLegacyPersonalWorkspace(): void {
  const personalPaths = getWorkspacePaths("personal");

  if (
    fs.existsSync(personalPaths.settingsPath) ||
    fs.existsSync(personalPaths.authPath) ||
    fs.existsSync(personalPaths.databasePath) ||
    !hasLegacyPersonalData()
  ) {
    return;
  }

  const legacy = getLegacyStoragePaths();
  fs.mkdirSync(personalPaths.root, { recursive: true });
  copyIfPresent(legacy.settingsPath, personalPaths.settingsPath);
  copyIfPresent(legacy.authPath, personalPaths.authPath);
  copyIfPresent(legacy.databasePath, personalPaths.databasePath);
}

export function readWorkspaceState(): WorkspaceState {
  const statePath = getGlobalStatePath();

  if (!fs.existsSync(statePath)) {
    return {
      activeWorkspaceId: "personal",
      hasCompletedSelection: hasLegacyPersonalData()
    };
  }

  try {
    return workspaceStateSchema.parse(JSON.parse(fs.readFileSync(statePath, "utf8")));
  } catch (error) {
    console.warn("Could not read workspace state, falling back to personal.", error);
    return {
      activeWorkspaceId: "personal",
      hasCompletedSelection: true
    };
  }
}

export function writeWorkspaceState(nextState: WorkspaceState): WorkspaceState {
  const parsed = workspaceStateSchema.parse(nextState);
  fs.writeFileSync(getGlobalStatePath(), JSON.stringify(parsed, null, 2), "utf8");
  return parsed;
}

export function getWorkspaceInfo(
  workspaceId: AppWorkspaceId,
  previewSeedVersion: string | null
): WorkspaceInfo {
  if (workspaceId === "preview") {
    return {
      id: "preview",
      label: "Preview workspace",
      description:
        "Seeded six-month workspace with realistic chats, notes, and graph state. Your normal account session and live cloud chat still work here.",
      localOnly: false,
      canReset: true,
      isPreview: true,
      seedVersion: previewSeedVersion
    };
  }

  return {
    id: "personal",
    label: "Personal workspace",
    description: "Your normal Trellis workspace with your own vaults, chats, and account session.",
    localOnly: false,
    canReset: false,
    isPreview: false,
    seedVersion: null
  };
}

export function listWorkspaceInfos(previewSeedVersion: string | null): WorkspaceInfo[] {
  return workspaceIds.map((workspaceId) => getWorkspaceInfo(workspaceId, previewSeedVersion));
}
