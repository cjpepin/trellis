/**
 * Applies `platform.cloudSyncEnabled` from cloud user preferences when present.
 */
export function mergeCloudSyncEnabledFromPlatform(
  current: boolean,
  platform: Record<string, unknown> | undefined
): boolean {
  const raw = platform?.cloudSyncEnabled;
  return typeof raw === "boolean" ? raw : current;
}
