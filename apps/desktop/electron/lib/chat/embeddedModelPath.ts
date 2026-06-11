import path from "node:path";
import { stat } from "node:fs/promises";
import { embeddedExtractionGgufFilename } from "@trellis/shared/extraction/config";
import { getUserDataRoot } from "../appPaths";

export function getEmbeddedChatModelPath(): string {
  return path.join(getUserDataRoot(), "extraction", "models", embeddedExtractionGgufFilename);
}

export async function isEmbeddedModelAvailable(): Promise<boolean> {
  try {
    const details = await stat(getEmbeddedChatModelPath());
    return details.isFile() && details.size >= 1024 * 1024;
  } catch {
    return false;
  }
}
