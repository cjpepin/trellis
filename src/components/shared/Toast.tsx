import { useEffect } from "react";
import { Link } from "react-router-dom";
import { notesRoutePath } from "@/lib/noteRoutes";
import { useUiStore } from "@/store/uiStore";
import { cn } from "@/lib/utils";

const toneStyles = {
  default: "border-trellis-border text-trellis-text",
  success: "border-trellis-success/40 text-trellis-text",
  warning: "border-trellis-accent/40 text-trellis-text",
  error: "border-trellis-error/40 text-trellis-text"
} as const;

export function Toast() {
  const toasts = useUiStore((state) => state.toasts);
  const removeToast = useUiStore((state) => state.removeToast);

  useEffect(() => {
    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        removeToast(toast.id);
      }, 3400)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [removeToast, toasts]);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-full max-w-sm flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto animate-fade-rise rounded-panel border bg-trellis-surface-2 px-4 py-3 text-sm shadow-glow",
            toneStyles[toast.tone]
          )}
        >
          <p>{toast.title}</p>
          {toast.noteLinks && toast.noteLinks.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-trellis-border/50 pt-2">
              {toast.noteLinks.map((link) => (
                <Link
                  key={link.noteSlug}
                  to={notesRoutePath(link.noteSlug)}
                  className="text-xs font-medium text-trellis-accent underline decoration-trellis-accent/35 underline-offset-2 transition hover:decoration-trellis-accent"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
