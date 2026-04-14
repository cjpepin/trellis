import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import type {
  AppBootstrap,
  AppFeatureFlags,
  AppSettings,
  AppWorkspaceId,
  WorkspaceInfo
} from "@electron/ipc/types";
import { WorkspaceChooser } from "@/components/setup/WorkspaceChooser";
import { LocalNoteProcessorFirstRun } from "@/components/setup/LocalNoteProcessorFirstRun";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { RouteErrorBoundary } from "@/components/shared/RouteErrorBoundary";
import { Sidebar } from "@/components/shared/Sidebar";
import { Toast } from "@/components/shared/Toast";
import { getProfileSnapshot, hydrateStoredSession, persistSession } from "@/lib/auth";
import { applyTheme, getActiveVault } from "@/lib/settings";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { parallelChatLimitMessage } from "@/lib/chatRunState";
import {
  readWorkspaceLocalStorage,
  setActiveWorkspaceId,
  writeWorkspaceLocalStorage
} from "@/lib/workspace";
import { Chat } from "@/routes/Chat";
import { Graph } from "@/routes/Graph";
import { Settings } from "@/routes/Settings";
import { Thoughts } from "@/routes/Thoughts";
import { Wiki } from "@/routes/Wiki";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { useThoughtStore } from "@/store/thoughtStore";
import { useWikiStore } from "@/store/wikiStore";

const SIDEBAR_STORAGE_KEY = "sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "sidebar-collapsed";
const DEFAULT_SIDEBAR_WIDTH = 248;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COLLAPSED_WIDTH = 78;

function LegacyWikiNotesRedirect(): JSX.Element {
  const { search } = useLocation();
  return <Navigate to={`/notes${search}`} replace />;
}

function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

function getStoredSidebarWidth(): number {
  const rawValue = readWorkspaceLocalStorage(SIDEBAR_STORAGE_KEY);
  const parsed = Number(rawValue);

  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : DEFAULT_SIDEBAR_WIDTH;
}

function getStoredSidebarCollapsed(): boolean {
  return readWorkspaceLocalStorage(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

function AppFrame({
  settings,
  features,
  workspace,
  workspaces,
  onUpdateSettings,
  onRefreshVault,
  onSwitchWorkspace,
  onResetPreview
}: {
  settings: AppSettings;
  features: AppFeatureFlags;
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
  onRefreshVault: (vaultId?: string) => Promise<void>;
  onSwitchWorkspace: (workspaceId: AppWorkspaceId) => Promise<void>;
  onResetPreview: () => Promise<void>;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const upsertThought = useThoughtStore((state) => state.upsertThought);

  useEffect(() => {
    const vaultId = getActiveVault(settings).id;

    return window.trellis.thoughts.onThoughtUpdated((payload) => {
      if (payload.vaultId !== vaultId) {
        return;
      }

      upsertThought(payload.thought);
    });
  }, [settings, upsertThought]);

  useEffect(() => {
    setActiveWorkspaceId(workspace.id);
    setSidebarWidth(getStoredSidebarWidth());
    setSidebarCollapsed(getStoredSidebarCollapsed());
  }, [workspace.id]);

  useEffect(() => {
    writeWorkspaceLocalStorage(SIDEBAR_STORAGE_KEY, String(sidebarWidth), workspace.id);
  }, [sidebarWidth, workspace.id]);

  useEffect(() => {
    writeWorkspaceLocalStorage(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      sidebarCollapsed ? "true" : "false",
      workspace.id
    );
  }, [sidebarCollapsed, workspace.id]);

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
    <div className="flex h-full" data-testid="app-frame">
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
          className="app-region-no-drag group absolute inset-y-0 -right-2 z-20 hidden w-4 cursor-col-resize items-center justify-center bg-transparent md:flex"
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
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route
            path="/chat"
            element={
              <RouteErrorBoundary>
                <Chat
                  settings={settings}
                  features={features}
                  workspace={workspace}
                  onUpdateSettings={onUpdateSettings}
                  onSwitchWorkspace={onSwitchWorkspace}
                />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/thoughts"
            element={
              <RouteErrorBoundary>
                <Thoughts settings={settings} />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/notes"
            element={
              <RouteErrorBoundary>
                <Wiki workspaceId={workspace.id} />
              </RouteErrorBoundary>
            }
          />
          <Route path="/wiki" element={<LegacyWikiNotesRedirect />} />
          <Route
            path="/graph"
            element={
              <RouteErrorBoundary>
                <Graph />
              </RouteErrorBoundary>
            }
          />
          <Route path="/ingest" element={<Navigate to="/chat" replace />} />
          <Route
            path="/settings"
            element={
              <RouteErrorBoundary>
                <Settings
                  settings={settings}
                  features={features}
                  workspace={workspace}
                  workspaces={workspaces}
                  onUpdateSettings={onUpdateSettings}
                  onRefreshVault={onRefreshVault}
                  onSwitchWorkspace={onSwitchWorkspace}
                  onResetPreview={onResetPreview}
                />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </main>
      <CommandPalette
        workspace={workspace}
        workspaces={workspaces}
        onSwitchWorkspace={onSwitchWorkspace}
        onResetPreview={onResetPreview}
      />
      <Toast />
    </div>
  );
}

export default function App() {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [features, setFeatures] = useState<AppFeatureFlags | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [needsWorkspaceChoice, setNeedsWorkspaceChoice] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const rememberSessionRef = useRef(true);
  const workspaceRef = useRef<WorkspaceInfo | null>(null);
  const hydrateWorkspace = useChatStore((state) => state.hydrateWorkspace);
  const hydrateSessions = useChatStore((state) => state.hydrateSessions);
  const hydrateWiki = useWikiStore((state) => state.hydrate);
  const hydrateThoughts = useThoughtStore((state) => state.hydrate);
  const setConfigured = useAuthStore((state) => state.setConfigured);
  const setLoading = useAuthStore((state) => state.setLoading);
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const setProviderKeys = useAuthStore((state) => state.setProviderKeys);
  const setAnonymous = useAuthStore((state) => state.setAnonymous);
  const setError = useAuthStore((state) => state.setError);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const pushToast = useUiStore((state) => state.pushToast);
  const runningChatCount = useChatStore((state) => Object.keys(state.chatRunsBySession).length);

  const loadVaultSnapshot = useCallback(async (vaultId?: string): Promise<void> => {
    const snapshot = await window.trellis.vault.listIndex(vaultId);
    hydrateWiki(
      {
        notes: snapshot.notes,
        folders: snapshot.folders,
        graph: snapshot.graph
      },
      { preserveActiveNote: true }
    );
    await hydrateThoughts(snapshot.vaultId);
  }, [hydrateThoughts, hydrateWiki]);

  const applyBootstrapPayload = useCallback(
    (payload: AppBootstrap) => {
      setActiveWorkspaceId(payload.workspace.id);
      setSettings(payload.settings);
      setFeatures(payload.features);
      setWorkspace(payload.workspace);
      workspaceRef.current = payload.workspace;
      setWorkspaces(payload.workspaces);
      setProviderKeys(payload.providerKeys);
      setNeedsWorkspaceChoice(payload.needsWorkspaceChoice);
      rememberSessionRef.current = payload.settings.rememberSession;
      applyTheme(payload.settings.theme);
      setBootError(null);
      hydrateWorkspace(payload.workspace.id, payload.sessions);
      hydrateWiki({
        notes: payload.notes,
        folders: payload.folders,
        graph: payload.graph
      });
      void hydrateThoughts(payload.settings.activeVaultId);
      setConfigured(hasSupabaseConfig());
    },
    [hydrateThoughts, hydrateWiki, hydrateWorkspace, setConfigured, setProviderKeys]
  );

  const syncAuth = useCallback(
    async (session: Session | null, rememberSession: boolean): Promise<void> => {
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
          isAdmin: profile.isAdmin,
          usage: profile.usage
        });
      } catch (error) {
        console.warn(
          "Could not fully hydrate auth state, falling back to local trial defaults.",
          error
        );
        setAuthenticated({
          accessToken: session.access_token,
          user: {
            id: session.user.id,
            email: session.user.email ?? null
          },
          subscriptionTier: "trial",
          subscriptionStatus: "trialing",
          isAdmin: false,
          usage: {
            messagesUsed: 0,
            messageLimit: 8,
            trialMessageWindowResetsAt: null,
            ingestsUsed: 0,
            ingestLimit: 5
          }
        });
      }
    },
    [setAnonymous, setAuthenticated]
  );

  const refreshAuthForWorkspace = useCallback(
    async (payload: AppBootstrap): Promise<void> => {
      if (!hasSupabaseConfig()) {
        setAnonymous();
        return;
      }

      if (!payload.settings.rememberSession) {
        await persistSession(null);
        await getSupabase().auth.signOut({ scope: "local" });
      }

      const session = payload.settings.rememberSession ? await hydrateStoredSession() : null;
      await syncAuth(session, payload.settings.rememberSession);
    },
    [setAnonymous, syncAuth]
  );

  const handleSettingsUpdate = useCallback(
    async (nextSettings: AppSettings): Promise<void> => {
      const previousSettings = settings;
      const savedSettings = await window.trellis.app.updateSettings(nextSettings);
      rememberSessionRef.current = savedSettings.rememberSession;
      setSettings(savedSettings);
      applyTheme(savedSettings.theme);

      if (
        workspace &&
        savedSettings.rememberSession !== previousSettings?.rememberSession &&
        !savedSettings.rememberSession
      ) {
        await persistSession(null);
        if (hasSupabaseConfig()) {
          await getSupabase().auth.signOut({ scope: "local" });
        }
      }

      await loadVaultSnapshot(savedSettings.activeVaultId);
    },
    [loadVaultSnapshot, settings, workspace]
  );

  const handleWorkspaceSwitch = useCallback(
    async (workspaceId: AppWorkspaceId, options?: { completeSelection?: boolean }) => {
      if (runningChatCount > 0) {
        pushToast({
          title: `Wait for running chats to finish before switching workspaces. ${parallelChatLimitMessage}`,
          tone: "warning"
        });
        return;
      }

      setIsBootstrapping(true);

      try {
        const payload = await window.trellis.app.switchWorkspace({
          workspaceId,
          completeSelection: options?.completeSelection
        });
        applyBootstrapPayload(payload);
        await refreshAuthForWorkspace(payload);
      } catch (error) {
        pushToast({
          title: error instanceof Error ? error.message : "Could not switch workspaces.",
          tone: "warning"
        });
      } finally {
        setIsBootstrapping(false);
      }
    },
    [applyBootstrapPayload, pushToast, refreshAuthForWorkspace, runningChatCount]
  );

  const handleResetPreview = useCallback(async () => {
    if (runningChatCount > 0) {
      pushToast({
        title: `Wait for running chats to finish before resetting the preview workspace. ${parallelChatLimitMessage}`,
        tone: "warning"
      });
      return;
    }

    setIsBootstrapping(true);

    try {
      const payload = await window.trellis.app.resetPreviewWorkspace();
      applyBootstrapPayload(payload);
      await refreshAuthForWorkspace(payload);
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not reset the preview workspace.",
        tone: "warning"
      });
    } finally {
      setIsBootstrapping(false);
    }
  }, [applyBootstrapPayload, pushToast, refreshAuthForWorkspace, runningChatCount]);

  useEffect(() => {
    let cancelled = false;

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

      applyBootstrapPayload(payload);
      if (hasSupabaseConfig()) {
        setLoading();
      }
      await refreshAuthForWorkspace(payload);

      if (!hasSupabaseConfig()) {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
        return;
      }

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

    let cleanup: (() => void) | undefined;

    void bootstrap()
      .then((maybeCleanup) => {
        cleanup = maybeCleanup;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unable to bootstrap the app.";
        setBootError(message);
        setError(message);
        setIsBootstrapping(false);
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [
    applyBootstrapPayload,
    setError,
    setLoading,
    refreshAuthForWorkspace,
    syncAuth
  ]);

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

  useEffect(() => {
    if (!settings) {
      return;
    }

    return window.trellis.extraction.onJobUpdate((notification) => {
      if (notification.status === "completed") {
        if (notification.appliedUpdateCount > 0) {
          const maxLinks = 3;
          const applied = notification.appliedNotes ?? [];
          const completedTitle =
            notification.trigger === "manual"
              ? "Chat saved to your Strands"
              : `✦ ${notification.appliedUpdateCount} Strands updated`;
          pushToast({
            title: completedTitle,
            tone: "success",
            ...(applied.length > 0
              ? {
                  noteLinks: applied.slice(0, maxLinks).map((note) => ({
                    label: note.title,
                    noteSlug: note.slug
                  }))
                }
              : {})
          });

          if (notification.vaultId === settings.activeVaultId) {
            void loadVaultSnapshot(notification.vaultId).catch((error) => {
              pushToast({
                title:
                  error instanceof Error
                    ? error.message
                    : "Could not refresh your Strands after processing.",
                tone: "warning"
              });
            });
          }
        }

        void window.trellis.db.listSessions().then(hydrateSessions).catch(() => {
          // Session refresh failures are non-fatal; the next route load will reconcile.
        });
        return;
      }

      if (notification.status === "failed" && notification.errorMessage) {
        pushToast({
          title: notification.errorMessage,
          tone: "warning"
        });
        return;
      }

      if (notification.status === "skipped" && notification.errorMessage) {
        pushToast({
          title: notification.errorMessage,
          tone: "warning"
        });
      }
    });
  }, [settings, hydrateSessions, loadVaultSnapshot, pushToast]);

  const content = useMemo(() => {
    if (bootError) {
      return (
        <div className="flex h-full items-center justify-center px-6">
          <div className="trellis-elevated max-w-lg px-8 py-8 text-center">
            <p className="font-display text-3xl text-trellis-text">
              Trellis couldn’t finish booting
            </p>
            <p className="mt-4 text-sm leading-7 text-trellis-muted">{bootError}</p>
          </div>
        </div>
      );
    }

    if (isBootstrapping || !settings || !features || !workspace) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="trellis-elevated px-8 py-6 text-center">
            <p className="font-display text-3xl text-trellis-text">Trellis</p>
            <p className="mt-3 text-sm text-trellis-muted">Where ideas take hold.</p>
            <p className="mt-2 text-xs text-trellis-faint">
              Opening your vault, sessions, and graph…
            </p>
          </div>
        </div>
      );
    }

    if (needsWorkspaceChoice) {
      return (
        <WorkspaceChooser
          workspaces={workspaces}
          onSelect={async (workspaceId) => {
            await handleWorkspaceSwitch(workspaceId, { completeSelection: true });
          }}
        />
      );
    }

    return (
      <>
        <HashRouter key={workspace.id}>
          <AppFrame
            settings={settings}
            features={features}
            workspace={workspace}
            workspaces={workspaces}
            onUpdateSettings={handleSettingsUpdate}
            onRefreshVault={loadVaultSnapshot}
            onSwitchWorkspace={handleWorkspaceSwitch}
            onResetPreview={handleResetPreview}
          />
        </HashRouter>
        <LocalNoteProcessorFirstRun
          settings={settings}
          features={features}
        />
      </>
    );
  }, [
    bootError,
    features,
    handleResetPreview,
    handleSettingsUpdate,
    handleWorkspaceSwitch,
    isBootstrapping,
    needsWorkspaceChoice,
    settings,
    workspace,
    workspaces
  ]);

  return content;
}
