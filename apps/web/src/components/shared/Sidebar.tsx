import { useEffect, useRef, useState } from "react";
import {
  CloudOff,
  Database,
  History,
  LayoutGrid,
  MessageSquare,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings2,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import type { AppSettings, WorkspaceInfo } from "@trellis/contracts";
import { appShellPath } from "@/lib/appRoutes";
import { deleteChatSession } from "@/lib/cloud/chat";
import { getActiveBucket } from "@/lib/settings";
import { openExternalBridged, openPathBridged } from "@/lib/shellBridged";
import { hasElectronPreloadBridge, usesTrellisHashRouter } from "@/lib/platform/runtime";
import { buildAbsoluteSiteUrl } from "@/lib/siteConfig";
import { hasSupabaseConfig } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { cn, truncate, formatTimestamp } from "@/lib/utils";
import { SessionListSkeleton } from "@/components/skeletons/WorkspaceDataSkeletons";

interface Props {
  settings: AppSettings;
  workspace: WorkspaceInfo;
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Web: cloud snapshot still loading — show session skeletons. */
  workspaceDataPending?: boolean;
  /** Capacitor: sessions + vault panel; primary nav lives in the bottom tab bar. */
  variant?: "desktop" | "mobile-drawer";
  onDrawerClose?: () => void;
}

export const SIDEBAR_PRIMARY_NAV = [
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/thoughts", label: "Thoughts", icon: Sparkles },
  { to: "/notes", label: "Strands", icon: ScrollText },
  { to: "/graph", label: "Graph", icon: Network },
  { to: "/settings", label: "Settings", icon: Settings2 }
] as const;

function buildSessionBadgeLabel(title: string): string {
  const parts = title
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "•";
  }

  if (parts.length === 1) {
    const first = parts[0];
    return first === undefined ? "•" : first.slice(0, 2).toUpperCase();
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function getSessionRunStatus(input: {
  sessionId: string;
  runningSessionIds: Set<string>;
  notificationsBySession: Record<string, "ready" | "needs_attention">;
}): { label: string; title: string; className: string } | null {
  if (input.runningSessionIds.has(input.sessionId)) {
    return {
      label: "Running",
      title: "Chat is still running",
      className: "border-trellis-accent/40 text-trellis-accent"
    };
  }

  const notification = input.notificationsBySession[input.sessionId];

  if (notification === "ready") {
    return {
      label: "Ready",
      title: "Background chat is ready",
      className: "border-trellis-success/40 text-trellis-success"
    };
  }

  if (notification === "needs_attention") {
    return {
      label: "Needs attention",
      title: "Background chat needs attention",
      className: "border-trellis-accent/40 text-trellis-accent"
    };
  }

  return null;
}

export function Sidebar({
  settings,
  workspace,
  onUpdateSettings,
  collapsed,
  onToggleCollapse,
  workspaceDataPending = false,
  variant = "desktop",
  onDrawerClose
}: Props) {
  const navigate = useNavigate();
  const vaultMenuRef = useRef<HTMLDivElement | null>(null);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [cloudLocalInfoOpen, setCloudLocalInfoOpen] = useState(false);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const isAnonymousUser = useAuthStore((state) => state.isAnonymousUser);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const chatRunsBySession = useChatStore((state) => state.chatRunsBySession);
  const chatRunNotificationsBySession = useChatStore(
    (state) => state.chatRunNotificationsBySession
  );
  const setActiveSession = useChatStore((state) => state.setActiveSession);
  const removeSession = useChatStore((state) => state.removeSession);
  const pushToast = useUiStore((state) => state.pushToast);
  const activeBucket = getActiveBucket(settings);
  const openBucketLabel =
    typeof navigator !== "undefined" && navigator.platform.includes("Mac")
      ? "Open in Finder"
      : typeof navigator !== "undefined" && navigator.platform.startsWith("Win")
      ? "Open in File Explorer"
      : "Open in Files";
  const runningSessionIds = new Set(Object.keys(chatRunsBySession));

  const showCloudLocalBanner =
    hasSupabaseConfig() &&
    hasElectronPreloadBridge() &&
    workspace.id === "personal" &&
    !workspace.isPreview &&
    (isAnonymousUser || !settings.cloudSyncEnabled);

  useEffect(() => {
    if (!vaultMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (!vaultMenuRef.current?.contains(event.target as Node)) {
        setVaultMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setVaultMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [vaultMenuOpen]);

  const isMobileDrawer = variant === "mobile-drawer";
  const effectiveCollapsed = isMobileDrawer ? false : collapsed;

  async function selectSession(sessionId: string, bucketId: string): Promise<void> {
    try {
      setActiveSession(sessionId);

      if (bucketId && bucketId !== settings.activeBucketId) {
        await onUpdateSettings({
          ...settings,
          activeBucketId: bucketId
        });
      }

      navigate(appShellPath("/chat"));
      onDrawerClose?.();
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not open that conversation.",
        tone: "warning"
      });
    }
  }

  function goToMarketingHome(): void {
    if (usesTrellisHashRouter()) {
      openExternalBridged(buildAbsoluteSiteUrl("/"));
    } else {
      navigate("/");
    }
    onDrawerClose?.();
  }

  async function confirmPendingDelete(): Promise<void> {
    const target = pendingDeleteSession;
    if (!target || deleteInFlight) {
      return;
    }

    setDeleteInFlight(true);
    try {
      await deleteChatSession(target.id);
      removeSession(target.id);
      setPendingDeleteSession(null);
      pushToast({ title: "Conversation deleted.", tone: "success" });
    } catch (error: unknown) {
      pushToast({
        title:
          error instanceof Error ? error.message : "Could not delete that conversation. Try again.",
        tone: "warning"
      });
    } finally {
      setDeleteInFlight(false);
    }
  }

  return (
    <aside
      className={cn(
        "trellis-sidebar flex h-full w-full flex-col border-trellis-border",
        isMobileDrawer ? "app-region-no-drag border-r-0 bg-trellis-sidebar" : "app-region-drag border-r"
      )}
      data-testid="app-sidebar"
    >
      {isMobileDrawer ? (
        <div className="app-region-no-drag shrink-0 border-b border-trellis-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-lg leading-tight text-trellis-text">Workspace</p>
              <p className="mt-1 text-xs leading-snug text-trellis-muted">
                Conversations and vault for this device.
              </p>
            </div>
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-field border border-trellis-border bg-trellis-surface text-trellis-muted transition hover:border-trellis-accent/35 hover:text-trellis-text"
              aria-label="Close"
              onClick={onDrawerClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {showCloudLocalBanner ? (
            <div className="mt-3">
              <button
                type="button"
                data-testid="sidebar-cloud-local-banner"
                className="flex w-full items-center gap-2 rounded-field border border-trellis-border/80 bg-trellis-surface-2 px-2.5 py-2.5 text-left text-xs text-trellis-muted transition hover:border-trellis-accent/30 hover:text-trellis-text"
                title="Strands and chats stay on this device"
                aria-label="Cloud sync is off. Learn more."
                onClick={() => {
                  setCloudLocalInfoOpen(true);
                }}
              >
                <CloudOff className="h-4 w-4 shrink-0 text-trellis-accent/90" />
                <span className="leading-snug">
                  {isAnonymousUser ? "Local only · guest" : "Cloud sync off · this device"}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={cn("border-b border-trellis-border", effectiveCollapsed ? "px-2 py-4" : "px-4 py-5")}>
          <div
            className={cn(
              "flex",
              effectiveCollapsed ? "flex-col items-center gap-3" : "items-start justify-between gap-3"
            )}
          >
            {effectiveCollapsed ? (
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-field border border-trellis-border bg-trellis-surface text-sm font-display text-trellis-text transition hover:border-trellis-accent/30 hover:text-trellis-accent"
                title="Trellis — open marketing site"
                aria-label="Open Trellis marketing site"
                onClick={goToMarketingHome}
              >
                T
              </button>
            ) : (
              <button
                type="button"
                className="min-w-0 text-left transition hover:text-trellis-accent"
                aria-label="Open Trellis marketing site"
                title="Visit trellis homepage"
                onClick={goToMarketingHome}
              >
                <p className="font-display text-3xl text-trellis-text">Trellis</p>
                <p className="mt-2 text-xs leading-5 text-trellis-muted">Where ideas take hold.</p>
              </button>
            )}
            <button
              type="button"
              className="app-region-no-drag rounded-full border border-trellis-border bg-trellis-surface px-2.5 py-2 text-trellis-muted transition hover:border-trellis-accent/35 hover:text-trellis-text"
              onClick={onToggleCollapse}
              title={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {effectiveCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>
          {showCloudLocalBanner ? (
            <div className="app-region-no-drag mt-3">
              <button
                type="button"
                data-testid="sidebar-cloud-local-banner"
                className={cn(
                  "flex w-full items-center gap-2 rounded-field border border-trellis-border/80 bg-trellis-surface-2 px-2.5 py-2 text-left text-xs text-trellis-muted transition hover:border-trellis-accent/30 hover:text-trellis-text",
                  effectiveCollapsed && "justify-center px-0"
                )}
                title="Strands and chats stay on this device"
                aria-label="Cloud sync is off. Learn more."
                onClick={() => {
                  setCloudLocalInfoOpen(true);
                }}
              >
                <CloudOff className="h-4 w-4 shrink-0 text-trellis-accent/90" />
                {!effectiveCollapsed && (
                  <span className="leading-snug">
                    {isAnonymousUser ? "Local only · guest" : "Cloud sync off · this device"}
                  </span>
                )}
              </button>
            </div>
          ) : null}
        </div>
      )}
      {cloudLocalInfoOpen ? (
        <div
          className="app-region-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cloud-local-info-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => {
              setCloudLocalInfoOpen(false);
            }}
          />
          <div className="relative z-10 max-w-md rounded-panel border border-trellis-border bg-trellis-surface px-5 py-5 shadow-lg">
            <p id="cloud-local-info-title" className="font-display text-lg text-trellis-text">
              Your Strands are not syncing
            </p>
            <p className="mt-3 text-sm leading-6 text-trellis-muted">
              {isAnonymousUser
                ? "You’re using Trellis as a guest. Guest web access uses a smaller daily limit, and Strands and chat history stay on this computer until you create an account and turn on cloud sync."
                : "Cloud sync is turned off. Strands and local chat history stay on this device. Hosted chat still follows your plan limits. Turn sync on in Settings whenever you want this workspace on web or your other devices."}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-field border border-trellis-border px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
                onClick={() => {
                  setCloudLocalInfoOpen(false);
                }}
              >
                Close
              </button>
              <button
                type="button"
                className="trellis-accent-button rounded-field border px-3 py-2 text-sm transition"
                onClick={() => {
                  setCloudLocalInfoOpen(false);
                  navigate(appShellPath("/settings"));
                  onDrawerClose?.();
                }}
              >
                {isAnonymousUser ? "Create account or sign in" : "Open Settings"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingDeleteSession ? (
        <div
          className="app-region-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sidebar-delete-session-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => {
              if (!deleteInFlight) {
                setPendingDeleteSession(null);
              }
            }}
          />
          <div className="relative z-10 max-w-md rounded-panel border border-trellis-border bg-trellis-surface px-5 py-5 shadow-lg">
            <p id="sidebar-delete-session-title" className="font-display text-lg text-trellis-text">
              Delete this conversation?
            </p>
            <p className="mt-3 text-sm leading-6 text-trellis-muted">
              &ldquo;
              {truncate(pendingDeleteSession.title, 80)}
              &rdquo; will be removed from this workspace. Strands you already saved stay in your vault.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-field border border-trellis-border px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
                disabled={deleteInFlight}
                onClick={() => {
                  setPendingDeleteSession(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="sidebar-delete-session-confirm"
                className="rounded-field border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-trellis-text transition hover:border-red-500/55 disabled:opacity-50"
                disabled={deleteInFlight}
                onClick={() => {
                  void confirmPendingDelete();
                }}
              >
                {deleteInFlight ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {!isMobileDrawer ? (
        <nav
          className={cn(
            "app-region-no-drag border-b border-trellis-border",
            effectiveCollapsed ? "px-2 py-4" : "px-3 py-4"
          )}
        >
          <div className={cn("mb-3 flex items-center", effectiveCollapsed ? "justify-center" : "gap-2 px-2")}>
            <LayoutGrid className="h-3.5 w-3.5 text-trellis-faint" />
            {!effectiveCollapsed && (
              <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Navigate</p>
            )}
          </div>
          <div className="space-y-1">
            {SIDEBAR_PRIMARY_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={appShellPath(item.to)}
                  title={item.label}
                  data-testid={`sidebar-nav-${item.to.slice(1)}`}
                  className={({ isActive }) =>
                    `flex items-center rounded-field text-sm transition ${
                      effectiveCollapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
                    } ${
                      isActive
                        ? "bg-trellis-surface text-trellis-text"
                        : "text-trellis-muted hover:bg-trellis-surface hover:text-trellis-text"
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {!effectiveCollapsed && item.label}
                </NavLink>
              );
            })}
          </div>
        </nav>
      ) : null}
      <div
        className={cn(
          "app-region-no-drag min-h-0 flex-1 overflow-y-auto",
          effectiveCollapsed ? "px-2 py-3" : "px-3 py-3"
        )}
      >
        <div className={cn("mb-2 flex items-center", effectiveCollapsed ? "justify-center" : "justify-between")}>
          <div className={cn("flex items-center", effectiveCollapsed ? "justify-center" : "gap-2")}>
            <History className="h-3.5 w-3.5 text-trellis-faint" />
            {!effectiveCollapsed && (
              <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Sessions</p>
            )}
          </div>
          {!effectiveCollapsed && !workspaceDataPending && (
            <p className="text-xs text-trellis-faint">{sessions.length}</p>
          )}
        </div>
        <div className={cn(effectiveCollapsed ? "flex flex-col items-center gap-1.5" : "space-y-0")}>
          {workspaceDataPending ? (
            <SessionListSkeleton rows={6} collapsed={effectiveCollapsed} />
          ) : effectiveCollapsed
            ? (
                <>
                  {sessions.slice(0, 5).map((session) => (
                    (() => {
                      const status = getSessionRunStatus({
                        sessionId: session.id,
                        runningSessionIds,
                        notificationsBySession: chatRunNotificationsBySession
                      });

                      return (
                        <button
                          key={session.id}
                          type="button"
                          title={status ? `${session.title} — ${status.title}` : session.title}
                          className={cn(
                            "relative flex h-9 w-9 items-center justify-center rounded-field border text-[11px] font-medium tracking-[0.08em] transition",
                            activeSessionId === session.id
                              ? "trellis-selected-surface border-trellis-accent/25 text-trellis-text"
                              : "border-transparent bg-transparent text-trellis-muted hover:border-trellis-border hover:bg-trellis-surface hover:text-trellis-text"
                          )}
                          onClick={() => {
                            void selectSession(session.id, session.bucketId);
                          }}
                        >
                          {buildSessionBadgeLabel(session.title)}
                          {status ? (
                            <span
                              data-testid={`chat-session-status-${session.id}`}
                              className={cn(
                                "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border bg-trellis-surface",
                                status.className
                              )}
                            />
                          ) : null}
                        </button>
                      );
                    })()
                  ))}
                  {sessions.length > 5 && (
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-field border border-dashed border-trellis-border text-[11px] font-medium text-trellis-faint"
                      title={`${sessions.length - 5} more conversations`}
                    >
                      +{Math.min(sessions.length - 5, 99)}
                    </div>
                  )}
                </>
              )
            : sessions.map((session) => {
                const status = getSessionRunStatus({
                  sessionId: session.id,
                  runningSessionIds,
                  notificationsBySession: chatRunNotificationsBySession
                });

                const runBlocked = runningSessionIds.has(session.id);

                return (
                  <div
                    key={session.id}
                    role="presentation"
                    className={cn(
                      "group flex w-full items-start gap-0 rounded-field border text-left transition",
                      isMobileDrawer ? "min-h-[52px]" : "",
                      activeSessionId === session.id
                        ? "trellis-selected-surface border-trellis-accent/25"
                        : "border-transparent bg-transparent hover:border-trellis-border hover:bg-trellis-surface"
                    )}
                  >
                    <button
                      type="button"
                      title={status?.title ?? session.title}
                      className={cn(
                        "min-w-0 flex-1 px-3 text-left text-trellis-text transition",
                        isMobileDrawer ? "py-3" : "py-1"
                      )}
                      onClick={() => {
                        void selectSession(session.id, session.bucketId);
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="min-w-0 flex-1 text-[13px] leading-4 text-trellis-text">
                          {truncate(session.title, 28)}
                        </p>
                        {status ? (
                          <span
                            data-testid={`chat-session-status-${session.id}`}
                            className={cn(
                              "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] leading-3",
                              status.className
                            )}
                          >
                            {status.label}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] leading-4 text-trellis-muted">
                        {formatTimestamp(session.updatedAt)}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete conversation “${session.title}”`}
                      data-testid={`chat-session-delete-trigger-${session.id}`}
                      disabled={runBlocked}
                      title={
                        runBlocked
                          ? "Wait for the in-progress reply to finish"
                          : "Delete conversation"
                      }
                      className={cn(
                        "shrink-0 self-start rounded-field border border-transparent p-2 text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text disabled:cursor-not-allowed disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100",
                        isMobileDrawer ? "mt-2" : "mt-1"
                      )}
                      onClick={() => {
                        setPendingDeleteSession({ id: session.id, title: session.title });
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                );
              })}

          {!workspaceDataPending && sessions.length === 0 && (
            effectiveCollapsed ? (
              <div className="flex h-9 w-9 items-center justify-center rounded-field border border-dashed border-trellis-border text-trellis-faint">
                <MessageSquare className="h-4 w-4" />
              </div>
            ) : (
              <div className="rounded-field border border-dashed border-trellis-border px-3 py-4 text-sm text-trellis-muted">
                Conversations you start will show up here.
              </div>
            )
          )}
        </div>
      </div>
      <div
        ref={vaultMenuRef}
        className={cn(
          "app-region-no-drag relative shrink-0 border-t border-trellis-border",
          effectiveCollapsed ? "px-2 py-4" : "px-4 py-4"
        )}
      >
        {vaultMenuOpen ? (
          <div
            className={cn(
              "absolute bottom-full left-2 z-20 mb-3 w-[min(16rem,calc(100vw-1rem))] max-h-[min(18rem,calc(100vh-2rem))] overflow-y-auto rounded-panel border border-trellis-border bg-trellis-surface px-3 py-3 shadow-lg"
            )}
          >
            <p className="text-[11px] uppercase tracking-[0.18em] text-trellis-faint">Vault source</p>
            <p className="mt-2 truncate text-sm text-trellis-text">{activeBucket.name}</p>
            <p className="mt-1 break-all text-xs leading-5 text-trellis-muted">{activeBucket.path}</p>
            {hasElectronPreloadBridge() ? (
              <button
                type="button"
                className="mt-3 w-full rounded-field border border-trellis-border px-3 py-2 text-left text-sm text-trellis-muted transition hover:border-trellis-accent/30 hover:text-trellis-text"
                onClick={() => {
                  setVaultMenuOpen(false);
                  void openPathBridged(activeBucket.path, {
                    onUnavailable: () => {
                      pushToast({
                        title: "Opening folders on disk is available in the Trellis desktop app.",
                        tone: "default"
                      });
                    }
                  });
                }}
              >
                {openBucketLabel}
              </button>
            ) : null}
          </div>
        ) : null}
        {effectiveCollapsed ? (
          <div className="flex justify-center">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-field border border-trellis-border bg-trellis-surface text-trellis-muted transition hover:border-trellis-accent/30 hover:text-trellis-text"
              title={`${activeBucket.name}\n${activeBucket.path}`}
              aria-label="Open vault menu"
              onClick={() => {
                setVaultMenuOpen((current) => !current);
              }}
            >
              <Database className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-trellis-muted">
              <button
                type="button"
                className="inline-flex items-center rounded-field border border-transparent p-1 text-trellis-muted transition hover:border-trellis-accent/30 hover:text-trellis-text"
                aria-label="Open vault menu"
                title="Vault options"
                onClick={() => {
                  setVaultMenuOpen((current) => !current);
                }}
              >
                <Database className="h-3.5 w-3.5" />
              </button>
              <span className="truncate">{activeBucket.name}</span>
            </div>
            <p className="mt-2 truncate text-xs text-trellis-faint">{activeBucket.path}</p>
          </>
        )}
      </div>
    </aside>
  );
}
