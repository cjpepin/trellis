/**
 * Resolves which API key to use for direct provider calls from the Electron main process
 * (cloud extraction, BYOK media): env keys by default; persisted Settings keys override when BYOK.
 */
export function resolveCloudProviderApiKey(input: {
  subscriptionTier: "trial" | "byok" | "pro";
  storedKey: string | null | undefined;
  envKey: string | null | undefined;
}): string | null {
  const stored = input.storedKey?.trim() ?? "";
  const env = input.envKey?.trim() ?? "";

  if (input.subscriptionTier === "byok" && stored.length > 0) {
    return stored;
  }
  return env.length > 0 ? env : null;
}
