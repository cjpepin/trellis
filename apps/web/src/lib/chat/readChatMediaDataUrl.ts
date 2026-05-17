import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { getWebMediaDataUrl } from "@/lib/webMediaCache";

export async function readChatMediaDataUrl(fileId: string): Promise<string | null> {
  const web = getWebMediaDataUrl(fileId);
  if (web) {
    return web;
  }
  if (hasElectronPreloadBridge()) {
    return window.trellis.media.readDataUrl(fileId);
  }
  return null;
}
