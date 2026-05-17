import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import type {
  AppBootstrap,
  AppFeatureFlags,
  AppSettings,
  AppWorkspaceId,
  WorkspaceInfo
} from "@trellis/contracts";
import { AccountPendingDeletionModal } from "@/components/AccountPendingDeletionModal";
import { WorkspaceChooser } from "@/components/setup/WorkspaceChooser";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { MobileAppBar } from "@/components/mobile/MobileAppBar";
import { MobileBottomNav } from "@/components/mobile/MobileBottomNav";
import { MobileWorkspaceDrawer } from "@/components/mobile/MobileWorkspaceDrawer";
import { RouteErrorBoundary } from "@/components/shared/RouteErrorBoundary";
import { Sidebar } from "@/components/shared/Sidebar";
import { Toast } from "@/components/shared/Toast";
import { appShellPath } from "@/lib/appRoutes";
import { runInitialBootstrap } from "@/lib/bootstrap/runInitialBootstrap";
import {
  mergeCloudPreferencesIntoSettings,
  settingsToCloudChatJson,
  settingsToCloudPlatformJson
} from "@/lib/bootstrap/webPlaceholder";
import {
  authLog,
  consumeSuppressNextAnonymousSignIn,
  FREE_ACCOUNT_MESSAGE_LIMIT,
  getProfileSnapshot,
  GUEST_MESSAGE_LIMIT,
  hydrateStoredSession,
  persistSession,
  signInAnonymouslySession
} from "@/lib/auth";
import {
  cloudChatSessionToSummary,
  cloudBootstrapToBucketSnapshot,
  cloudProviderStatusesToSnapshot
} from "@/lib/cloud/adapters";
import { listChatSessions } from "@/lib/cloud/chat";
import { getTrellisApiClient } from "@/lib/cloud/client";
import { shouldInitialCloudBackfill } from "@/lib/cloud/mergeLocalFirst";
import { pushLocalWorkspaceToCloud } from "@/lib/cloud/pushLocalWorkspaceToCloud";
import {
  isCloudWorkspaceActive,
  setActiveCloudWorkspaceRuntime,
  setCloudBridgeLocalWorkspaceHint
} from "@/lib/cloud/runtime";
import { listBucketIndex } from "@/lib/cloud/bucket";
import { hasElectronPreloadBridge, isCapacitorNativeApp, usesTrellisHashRouter } from "@/lib/platform/runtime";
import { applyTheme, getActiveBucket } from "@/lib/settings";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { parallelChatLimitMessage } from "@/lib/chatRunState";
import { useCloudBucketRealtimeSync } from "@/hooks/useCloudBucketRealtimeSync";
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
import { PublicSiteRouter } from "@/routes/public/PublicSiteRouter";
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
  return <Navigate to={`${appShellPath("/notes")}${search}`} replace />;
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
  const raw = readWorkspaceLocalStorage(SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (raw !== null) {
    return raw === "true";
  }
  if (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("trellis-capacitor")
  ) {
    return true;
  }
  return false;
}

function AppFrame({
  settings,
  features,
  workspace,
  workspaces,
  workspaceDataPending,
  onUpdateSettings,
  onRefreshBucket,
  onSwitchWorkspace,
  onResetPreview
}: {
  settings: AppSettings;
  features: AppFeatureFlags;
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  /** Web: first cloud snapshot not applied yet; show skeletons instead of empty placeholders. */
  workspaceDataPending: boolean;
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
  onRefreshBucket: (bucketId?: string) => Promise<void>;
  onSwitchWorkspace: (workspaceId: AppWorkspaceId) => Promise<void>;
  onResetPreview: () => Promise<void>;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const upsertThought = useThoughtStore((state) => state.upsertThought);
  const isNativeShell = isCapacitorNativeApp();
  const mobileWorkspaceDrawerOpen = useUiStore((state) => state.mobileWorkspaceDrawerOpen);
  const setMobileWorkspaceDrawerOpen = useUiStore((state) => state.setMobileWorkspaceDrawerOpen);

  useEffect(() => {
    if (!hasElectronPreloadBridge() || !window.trellis?.thoughts) {
      return;
    }

    const bucketId = getActiveBucket(settings).id;

    return window.trellis.thoughts.onThoughtUpdated((payload) => {
      if (payload.bucketId !== bucketId) {
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

  const routeTree = (
    <Routes>
      <Route index element={<Navigate to={appShellPath("/chat")} replace />} />
      <Route
        path="chat"
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
        path="thoughts"
        element={
          <RouteErrorBoundary>
            <Thoughts settings={settings} />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="notes"
        element={
          <RouteErrorBoundary>
            <Wiki
              workspaceId={workspace.id}
              activeBucketId={getActiveBucket(settings).id}
              workspaceDataPending={workspaceDataPending}
            />
          </RouteErrorBoundary>
        }
      />
      <Route path="wiki" element={<LegacyWikiNotesRedirect />} />
      <Route
        path="graph"
        element={
          <RouteErrorBoundary>
            <Graph settings={settings} workspaceDataPending={workspaceDataPending} />
          </RouteErrorBoundary>
        }
      />
      <Route path="ingest" element={<Navigate to={appShellPath("/chat")} replace />} />
      <Route
        path="settings"
        element={
          <RouteErrorBoundary>
            <Settings
              settings={settings}
              features={features}
              workspace={workspace}
              workspaces={workspaces}
              onUpdateSettings={onUpdateSettings}
              onRefreshBucket={onRefreshBucket}
              onSwitchWorkspace={onSwitchWorkspace}
              onResetPreview={onResetPreview}
            />
          </RouteErrorBoundary>
        }
      />
      <Route path="*" element={<Navigate to={appShellPath("/chat")} replace />} />
    </Routes>
  );

  if (isNativeShell) {
    return (
      <div
        className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-trellis-bg"
        data-testid="app-frame"
        data-workspace-data-pending={workspaceDataPending ? "true" : undefined}
      >
        <MobileAppBar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{routeTree}</main>
        <MobileBottomNav />
        <MobileWorkspaceDrawer
          open={mobileWorkspaceDrawerOpen}
          onClose={() => {
            setMobileWorkspaceDrawerOpen(false);
          }}
        >
          <Sidebar
            variant="mobile-drawer"
            settings={settings}
            workspace={workspace}
            workspaceDataPending={workspaceDataPending}
            onUpdateSettings={onUpdateSettings}
            collapsed={false}
            onToggleCollapse={() => {}}
            onDrawerClose={() => {
              setMobileWorkspaceDrawerOpen(false);
            }}
          />
        </MobileWorkspaceDrawer>
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

  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-row overflow-hidden"
      data-testid="app-frame"
      data-workspace-data-pending={workspaceDataPending ? "true" : undefined}
    >
      <div
        className="relative shrink-0 transition-[width] duration-150 ease-out"
        style={{ width: displayedSidebarWidth }}
      >
        <Sidebar
          settings={settings}
          workspace={workspace}
          workspaceDataPending={workspaceDataPending}
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
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{routeTree}</main>
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
  const authStatus = useAuthStore((state) => state.status);
  const accessToken = useAuthStore((state) => state.accessToken);
  const isAnonymousUser = useAuthStore((state) => state.isAnonymousUser);
  const accountDeletedAt = useAuthStore((state) => state.accountDeletedAt);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const pushToast = useUiStore((state) => state.pushToast);
  const runningChatCount = useChatStore((state) => Object.keys(state.chatRunsBySession).length);
  const [cloudBackedWikiWorkspaceId, setCloudBackedWikiWorkspaceId] = useState<string | null>(null);
  const [webWorkspaceDataPending, setWebWorkspaceDataPending] = useState(
    () => hasSupabaseConfig() && !hasElectronPreloadBridge()
  );
  const syncAuthQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const cloudBackfillLaunchRef = useRef<{
    kind: "idle" | "running" | "succeeded" | "failed";
    workspaceId: string | null;
  }>({ kind: "idle", workspaceId: null });

  const loadBucketSnapshot = useCallback(async (bucketId?: string): Promise<void> => {
    const snapshot = await listBucketIndex(bucketId);
    hydrateWiki(
      {
        notes: snapshot.notes,
        folders: snapshot.folders,
        graph: snapshot.graph
      },
      { preserveActiveNote: true }
    );
    await hydrateThoughts(snapshot.bucketId);
  }, [hydrateThoughts, hydrateWiki]);

  const applyBootstrapPayload = useCallback(
    (payload: AppBootstrap) => {
      setActiveWorkspaceId(payload.workspace.id);
      setSettings(payload.settings);
      setFeatures(payload.features);
      setWorkspace(payload.workspace);
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
      void hydrateThoughts(payload.settings.activeBucketId);
      setConfigured(hasSupabaseConfig());
    },
    [hydrateThoughts, hydrateWiki, hydrateWorkspace, setConfigured, setProviderKeys]
  );

  const syncAuth = useCallback(
    (session: Session | null, rememberSession: boolean): Promise<void> => {
      const run = async (): Promise<void> => {
        authLog("syncAuth", {
          hasSession: session !== null,
          rememberSession
        });

        let activeSession = session;

        if (!activeSession) {
          await persistSession(null);
          const skipGuestBootstrap = consumeSuppressNextAnonymousSignIn();
          if (hasSupabaseConfig() && rememberSession && !skipGuestBootstrap) {
            const guestSession = await signInAnonymouslySession();
            if (guestSession) {
              activeSession = guestSession;
              authLog("syncAuth: guest session created");
            }
          }

          if (!activeSession) {
            setAnonymous();
            authLog("syncAuth: anonymous (no session)");
            return;
          }
        }

        try {
          const profile = await getProfileSnapshot(activeSession.user.id);
          try {
            await persistSession(rememberSession ? activeSession : null, rememberSession
              ? { subscriptionTier: profile.subscriptionTier }
              : undefined);
          } catch (error) {
            console.warn("Could not persist the account session into secure storage.", error);
          }

          const isAnonymousUser = activeSession.user.is_anonymous === true;

          setAuthenticated({
            accessToken: activeSession.access_token,
            user: {
              id: activeSession.user.id,
              email: activeSession.user.email ?? null
            },
            isAnonymousUser,
            subscriptionTier: profile.subscriptionTier,
            subscriptionStatus: profile.subscriptionStatus,
            isAdmin: profile.isAdmin,
            usage: {
              ...profile.usage,
              messageLimit: isAnonymousUser ? GUEST_MESSAGE_LIMIT : profile.usage.messageLimit
            },
            accountDeletedAt: profile.deletedAt
          });
          authLog("syncAuth: authenticated", {
            tier: profile.subscriptionTier,
            isAdmin: profile.isAdmin,
            guest: isAnonymousUser
          });
        } catch (error) {
          console.warn(
            "Could not fully hydrate auth state, falling back to local trial defaults.",
            error
          );
          setAuthenticated({
            accessToken: activeSession.access_token,
            user: {
              id: activeSession.user.id,
              email: activeSession.user.email ?? null
            },
            isAnonymousUser: activeSession.user.is_anonymous === true,
            subscriptionTier: "trial",
            subscriptionStatus: "trialing",
            isAdmin: false,
            usage: {
              messagesUsed: 0,
              messageLimit:
                activeSession.user.is_anonymous === true
                  ? GUEST_MESSAGE_LIMIT
                  : FREE_ACCOUNT_MESSAGE_LIMIT,
              trialMessageWindowResetsAt: null,
              ingestsUsed: 0,
              ingestLimit: 5
            },
            accountDeletedAt: null
          });
          authLog("syncAuth: authenticated (profile fallback)");
        }
      };

      const next = syncAuthQueueRef.current.then(run, run);
      syncAuthQueueRef.current = next.catch(() => {
        // Keep the queue unbroken; errors are already logged in run().
      });
      return next;
    },
    [setAnonymous, setAuthenticated]
  );

  const refreshAuthForWorkspace = useCallback(
    async (payload: AppBootstrap): Promise<void> => {
      authLog("refreshAuthForWorkspace: start", {
        rememberSession: payload.settings.rememberSession
      });
      if (!hasSupabaseConfig()) {
        setAnonymous();
        authLog("refreshAuthForWorkspace: no Supabase config, anonymous");
        return;
      }

      if (!payload.settings.rememberSession) {
        await persistSession(null);
        await getSupabase().auth.signOut({ scope: "local" });
      }

      const session = payload.settings.rememberSession ? await hydrateStoredSession() : null;
      await syncAuth(session, payload.settings.rememberSession);
      authLog("refreshAuthForWorkspace: done");
    },
    [setAnonymous, syncAuth]
  );

  const handleSettingsUpdate = useCallback(
    async (nextSettings: AppSettings): Promise<void> => {
      const previousSettings = settings;

      if (!hasElectronPreloadBridge()) {
        if (
          isCloudWorkspaceActive() &&
          hasSupabaseConfig() &&
          accessToken &&
          !isAnonymousUser
        ) {
          try {
            await getTrellisApiClient().patchUserPreferences({
              theme: nextSettings.theme,
              chat: settingsToCloudChatJson(nextSettings),
              platform: settingsToCloudPlatformJson(nextSettings)
            });
          } catch (error) {
            console.warn("Could not sync preferences to the cloud.", error);
          }
        }

        rememberSessionRef.current = nextSettings.rememberSession;
        setSettings(nextSettings);
        applyTheme(nextSettings.theme);

        if (
          workspace &&
          nextSettings.rememberSession !== previousSettings?.rememberSession &&
          !nextSettings.rememberSession
        ) {
          await persistSession(null);
          if (hasSupabaseConfig()) {
            await getSupabase().auth.signOut({ scope: "local" });
          }
        }

        await loadBucketSnapshot(nextSettings.activeBucketId);
        return;
      }

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

      if (
        hasSupabaseConfig() &&
        accessToken &&
        !isAnonymousUser &&
        isCloudWorkspaceActive()
      ) {
        try {
          await getTrellisApiClient().patchUserPreferences({
            platform: settingsToCloudPlatformJson(savedSettings)
          });
        } catch (error) {
          console.warn("Could not sync platform preferences to the cloud.", error);
        }
      }

      await loadBucketSnapshot(savedSettings.activeBucketId);
    },
    [
      accessToken,
      isAnonymousUser,
      loadBucketSnapshot,
      settings,
      workspace
    ]
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

      if (!hasElectronPreloadBridge()) {
        pushToast({
          title: "Workspace switching on web will use your cloud workspace from Settings.",
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
        void refreshAuthForWorkspace(payload).catch((error) => {
          console.warn("Auth refresh failed after workspace switch.", error);
        });
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

    if (!hasElectronPreloadBridge()) {
      pushToast({
        title: "Preview workspaces are only available in the desktop app.",
        tone: "warning"
      });
      return;
    }

    setIsBootstrapping(true);

    try {
      const payload = await window.trellis.app.resetPreviewWorkspace();
      applyBootstrapPayload(payload);
      void refreshAuthForWorkspace(payload).catch((error) => {
        console.warn("Auth refresh failed after preview reset.", error);
      });
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

    let cleanup: (() => void) | undefined;

    void runInitialBootstrap({
      cancelled: () => cancelled,
      getRememberSession: () => rememberSessionRef.current,
      applyBootstrapPayload,
      setLoading,
      setBootstrappingComplete: () => setIsBootstrapping(false),
      syncAuth,
      refreshAuthForWorkspace
    })
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
    let cancelled = false;

    async function syncCloudWorkspace(): Promise<void> {
      if (!workspace || !settings) {
        return;
      }

      if (accountDeletedAt) {
        const isWebClient = !hasElectronPreloadBridge();
        setActiveCloudWorkspaceRuntime(null);
        setCloudBackedWikiWorkspaceId(null);
        if (isWebClient) {
          setWebWorkspaceDataPending(false);
        }
        return;
      }

      setCloudBridgeLocalWorkspaceHint(workspace.id);

      if (cloudBackfillLaunchRef.current.workspaceId !== (workspace.id ?? null)) {
        cloudBackfillLaunchRef.current = { kind: "idle", workspaceId: workspace.id };
      }

      const electronPersonalCloudEligible =
        hasElectronPreloadBridge() && workspace.id === "personal";

      const cloudSyncAllowed =
        !electronPersonalCloudEligible ||
        (!isAnonymousUser && settings.cloudSyncEnabled);

      const shouldUseCloudWorkspace =
        hasSupabaseConfig() &&
        (workspace.id === "personal" || !hasElectronPreloadBridge()) &&
        authStatus === "authenticated" &&
        accessToken !== null &&
        cloudSyncAllowed;

      const isWebClient = !hasElectronPreloadBridge();

      if (!shouldUseCloudWorkspace) {
        if (isWebClient) {
          setWebWorkspaceDataPending(false);
        }
        const hadCloudWorkspace = isCloudWorkspaceActive(workspace.id);
        setActiveCloudWorkspaceRuntime(null);
        setCloudBackedWikiWorkspaceId(null);
        const localProviderKeys = window.trellis?.chat
          ? await window.trellis.chat.getProviderKeyStatus().catch(() => null)
          : null;

        if (localProviderKeys) {
          setProviderKeys(localProviderKeys);
        }

        if (hadCloudWorkspace) {
          const activeBucket = getActiveBucket(settings);
          await listChatSessions(activeBucket.id)
            .then(hydrateSessions)
            .catch(() => {
              // Keep the last successful chat session list if local fallback hydration fails.
            });
          await loadBucketSnapshot(settings.activeBucketId).catch(() => {
            // Keep the last successful wiki state if local fallback hydration fails.
          });
        }

        return;
      }

      if (isWebClient) {
        setWebWorkspaceDataPending(true);
      }

      try {
        const activeBucket = getActiveBucket(settings);
        const cloudBootstrap = await getTrellisApiClient().bootstrap();

        if (cancelled) {
          return;
        }

        setActiveCloudWorkspaceRuntime({
          localWorkspaceId: workspace.id,
          cloudWorkspaceId: cloudBootstrap.activeWorkspaceId
        });
        setCloudBackedWikiWorkspaceId(cloudBootstrap.activeWorkspaceId);
        setProviderKeys(
          cloudProviderStatusesToSnapshot(cloudBootstrap.providerCredentialStatuses)
        );
        if (hasElectronPreloadBridge() && workspace.id === "personal") {
          const [cloudMergedSessions, localForBackfill] = await Promise.all([
            listChatSessions(activeBucket.id),
            (async () => {
              if (!window.trellis?.db || !window.trellis.bucket) {
                return { sessionCount: 0, noteCount: 0, thoughtCount: 0 };
              }

              const [sessions, index, localThoughts] = await Promise.all([
                window.trellis.db.listSessions(),
                window.trellis.bucket.listIndex(activeBucket.id),
                window.trellis.db.listThoughts(activeBucket.id)
              ]);

              return {
                sessionCount: sessions.length,
                noteCount: index.notes.length,
                thoughtCount: localThoughts.length
              };
            })()
          ]);

          if (cancelled) {
            return;
          }

          hydrateSessions(cloudMergedSessions);
          await loadBucketSnapshot(activeBucket.id);

          if (cancelled) {
            return;
          }

          const canTryBackfill =
            cloudBackfillLaunchRef.current.kind === "idle" ||
            cloudBackfillLaunchRef.current.kind === "failed";
          if (
            canTryBackfill &&
            shouldInitialCloudBackfill(cloudBootstrap, {
              sessionCount: localForBackfill.sessionCount,
              noteCount: localForBackfill.noteCount,
              thoughtCount: localForBackfill.thoughtCount
            })
          ) {
            cloudBackfillLaunchRef.current = { kind: "running", workspaceId: workspace.id };
            void pushLocalWorkspaceToCloud(cloudBootstrap.activeWorkspaceId, activeBucket.id)
              .then(() => {
                cloudBackfillLaunchRef.current = { kind: "succeeded", workspaceId: workspace.id };
                void loadBucketSnapshot(activeBucket.id).catch(() => {
                  // Non-fatal; local merge is already on screen.
                });
              })
              .catch((error) => {
                console.warn("Could not upload local Trellis data to the cloud.", error);
                cloudBackfillLaunchRef.current = { kind: "failed", workspaceId: workspace.id };
              });
          }
        } else {
          hydrateWorkspace(
            workspace.id,
            cloudBootstrap.chatSessions.map((session) =>
              cloudChatSessionToSummary(session, activeBucket.id)
            )
          );

          const snapshot = cloudBootstrapToBucketSnapshot(cloudBootstrap, {
            id: activeBucket.id,
            name: activeBucket.name,
            path: activeBucket.path
          });

          hydrateWiki(
            {
              notes: snapshot.notes,
              folders: snapshot.folders,
              graph: snapshot.graph
            },
            { preserveActiveNote: true }
          );
        }

        setSettings((prev) => {
          if (!prev) {
            return prev;
          }
          const merged = mergeCloudPreferencesIntoSettings(prev, {
            theme: cloudBootstrap.preferences.theme,
            chat: cloudBootstrap.preferences.chat as Record<string, unknown>,
            platform: cloudBootstrap.preferences.platform as Record<string, unknown>
          });
          applyTheme(merged.theme);
          return merged;
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.warn("Could not switch the personal workspace onto the cloud-backed wiki.", error);
        const hadCloudWorkspace = isCloudWorkspaceActive(workspace.id);
        setActiveCloudWorkspaceRuntime(null);
        setCloudBackedWikiWorkspaceId(null);
        const localProviderKeys = window.trellis?.chat
          ? await window.trellis.chat.getProviderKeyStatus().catch(() => null)
          : null;

        if (localProviderKeys) {
          setProviderKeys(localProviderKeys);
        }

        if (hadCloudWorkspace) {
          await loadBucketSnapshot(settings.activeBucketId).catch(() => {
            // Keep the last successful wiki state if the local fallback also fails.
          });
        }
      } finally {
        if (!cancelled && isWebClient) {
          setWebWorkspaceDataPending(false);
        }
      }
    }

    void syncCloudWorkspace();

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    accountDeletedAt,
    authStatus,
    isAnonymousUser,
    hydrateSessions,
    hydrateWiki,
    hydrateWorkspace,
    loadBucketSnapshot,
    setProviderKeys,
    settings,
    workspace
  ]);

  useCloudBucketRealtimeSync({
    enabled: cloudBackedWikiWorkspaceId !== null,
    cloudWorkspaceId: cloudBackedWikiWorkspaceId,
    onRefresh: loadBucketSnapshot
  });

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

    if (!hasElectronPreloadBridge() || !window.trellis?.extraction) {
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

          if (notification.bucketId === settings.activeBucketId) {
            void loadBucketSnapshot(notification.bucketId).catch((error) => {
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

        void listChatSessions(settings.activeBucketId).then(hydrateSessions).catch(() => {
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
  }, [settings, hydrateSessions, loadBucketSnapshot, pushToast]);

  const content = useMemo(() => {
    const renderAppShell = () => {
      if (bootError) {
        return (
          <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center overflow-hidden px-6">
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
          <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center overflow-hidden">
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
          <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto">
            <WorkspaceChooser
              workspaces={workspaces}
              onSelect={async (workspaceId) => {
                await handleWorkspaceSwitch(workspaceId, { completeSelection: true });
              }}
            />
          </div>
        );
      }

      return (
        <AppFrame
          settings={settings}
          features={features}
          workspace={workspace}
          workspaces={workspaces}
          workspaceDataPending={webWorkspaceDataPending}
          onUpdateSettings={handleSettingsUpdate}
          onRefreshBucket={loadBucketSnapshot}
          onSwitchWorkspace={handleWorkspaceSwitch}
          onResetPreview={handleResetPreview}
        />
      );
    };

    const appShell = renderAppShell();

    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        {usesTrellisHashRouter() ? (
          <HashRouter key={workspace?.id ?? "trellis-shell"}>{appShell}</HashRouter>
        ) : (
          <PublicSiteRouter appShell={appShell} />
        )}
      </div>
    );
  }, [
    bootError,
    features,
    handleResetPreview,
    handleSettingsUpdate,
    handleWorkspaceSwitch,
    isBootstrapping,
    loadBucketSnapshot,
    needsWorkspaceChoice,
    settings,
    webWorkspaceDataPending,
    workspace,
    workspaces
  ]);

  return (
    <>
      {content}
      <AccountPendingDeletionModal />
    </>
  );
}
