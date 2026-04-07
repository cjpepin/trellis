import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import type { AppSettings } from "@electron/ipc/types";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { RouteErrorBoundary } from "@/components/shared/RouteErrorBoundary";
import { Sidebar } from "@/components/shared/Sidebar";
import { Toast } from "@/components/shared/Toast";
import { getProfileSnapshot, hydrateStoredSession, persistSession } from "@/lib/auth";
import { applyTheme } from "@/lib/settings";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { Chat } from "@/routes/Chat";
import { Graph } from "@/routes/Graph";
import { Ingest } from "@/routes/Ingest";
import { Settings } from "@/routes/Settings";
import { Wiki } from "@/routes/Wiki";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";

const SIDEBAR_STORAGE_KEY = "trellis:sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "trellis:sidebar-collapsed";
const DEFAULT_SIDEBAR_WIDTH = 248;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COLLAPSED_WIDTH = 78;

function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

function getStoredSidebarWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  const rawValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  const parsed = Number(rawValue);

  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : DEFAULT_SIDEBAR_WIDTH;
}

function getStoredSidebarCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

function AppFrame({
  settings,
  onUpdateSettings
}: {
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      sidebarCollapsed ? "true" : "false"
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!isResizingSidebar) {
      return;
    }

    function handleMouseMove(event: MouseEvent): void {
      setSidebarWidth(clampSidebarWidth(event.clientX));
    }

    function handleMouseUp(): void {
      setIsResizingSidebar(false);
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar]);

  const displayedSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  return (
    <div className="flex h-full">
      <div
        className="relative shrink-0 transition-[width] duration-150 ease-out"
        style={{ width: displayedSidebarWidth }}
      >
        <Sidebar
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        />
        <button
          type="button"
          aria-label="Resize sidebar"
          title="Drag to resize sidebar"
          className="group absolute inset-y-0 -right-2 z-20 hidden w-4 cursor-col-resize items-center justify-center bg-transparent md:flex"
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            event.preventDefault();
            if (sidebarCollapsed) {
              setSidebarCollapsed(false);
            }
            setIsResizingSidebar(true);
          }}
          onDoubleClick={() => setSidebarCollapsed((current) => !current)}
        >
          <span className="h-20 w-px rounded-full bg-trellis-border transition group-hover:bg-trellis-accent/45" />
        </button>
      </div>
      <main className="min-w-0 flex-1">
        <Routes>
          <Route
            path="/"
            element={<Navigate to="/chat" replace />}
          />
          <Route
            path="/chat"
            element={
              <RouteErrorBoundary>
                <Chat settings={settings} onUpdateSettings={onUpdateSettings} />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/wiki"
            element={
              <RouteErrorBoundary>
                <Wiki />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/graph"
            element={
              <RouteErrorBoundary>
                <Graph />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/ingest"
            element={
              <RouteErrorBoundary>
                <Ingest />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/settings"
            element={
              <RouteErrorBoundary>
                <Settings settings={settings} onUpdateSettings={onUpdateSettings} />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </main>
      <CommandPalette />
      <Toast />
    </div>
  );
}

export default function App() {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const rememberSessionRef = useRef(true);
  const hydrateSessions = useChatStore((state) => state.hydrateSessions);
  const hydrateWiki = useWikiStore((state) => state.hydrate);
  const setConfigured = useAuthStore((state) => state.setConfigured);
  const setLoading = useAuthStore((state) => state.setLoading);
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const setAnonymous = useAuthStore((state) => state.setAnonymous);
  const setError = useAuthStore((state) => state.setError);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);

  const loadVaultSnapshot = useCallback(async (vaultId?: string): Promise<void> => {
    const snapshot = await window.trellis.vault.listIndex(vaultId);
    hydrateWiki({
      notes: snapshot.notes,
      graph: snapshot.graph
    });
  }, [hydrateWiki]);

  const handleSettingsUpdate = useCallback(async (nextSettings: AppSettings): Promise<void> => {
    const previousSettings = settings;
    const savedSettings = await window.trellis.app.updateSettings(nextSettings);
    rememberSessionRef.current = savedSettings.rememberSession;
    setSettings(savedSettings);
    applyTheme(savedSettings.theme);
    if (savedSettings.rememberSession !== previousSettings?.rememberSession && !savedSettings.rememberSession) {
      await persistSession(null);
      if (hasSupabaseConfig()) {
        await getSupabase().auth.signOut({ scope: "local" });
      }
    }
    await loadVaultSnapshot(savedSettings.activeVaultId);
  }, [loadVaultSnapshot, settings]);

  useEffect(() => {
    let cancelled = false;

    async function syncAuth(session: Session | null, rememberSession: boolean): Promise<void> {
      if (!session) {
        await persistSession(null);
        setAnonymous();
        return;
      }

      try {
        const profile = await getProfileSnapshot(session.user.id);
        try {
          await persistSession(rememberSession ? session : null);
        } catch (error) {
          console.warn("Could not persist the account session into secure storage.", error);
        }

        setAuthenticated({
          accessToken: session.access_token,
          user: {
            id: session.user.id,
            email: session.user.email ?? null
          },
          subscriptionTier: profile.subscriptionTier,
          subscriptionStatus: profile.subscriptionStatus,
          usage: profile.usage
        });
      } catch (error) {
        console.warn("Could not fully hydrate auth state, falling back to local trial defaults.", error);
        setAuthenticated({
          accessToken: session.access_token,
          user: {
            id: session.user.id,
            email: session.user.email ?? null
          },
          subscriptionTier: "trial",
          subscriptionStatus: "trialing",
          usage: {
            messagesUsed: 0,
            messageLimit: 50,
            ingestsUsed: 0,
            ingestLimit: 5
          }
        });
      }
    }

    async function bootstrap(): Promise<(() => void) | undefined> {
      if (!window.trellis?.app) {
        throw new Error(
          "The Electron preload bridge did not initialize. Try restarting the app after rebuilding."
        );
      }

      const payload = await window.trellis.app.bootstrap();

      if (cancelled) {
        return;
      }

      setSettings(payload.settings);
      rememberSessionRef.current = payload.settings.rememberSession;
      applyTheme(payload.settings.theme);
      setBootError(null);
      hydrateSessions(payload.sessions);
      hydrateWiki({
        notes: payload.notes,
        graph: payload.graph
      });
      setConfigured(hasSupabaseConfig());

      if (hasSupabaseConfig()) {
        setLoading();
        if (!payload.settings.rememberSession) {
          await persistSession(null);
          await getSupabase().auth.signOut({ scope: "local" });
        }
        const session = payload.settings.rememberSession ? await hydrateStoredSession() : null;
        await syncAuth(session, payload.settings.rememberSession);

        const {
          data: { subscription }
        } = getSupabase().auth.onAuthStateChange((_event, nextSession) => {
          void syncAuth(nextSession, rememberSessionRef.current);
        });

        if (!cancelled) {
          setIsBootstrapping(false);
        }

        return () => {
          subscription.unsubscribe();
        };
      }

      setAnonymous();
      setIsBootstrapping(false);
    }

    let cleanup: (() => void) | undefined;

    void bootstrap()
      .then((maybeCleanup) => {
        cleanup = maybeCleanup;
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Unable to bootstrap the app.";
        setBootError(message);
        setError(message);
        setIsBootstrapping(false);
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [hydrateSessions, hydrateWiki, setAnonymous, setAuthenticated, setConfigured, setError, setLoading]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    applyTheme(settings.theme);
  }, [settings]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [setCommandPaletteOpen]);

  const content = useMemo(() => {
    if (bootError) {
      return (
        <div className="flex h-full items-center justify-center px-6">
          <div className="trellis-elevated max-w-lg px-8 py-8 text-center">
            <p className="font-display text-3xl text-trellis-text">Trellis couldn’t finish booting</p>
            <p className="mt-4 text-sm leading-7 text-trellis-muted">{bootError}</p>
          </div>
        </div>
      );
    }

    if (isBootstrapping || !settings) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="trellis-elevated px-8 py-6 text-center">
            <p className="font-display text-3xl text-trellis-text">Trellis</p>
            <p className="mt-3 text-sm text-trellis-muted">Where ideas take hold.</p>
            <p className="mt-2 text-xs text-trellis-faint">Opening your vault, sessions, and graph…</p>
          </div>
        </div>
      );
    }

    return (
      <HashRouter>
        <AppFrame settings={settings} onUpdateSettings={handleSettingsUpdate} />
      </HashRouter>
    );
  }, [bootError, handleSettingsUpdate, isBootstrapping, settings]);

  return content;
}
