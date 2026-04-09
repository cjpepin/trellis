import type { ExtractionMode, ExtractionRuntimeStatus } from "../../ipc/types";

export function pickSelectedProviderId(
  status: ExtractionRuntimeStatus["providers"],
  mode: ExtractionMode
) {
  const available = status.filter((provider) => provider.available);

  if (mode === "cloud") {
    return available.find((provider) => provider.id === "cloud")?.id ?? null;
  }

  if (mode === "local") {
    return available.find((provider) => provider.id === "embedded")?.id ?? null;
  }

  return available.find((provider) => provider.id === "embedded")?.id ??
    available.find((provider) => provider.id === "cloud")?.id ??
    null;
}
