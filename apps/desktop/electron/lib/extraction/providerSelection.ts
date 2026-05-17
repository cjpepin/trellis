import type { ExtractionProviderId, ExtractionRuntimeStatus } from "../../ipc/types";

export function pickSelectedProviderId(
  status: ExtractionRuntimeStatus["providers"]
): ExtractionProviderId | null {
  const available = status.filter((provider) => provider.available);
  return available[0]?.id ?? null;
}
