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
  Upload
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
  { to: "/wiki", label: "Wiki", icon: ScrollText },
  { to: "/graph", label: "Graph", icon: Network },
  { to: "/ingest", label: "Ingest", icon: Upload },
  { to: "/settings", label: "Settings", icon: Settings2 }
];

export function Sidebar({ settings, onUpdateSettings, collapsed, onToggleCollapse }: Props) {
  const navigate = useNavigate();
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const setActiveSession = useChatStore((state) => state.setActiveSession);
  const pushToast = useUiStore((state) => state.pushToast);
  const activeVault = getActiveVault(settings);

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
    <aside className="trellis-sidebar flex h-full w-full flex-col border-r border-trellis-border">
      <div className={cn("border-b border-trellis-border", collapsed ? "px-2 py-4" : "px-4 py-5")}>
        <div className={cn("flex", collapsed ? "flex-col items-center gap-3" : "items-start justify-between gap-3")}>
          {collapsed ? (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-field border border-trellis-border bg-trellis-surface text-sm font-display text-trellis-text"
              title="Trellis"
            >
              T
            </div>
          ) : (
            <div className="min-w-0">
              <p className="font-display text-3xl text-trellis-text">Trellis</p>
              <p className="mt-2 text-xs leading-5 text-trellis-muted">Where ideas take hold.</p>
            </div>
          )}
          <button
            type="button"
            className="rounded-full border border-trellis-border bg-trellis-surface px-2.5 py-2 text-trellis-muted transition hover:border-trellis-accent/35 hover:text-trellis-text"
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
      <nav className={cn("border-b border-trellis-border", collapsed ? "px-2 py-4" : "px-3 py-4")}>
        <div className={cn("mb-3 flex items-center", collapsed ? "justify-center" : "gap-2 px-2")}>
          <LayoutGrid className="h-3.5 w-3.5 text-trellis-faint" />
          {!collapsed && (
            <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Workspace</p>
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
      <div className={cn("flex-1 overflow-y-auto", collapsed ? "px-2 py-4" : "px-3 py-4")}>
        <div className={cn("mb-3 flex items-center", collapsed ? "justify-center" : "justify-between")}>
          <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
            <History className="h-3.5 w-3.5 text-trellis-faint" />
            {!collapsed && (
              <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Sessions</p>
            )}
          </div>
          {!collapsed && <p className="text-xs text-trellis-faint">{sessions.length}</p>}
        </div>
        <div className={cn(collapsed ? "flex flex-col items-center gap-2" : "space-y-2")}>
          {collapsed
            ? sessions.slice(0, 6).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  title={session.title}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-field border transition",
                    activeSessionId === session.id
                      ? "trellis-selected-surface border-trellis-accent/25 text-trellis-text"
                      : "border-transparent bg-transparent text-trellis-muted hover:border-trellis-border hover:bg-trellis-surface hover:text-trellis-text"
                  )}
                  onClick={() => {
                    void selectSession(session.id, session.vaultId);
                  }}
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
              ))
            : sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`w-full rounded-field border px-3 py-2 text-left transition ${
                    activeSessionId === session.id
                      ? "trellis-selected-surface border-trellis-accent/25"
                      : "border-transparent bg-transparent hover:border-trellis-border hover:bg-trellis-surface"
                  }`}
                  onClick={() => {
                    void selectSession(session.id, session.vaultId);
                  }}
                >
                  <p className="text-sm text-trellis-text">{truncate(session.title, 28)}</p>
                  <p className="mt-1 text-xs text-trellis-muted">{formatTimestamp(session.updatedAt)}</p>
                </button>
              ))}

          {sessions.length === 0 && (
            collapsed ? (
              <div className="flex h-10 w-10 items-center justify-center rounded-field border border-dashed border-trellis-border text-trellis-faint">
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
      <div className={cn("border-t border-trellis-border", collapsed ? "px-2 py-4" : "px-4 py-4")}>
        {collapsed ? (
          <div className="flex justify-center">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-field border border-trellis-border bg-trellis-surface text-trellis-muted"
              title={`${activeVault.name}\n${activeVault.path}`}
            >
              <Database className="h-4 w-4" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-trellis-muted">
              <Database className="h-3.5 w-3.5" />
              <span className="truncate">{activeVault.name}</span>
            </div>
            <p className="mt-2 truncate text-xs text-trellis-faint">{activeVault.path}</p>
          </>
        )}
      </div>
    </aside>
  );
}
