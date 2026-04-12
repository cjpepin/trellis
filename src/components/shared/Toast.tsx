import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Toast() {
  const toasts = useUiStore((state) => state.toasts);
  const removeToast = useUiStore((state) => state.removeToast);
  const exitingIdsRef = useRef<Set<string>>(new Set());
  const [, bumpExiting] = useState(0);

  const beginExit = useCallback(
    (id: string): void => {
      const stillPresent = useUiStore.getState().toasts.some((t) => t.id === id);
      if (!stillPresent) {
        exitingIdsRef.current.delete(id);
        return;
      }
      if (prefersReducedMotion()) {
        removeToast(id);
        exitingIdsRef.current.delete(id);
        return;
      }
      if (exitingIdsRef.current.has(id)) {
        return;
      }
      exitingIdsRef.current.add(id);
      bumpExiting((n) => n + 1);
    },
    [removeToast]
  );

  const finishExit = useCallback((id: string): void => {
    exitingIdsRef.current.delete(id);
    removeToast(id);
  }, [removeToast]);

  useEffect(() => {
    const timers = toasts
      .map((toast) => {
        const ms = toast.durationMs ?? 3400;
        if (ms <= 0) {
          return null;
        }
        if (exitingIdsRef.current.has(toast.id)) {
          return null;
        }
        return window.setTimeout(() => {
          if (prefersReducedMotion()) {
            removeToast(toast.id);
            return;
          }
          beginExit(toast.id);
        }, ms);
      })
      .filter((timer): timer is number => timer !== null);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [beginExit, removeToast, toasts]);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-full max-w-sm flex-col gap-3">
      {toasts.map((toast) => {
        const isExiting = exitingIdsRef.current.has(toast.id);
        return (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto rounded-panel border bg-trellis-surface-2 px-4 py-3 text-sm shadow-glow",
            isExiting
              ? "animate-toast-exit motion-reduce:animate-none motion-reduce:opacity-0"
              : "animate-fade-rise",
            toneStyles[toast.tone]
          )}
          onAnimationEnd={(event) => {
            if (!event.animationName.includes("toast-exit") || !isExiting) {
              return;
            }
            finishExit(toast.id);
          }}
        >
          <div className="flex gap-2">
            <p className="min-w-0 flex-1 leading-snug">{toast.title}</p>
            <button
              type="button"
              className="-m-1 shrink-0 rounded-field p-1 text-trellis-text-muted transition hover:bg-trellis-border/35 hover:text-trellis-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trellis-accent"
              aria-label="Dismiss notification"
              onClick={() => beginExit(toast.id)}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
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
        );
      })}
    </div>
  );
}
