import type { AppWorkspaceId } from "@trellis/contracts";
import { getTrellisApiClient } from "@/lib/cloud/client";
import { isDemoMode } from "@/lib/demo/config";
import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { hasSupabaseConfig } from "@/lib/supabase";

interface CloudWorkspaceRuntime {
  localWorkspaceId: AppWorkspaceId;
  cloudWorkspaceId: string;
}

let activeRuntime: CloudWorkspaceRuntime | null = null;

let ensureCloudWorkspaceInFlight: Promise<string> | null = null;

/** Synced from `App` so lazy `ensureCloudWorkspaceId` matches the active Trellis workspace. */
let localWorkspaceIdHint: AppWorkspaceId = "personal";

export function setCloudBridgeLocalWorkspaceHint(id: AppWorkspaceId): void {
  localWorkspaceIdHint = id;
}

export function setActiveCloudWorkspaceRuntime(runtime: CloudWorkspaceRuntime | null): void {
  activeRuntime = runtime;
}

export function getActiveCloudWorkspaceRuntime(): CloudWorkspaceRuntime | null {
  return activeRuntime;
}

export function isCloudWorkspaceActive(localWorkspaceId?: AppWorkspaceId): boolean {
  if (!activeRuntime) {
    return false;
  }

  if (localWorkspaceId === undefined) {
    return true;
  }

  return activeRuntime.localWorkspaceId === localWorkspaceId;
}

/**
 * When the SPA boots (web/Capacitor), `App` may not have finished `syncCloudWorkspace` yet.
 * Chat and other bridged calls must not fall through to `window.trellis` IPC stubs during that gap.
 * Call `app-bootstrap` once (deduped) and mirror the runtime state `App` would set.
 */
export async function ensureCloudWorkspaceId(
  preferredLocalWorkspaceId: AppWorkspaceId = localWorkspaceIdHint
): Promise<string> {
  if (isDemoMode()) {
    throw new Error("Cloud workspace is disabled in portfolio demo mode.");
  }

  const existing = activeRuntime?.cloudWorkspaceId;
  if (existing) {
    return existing;
  }

  if (hasElectronPreloadBridge()) {
    throw new Error("Cloud workspace bootstrap is only used outside the Electron bridge.");
  }

  if (!hasSupabaseConfig()) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  if (ensureCloudWorkspaceInFlight) {
    return ensureCloudWorkspaceInFlight;
  }

  ensureCloudWorkspaceInFlight = (async () => {
    const bootstrap = await getTrellisApiClient().bootstrap();
    const cloudWorkspaceId = bootstrap.activeWorkspaceId;
    setActiveCloudWorkspaceRuntime({
      localWorkspaceId: preferredLocalWorkspaceId,
      cloudWorkspaceId
    });
    return cloudWorkspaceId;
  })();

  try {
    return await ensureCloudWorkspaceInFlight;
  } finally {
    ensureCloudWorkspaceInFlight = null;
  }
}
