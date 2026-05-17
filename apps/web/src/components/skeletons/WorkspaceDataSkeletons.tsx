import { cn } from "@/lib/utils";

const pulse = "animate-pulse motion-reduce:animate-none";

function SkeletonBar({ className }: { className?: string }): JSX.Element {
  return (
    <div
      className={cn("rounded-md bg-trellis-surface-2", pulse, className)}
      aria-hidden
    />
  );
}

/** Sidebar session stack (expanded layout). */
export function SessionListSkeleton({
  rows = 6,
  collapsed = false
}: {
  rows?: number;
  collapsed?: boolean;
}): JSX.Element {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5" data-testid="session-list-skeleton">
        {Array.from({ length: Math.min(rows, 5) }, (_, i) => (
          <SkeletonBar key={i} className="h-9 w-9 rounded-field" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="session-list-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="w-full rounded-field border border-transparent px-3 py-2">
          <SkeletonBar className="h-3.5 w-[72%]" />
          <SkeletonBar className="mt-2 h-2.5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Chat transcript column: pseudo message rows. */
export function MessageColumnSkeleton({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <div
      className="mx-auto flex w-full max-w-[1020px] flex-col gap-6 px-4 py-6"
      data-testid="message-column-skeleton"
      aria-busy
      aria-label="Loading messages"
    >
      {Array.from({ length: rows }, (_, i) => {
        const assistant = i % 2 === 1;
        return (
          <div
            key={i}
            className={cn("flex w-full", assistant ? "justify-start" : "justify-end")}
          >
            <div
              className={cn(
                "max-w-[85%] space-y-2 rounded-panel border border-trellis-border/60 bg-trellis-surface-2/50 px-4 py-3",
                assistant ? "rounded-tl-sm" : "rounded-tr-sm"
              )}
            >
              <SkeletonBar className={cn("h-3", assistant ? "w-[280px]" : "w-[220px]")} />
              <SkeletonBar className={cn("h-3", assistant ? "w-[200px]" : "w-[180px]")} />
              {assistant && i % 3 === 1 ? (
                <SkeletonBar className="h-3 w-[240px]" />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Strands list panel: rows resembling note list items. */
export function WikiStrandsPanelSkeleton({ rows = 8 }: { rows?: number }): JSX.Element {
  return (
    <div
      className="trellis-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
      data-testid="wiki-strands-skeleton"
      aria-busy
      aria-label="Loading Strands"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-field border border-trellis-border/40 px-3 py-2.5">
          <SkeletonBar className="h-3 w-[55%]" />
          <SkeletonBar className="mt-2 h-2.5 w-[36%]" />
        </div>
      ))}
    </div>
  );
}

/** Graph viewport placeholder. */
export function GraphViewportSkeleton(): JSX.Element {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center bg-trellis-surface-2/25 p-8"
      data-testid="graph-viewport-skeleton"
      aria-busy
      aria-label="Loading graph"
    >
      <div className="grid w-full max-w-2xl grid-cols-3 gap-4 opacity-80">
        {Array.from({ length: 9 }, (_, i) => (
          <SkeletonBar key={i} className="aspect-square rounded-full" />
        ))}
      </div>
    </div>
  );
}

/** Composer strip placeholder under transcript. */
export function ChatComposerSkeleton(): JSX.Element {
  return (
    <div
      className="mx-auto w-full max-w-[1020px] px-5 pb-4 pt-2"
      data-testid="chat-composer-skeleton"
    >
      <SkeletonBar className="h-12 w-full rounded-field" />
    </div>
  );
}
