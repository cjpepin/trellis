import { useEffect, useRef, useState } from "react";
import {
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
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import type { AppSettings } from "@electron/ipc/types";
import { getActiveVault } from "@/lib/settings";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { cn, truncate, formatTimestamp } from "@/lib/utils";

interface Props {
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const navItems = [
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/thoughts", label: "Thoughts", icon: Sparkles },
  { to: "/notes", label: "Strands", icon: ScrollText },
  { to: "/graph", label: "Graph", icon: Network },
  { to: "/settings", label: "Settings", icon: Settings2 }
];

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
  onUpdateSettings,
  collapsed,
  onToggleCollapse
}: Props) {
  const navigate = useNavigate();
  const vaultMenuRef = useRef<HTMLDivElement | null>(null);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const chatRunsBySession = useChatStore((state) => state.chatRunsBySession);
  const chatRunNotificationsBySession = useChatStore(
    (state) => state.chatRunNotificationsBySession
  );
  const setActiveSession = useChatStore((state) => state.setActiveSession);
  const pushToast = useUiStore((state) => state.pushToast);
  const activeVault = getActiveVault(settings);
  const openVaultLabel =
    typeof navigator !== "undefined" && navigator.platform.includes("Mac")
      ? "Open in Finder"
      : typeof navigator !== "undefined" && navigator.platform.startsWith("Win")
      ? "Open in File Explorer"
      : "Open in Files";
  const runningSessionIds = new Set(Object.keys(chatRunsBySession));

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

  async function selectSession(sessionId: string, vaultId: string): Promise<void> {
    try {
      setActiveSession(sessionId);

      if (vaultId && vaultId !== settings.activeVaultId) {
        await onUpdateSettings({
          ...settings,
          activeVaultId: vaultId
        });
      }

      navigate("/chat");
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not open that conversation.",
        tone: "warning"
      });
    }
  }

  return (
    <aside
      className="app-region-drag trellis-sidebar flex h-full w-full flex-col border-r border-trellis-border"
      data-testid="app-sidebar"
    >
      <div className={cn("border-b border-trellis-border", collapsed ? "px-2 py-4" : "px-4 py-5")}>
        <div className={cn("flex", collapsed ? "flex-col items-center gap-3" : "items-start justify-between gap-3")}>
          {collapsed ? (
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-field border border-trellis-border bg-trellis-surface text-sm font-display text-trellis-text transition hover:border-trellis-accent/30 hover:text-trellis-accent"
              title="Trellis"
              aria-label="Go to chat"
              onClick={() => {
                navigate("/chat");
              }}
            >
              T
            </button>
          ) : (
            <button
              type="button"
              className="min-w-0 text-left transition hover:text-trellis-accent"
              aria-label="Go to chat"
              onClick={() => {
                navigate("/chat");
              }}
            >
              <p className="font-display text-3xl text-trellis-text">Trellis</p>
              <p className="mt-2 text-xs leading-5 text-trellis-muted">Where ideas take hold.</p>
            </button>
          )}
          <button
            type="button"
            className="app-region-no-drag rounded-full border border-trellis-border bg-trellis-surface px-2.5 py-2 text-trellis-muted transition hover:border-trellis-accent/35 hover:text-trellis-text"
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      <nav className={cn("app-region-no-drag border-b border-trellis-border", collapsed ? "px-2 py-4" : "px-3 py-4")}>
        <div className={cn("mb-3 flex items-center", collapsed ? "justify-center" : "gap-2 px-2")}>
          <LayoutGrid className="h-3.5 w-3.5 text-trellis-faint" />
          {!collapsed && (
            <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Navigate</p>
          )}
        </div>
        <div className="space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              data-testid={`sidebar-nav-${item.to.slice(1)}`}
              className={({ isActive }) =>
                `flex items-center rounded-field text-sm transition ${
                  collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
                } ${
                  isActive
                    ? "bg-trellis-surface text-trellis-text"
                    : "text-trellis-muted hover:bg-trellis-surface hover:text-trellis-text"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {!collapsed && item.label}
            </NavLink>
          );
        })}
        </div>
      </nav>
      <div className={cn("app-region-no-drag flex-1 overflow-y-auto", collapsed ? "px-2 py-3" : "px-3 py-3")}>
        <div className={cn("mb-2 flex items-center", collapsed ? "justify-center" : "justify-between")}>
          <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
            <History className="h-3.5 w-3.5 text-trellis-faint" />
            {!collapsed && (
              <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Sessions</p>
            )}
          </div>
          {!collapsed && <p className="text-xs text-trellis-faint">{sessions.length}</p>}
        </div>
        <div className={cn(collapsed ? "flex flex-col items-center gap-1.5" : "space-y-0")}>
          {collapsed
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
                            void selectSession(session.id, session.vaultId);
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

                return (
                  <button
                    key={session.id}
                    type="button"
                    title={status?.title}
                    className={`w-full rounded-field border px-3 py-1 text-left transition ${
                      activeSessionId === session.id
                        ? "trellis-selected-surface border-trellis-accent/25"
                        : "border-transparent bg-transparent hover:border-trellis-border hover:bg-trellis-surface"
                    }`}
                    onClick={() => {
                      void selectSession(session.id, session.vaultId);
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
                    <p className="text-[11px] leading-4 text-trellis-muted">{formatTimestamp(session.updatedAt)}</p>
                  </button>
                );
              })}

          {sessions.length === 0 && (
            collapsed ? (
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
          "app-region-no-drag relative border-t border-trellis-border",
          collapsed ? "px-2 py-4" : "px-4 py-4"
        )}
      >
        {vaultMenuOpen ? (
          <div
            className={cn(
              "absolute bottom-full left-2 z-20 mb-3 w-[min(16rem,calc(100vw-1rem))] max-h-[min(18rem,calc(100vh-2rem))] overflow-y-auto rounded-panel border border-trellis-border bg-trellis-surface px-3 py-3 shadow-lg"
            )}
          >
            <p className="text-[11px] uppercase tracking-[0.18em] text-trellis-faint">Vault source</p>
            <p className="mt-2 truncate text-sm text-trellis-text">{activeVault.name}</p>
            <p className="mt-1 break-all text-xs leading-5 text-trellis-muted">{activeVault.path}</p>
            <button
              type="button"
              className="mt-3 w-full rounded-field border border-trellis-border px-3 py-2 text-left text-sm text-trellis-muted transition hover:border-trellis-accent/30 hover:text-trellis-text"
              onClick={() => {
                setVaultMenuOpen(false);
                void window.trellis.shell.openPath(activeVault.path);
              }}
            >
              {openVaultLabel}
            </button>
          </div>
        ) : null}
        {collapsed ? (
          <div className="flex justify-center">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-field border border-trellis-border bg-trellis-surface text-trellis-muted transition hover:border-trellis-accent/30 hover:text-trellis-text"
              title={`${activeVault.name}\n${activeVault.path}`}
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
              <span className="truncate">{activeVault.name}</span>
            </div>
            <p className="mt-2 truncate text-xs text-trellis-faint">{activeVault.path}</p>
          </>
        )}
      </div>
    </aside>
  );
}
