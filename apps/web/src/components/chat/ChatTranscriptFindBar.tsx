import { useEffect, useId, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  columnClassName: string;
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  matchIndex: number;
  matchCount: number;
  onNext: () => void;
  onPrevious: () => void;
}

export function ChatTranscriptFindBar({
  open,
  columnClassName,
  query,
  onQueryChange,
  onClose,
  matchIndex,
  matchCount,
  onNext,
  onPrevious
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labelId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const summary =
    query.trim().length === 0
      ? "Type to search this thread"
      : matchCount === 0
        ? "No matches"
        : `${matchIndex + 1} of ${matchCount}`;

  return (
    <div
      className={cn(
        "border-b border-trellis-border bg-trellis-surface/95 px-4 py-2 backdrop-blur",
        "motion-reduce:transition-none"
      )}
      data-testid="chat-transcript-find"
    >
      <div
        className={cn("mx-auto flex w-full items-center gap-2", columnClassName)}
        role="search"
        aria-labelledby={labelId}
      >
        <Search className="h-4 w-4 shrink-0 text-trellis-muted" aria-hidden />
        <span id={labelId} className="sr-only">
          Find in conversation
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          data-testid="chat-transcript-find-input"
          placeholder="Find in conversation…"
          className={cn(
            "min-w-0 flex-1 rounded-field border border-trellis-border bg-trellis-surface-2 px-3 py-1.5 text-sm text-trellis-text",
            "placeholder:text-trellis-faint outline-none transition",
            "focus-visible:border-trellis-accent focus-visible:ring-1 focus-visible:ring-trellis-accent/35"
          )}
          onChange={(e) => {
            onQueryChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) {
                onPrevious();
              } else {
                onNext();
              }
            }
          }}
        />
        <span className="w-[7.5rem] shrink-0 text-right text-xs tabular-nums text-trellis-muted">
          {summary}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
            className="rounded-field border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:bg-trellis-surface-2 hover:text-trellis-accent"
            onClick={() => {
              onPrevious();
            }}
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            title="Next match (Enter)"
            aria-label="Next match"
            className="rounded-field border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:bg-trellis-surface-2 hover:text-trellis-accent"
            onClick={() => {
              onNext();
            }}
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            title="Close"
            aria-label="Close find bar"
            className="rounded-field border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:bg-trellis-surface-2 hover:text-trellis-accent"
            onClick={() => {
              onClose();
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
