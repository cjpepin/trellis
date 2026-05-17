import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { normalizeExternalHttpsUrl } from "@trellis/shared/shell/externalHttpsUrl";

/** Opens an https URL in the system browser (Electron) or a new tab (web). */
export function openExternalBridged(href: string): void {
  const externalHttps = normalizeExternalHttpsUrl(href.trim());
  if (!externalHttps) {
    return;
  }

  if (!hasElectronPreloadBridge()) {
    window.open(externalHttps, "_blank", "noopener,noreferrer");
    return;
  }

  void window.trellis.shell.openExternal(externalHttps);
}

/** Reveals a path in the OS file manager (desktop only). */
export async function openPathBridged(
  filePath: string,
  options?: { onUnavailable?: () => void }
): Promise<void> {
  const p = filePath.trim();
  if (p.length === 0) {
    return;
  }

  if (!hasElectronPreloadBridge()) {
    options?.onUnavailable?.();
    return;
  }

  await window.trellis.shell.openPath(p);
}
