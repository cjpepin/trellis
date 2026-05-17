import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function MobileWorkspaceDrawer({ open, onClose, children }: Props): JSX.Element | null {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="trellis-mobile-workspace-drawer fixed inset-0 z-[85]"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        aria-label="Close workspace menu"
        onClick={onClose}
      />
      <div
        className="absolute bottom-0 left-0 top-0 flex w-[min(21rem,calc(100vw-2rem))] flex-col border-r border-trellis-border bg-trellis-sidebar shadow-2xl"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        {children}
      </div>
    </div>
  );
}
