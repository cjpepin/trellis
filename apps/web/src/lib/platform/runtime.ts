import type { TrellisBridge } from "@trellis/contracts";
import { Capacitor } from "@capacitor/core";

/**
 * Present only on the Vite browser stub in `main.tsx`. The real Electron preload must not set this.
 */
export const TRELLIS_VITE_DEV_STUB_MARK = Symbol.for("trellis.viteDevStub");

export function isTrellisViteDevStubBridge(bridge: TrellisBridge | undefined): boolean {
  if (!bridge) {
    return false;
  }
  return (bridge as TrellisBridge & { [TRELLIS_VITE_DEV_STUB_MARK]?: boolean })[
    TRELLIS_VITE_DEV_STUB_MARK
  ] === true;
}

/**
 * True when the Electron preload exposed a real `window.trellis.app` (desktop build).
 * The Vite dev stub is excluded via {@link TRELLIS_VITE_DEV_STUB_MARK} so `npm run dev` in a browser
 * cannot be mistaken for Electron even if the stub's proxy returns nested truthy values.
 */
export function hasElectronPreloadBridge(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const bridge = window.trellis;
  if (!bridge || isTrellisViteDevStubBridge(bridge)) {
    return false;
  }

  return Boolean(bridge.app);
}

/** True in Capacitor iOS/Android shells (WKWebView); the SPA runs without Electron preload. */
export function isCapacitorNativeApp(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return Capacitor.isNativePlatform();
}

/**
 * Hash routing matches file://-style origins and Capacitor’s embedded server; browser web keeps HTML5 history.
 */
export function usesTrellisHashRouter(): boolean {
  return hasElectronPreloadBridge() || isCapacitorNativeApp();
}
