import { providerForChatModel } from "@trellis/shared/chat/providerForModel";
import type { ChatProvider, ExtractionMode, ExtractionProviderId } from "../../ipc/types";
import { isCloudExtractionFeatureEnabled, isLocalExtractionFeatureEnabled } from "./rollout";

export function resolveExtractionMode(sessionModel?: string, _mode?: ExtractionMode): ExtractionMode {
  if (!isCloudExtractionFeatureEnabled()) {
    return "local";
  }
  const provider = sessionModel ? providerForChatModel(sessionModel) : null;
  if (provider) {
    return "cloud";
  }
  return "local";
}

export function buildExtractionProviderIdsForOrder(
  mode: ExtractionMode,
  chatProvider: ChatProvider | null
): ExtractionProviderId[] {
  const ids: ExtractionProviderId[] = [];
  if (mode === "cloud") {
    if (chatProvider === "openai") {
      ids.push("cloud-openai");
    } else if (chatProvider === "anthropic") {
      ids.push("cloud-anthropic");
    }
  }
  if (isLocalExtractionFeatureEnabled()) {
    ids.push("embedded");
  }
  return ids;
}
