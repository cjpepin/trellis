import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { writeWebMediaCache } from "@/lib/webMediaCache";

export async function writeMediaCacheBridged(input: {
  base64: string;
  mimeType: string;
}): Promise<{ fileId: string }> {
  if (hasElectronPreloadBridge()) {
    return window.trellis.media.writeCache(input);
  }
  return { fileId: writeWebMediaCache(input.base64, input.mimeType) };
}
