import { NavLink } from "react-router-dom";
import { SIDEBAR_PRIMARY_NAV } from "@/components/shared/Sidebar";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/uiStore";

export function MobileBottomNav(): JSX.Element {
  const closeDrawer = useUiStore((s) => s.setMobileWorkspaceDrawerOpen);

  return (
    <nav
      className="trellis-mobile-tab-bar flex shrink-0 items-stretch justify-around border-t border-trellis-border bg-trellis-sidebar/98 px-1 pb-[max(0.35rem,env(safe-area-inset-bottom,0px))] pt-1 backdrop-blur-md supports-[backdrop-filter]:bg-trellis-sidebar/90"
      aria-label="Primary"
      data-testid="mobile-bottom-nav"
    >
      {SIDEBAR_PRIMARY_NAV.map((item) => {
        const Icon = item.icon;
        const testId = `mobile-tab-${item.to.replace("/", "") || "root"}`;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            data-testid={testId}
            onClick={() => {
              closeDrawer(false);
            }}
            className={({ isActive }) =>
              cn(
                "flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-field px-1 py-1 transition",
                isActive
                  ? "text-trellis-accent"
                  : "text-trellis-muted active:bg-trellis-surface"
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
            <span className="max-w-full truncate text-[10px] font-medium leading-tight tracking-tight">
              {item.label}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
