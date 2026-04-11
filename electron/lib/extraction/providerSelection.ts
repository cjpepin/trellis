import type { ExtractionRuntimeStatus } from "../../ipc/types";

export function pickSelectedProviderId(status: ExtractionRuntimeStatus["providers"]) {
  const available = status.filter((provider) => provider.available);
  return available.find((provider) => provider.id === "embedded")?.id ?? null;
}
