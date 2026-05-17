import { Menu } from "lucide-react";
import { useLocation } from "react-router-dom";
import { stripAppShellBase } from "@/lib/appRoutes";
import { useUiStore } from "@/store/uiStore";

const ROUTE_TITLE: Record<string, string> = {
  "/": "Chat",
  "/chat": "Chat",
  "/thoughts": "Thoughts",
  "/notes": "Strands",
  "/graph": "Graph",
  "/settings": "Settings"
};

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function MobileAppBar(): JSX.Element {
  const { pathname } = useLocation();
  const setDrawerOpen = useUiStore((s) => s.setMobileWorkspaceDrawerOpen);
  const title = ROUTE_TITLE[normalizePath(stripAppShellBase(pathname))] ?? "Trellis";

  return (
    <header
      className="trellis-mobile-app-bar flex shrink-0 items-center gap-2 border-b border-trellis-border bg-trellis-sidebar pt-[env(safe-area-inset-top,0px)]"
      data-testid="mobile-app-bar"
    >
      <div className="flex min-h-0 flex-1 items-center px-2 pb-2">
        <button
          type="button"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-field border border-transparent text-trellis-text transition active:bg-trellis-surface"
          aria-label="Open workspace menu"
          onClick={() => {
            setDrawerOpen(true);
          }}
        >
          <Menu className="h-5 w-5" strokeWidth={2} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center font-display text-[1.125rem] font-normal leading-tight text-trellis-text">
          {title}
        </h1>
        <div className="h-11 w-11 shrink-0" aria-hidden />
      </div>
    </header>
  );
}
