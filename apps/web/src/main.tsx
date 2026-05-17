import type { TrellisBridge } from "@trellis/contracts";
import { Capacitor } from "@capacitor/core";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
import { TRELLIS_VITE_DEV_STUB_MARK } from "@/lib/platform/runtime";

/**
 * Vite dev without Electron leaves `window.trellis` unset. The SPA still boots (cloud APIs + stub)
 * so `npm run dev` can load in a browser for web UI work; IPC calls hit the proxy and reject.
 */
function attachTrellisStubIfMissing(): void {
  const globalWindow = window as unknown as { trellis?: TrellisBridge };
  if (globalWindow.trellis) {
    return;
  }

  const nest = (): unknown =>
    new Proxy(() => undefined, {
      get(_target, prop) {
        if (prop === "then") {
          return undefined;
        }
        return nest();
      },
      apply() {
        return Promise.reject(new Error("This action needs the Trellis desktop app."));
      }
    });

  const stubTarget = {
    [TRELLIS_VITE_DEV_STUB_MARK]: true
  } as unknown as TrellisBridge;

  globalWindow.trellis = new Proxy(stubTarget, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === "then") {
        return undefined;
      }
      return nest();
    }
  }) as TrellisBridge;
}

attachTrellisStubIfMissing();

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("trellis-capacitor");
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
