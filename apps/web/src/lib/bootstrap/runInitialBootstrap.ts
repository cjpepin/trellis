import type { Session } from "@supabase/supabase-js";
import type { AppBootstrap } from "@trellis/contracts";
import { authLog } from "@/lib/auth";
import { buildWebPlaceholderBootstrap } from "@/lib/bootstrap/webPlaceholder";
import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const AUTH_LISTENER_DEBOUNCE_MS = 120;

/**
 * Defer and debounce auth state handling so we never call `syncAuth` synchronously from inside
 * `onAuthStateChange` (see Supabase: avoid `await` / other `auth` calls inside that callback
 * to prevent re-entrancy and event storms, especially in WKWebView / Capacitor). Debouncing also
 * collapses bursty events that would flood the Capacitor `console` bridge (native IPC throttling).
 */
function subscribeAuthStateChangeDeferred(
  getRememberSession: () => boolean,
  syncAuth: (session: Session | null, rememberSession: boolean) => Promise<void>
): {
  data: { subscription: { unsubscribe: () => void } };
} {
  let latest: Session | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const result = getSupabase().auth.onAuthStateChange((_event, nextSession) => {
    latest = nextSession ?? null;
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const session = latest;
      void syncAuth(session, getRememberSession());
    }, AUTH_LISTENER_DEBOUNCE_MS);
  });

  const innerUnsub = result.data.subscription.unsubscribe;
  return {
    data: {
      subscription: {
        unsubscribe: () => {
          if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          innerUnsub();
        }
      }
    }
  };
}

export type RunInitialBootstrapOptions = {
  cancelled: () => boolean;
  getRememberSession: () => boolean;
  applyBootstrapPayload: (payload: AppBootstrap) => void;
  setLoading: () => void;
  setBootstrappingComplete: () => void;
  syncAuth: (session: Session | null, rememberSession: boolean) => Promise<void>;
  refreshAuthForWorkspace: (payload: AppBootstrap) => Promise<void>;
};

/**
 * First-load bootstrap: web placeholder + Supabase auth, or Electron IPC bootstrap (+ optional Supabase).
 * Returns an unsubscribe cleanup when auth subscriptions were registered.
 */
export async function runInitialBootstrap(
  options: RunInitialBootstrapOptions
): Promise<(() => void) | undefined> {
  const {
    cancelled,
    getRememberSession,
    applyBootstrapPayload,
    setLoading,
    setBootstrappingComplete,
    syncAuth,
    refreshAuthForWorkspace
  } = options;

  if (!hasElectronPreloadBridge()) {
    if (!hasSupabaseConfig()) {
      throw new Error(
        "This web build needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the environment."
      );
    }

    const placeholder = buildWebPlaceholderBootstrap();
    applyBootstrapPayload(placeholder);
    setLoading();

    const {
      data: { subscription }
    } = subscribeAuthStateChangeDeferred(getRememberSession, syncAuth);

    await refreshAuthForWorkspace(placeholder);

    if (cancelled()) {
      subscription.unsubscribe();
      return;
    }

    setBootstrappingComplete();

    return () => {
      subscription.unsubscribe();
    };
  }

  if (!window.trellis?.app) {
    throw new Error(
      "The Electron preload bridge did not initialize. Try restarting the app after rebuilding."
    );
  }

  authLog("bootstrap: ipc payload requested");
  const payload = await window.trellis.app.bootstrap();
  authLog("bootstrap: ipc payload received", { workspaceId: payload.workspace.id });

  if (cancelled()) {
    return;
  }

  applyBootstrapPayload(payload);
  if (hasSupabaseConfig()) {
    const {
      data: { subscription }
    } = subscribeAuthStateChangeDeferred(getRememberSession, syncAuth);

    // This path only runs with a real `window.trellis.app` (desktop). IPC bootstrap already
    // hydrated local sessions/wiki; do not block the shell on Supabase session restore or
    // profile fetch (offline/slow networks). Web/Capacitor use the branch above.
    if (!cancelled()) {
      setBootstrappingComplete();
    }
    void refreshAuthForWorkspace(payload).catch((error) => {
      console.warn("Auth refresh failed after Electron bootstrap.", error);
    });
    return () => {
      subscription.unsubscribe();
    };
  }

  await refreshAuthForWorkspace(payload);

  if (!cancelled()) {
    setBootstrappingComplete();
  }

  return undefined;
}
