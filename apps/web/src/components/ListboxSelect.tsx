import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ListboxSelectProps<T extends string> {
  id: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onSelect: (value: T) => void;
  listboxAriaLabel: string;
  disabled?: boolean;
  className?: string;
  /** Compact trigger and options (e.g. toolbar). */
  variant?: "default" | "compact";
  /** Accessible name for the trigger when there is no visible label. */
  ariaLabel?: string;
}

export function ListboxSelect<T extends string>({
  id,
  options,
  value,
  onSelect,
  listboxAriaLabel,
  disabled = false,
  className,
  variant = "default",
  ariaLabel
}: ListboxSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const active = options.find((option) => option.id === value) ?? options[0];
  const isCompact = variant === "compact";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <div
      className={cn(
        "relative",
        isCompact ? "inline-flex min-w-0 shrink-0 flex-col" : "w-full",
        className
      )}
      ref={rootRef}
    >
      <button
        id={id}
        type="button"
        disabled={disabled}
        className={cn(
          "flex min-w-0 items-center rounded-field text-left text-trellis-text outline-none transition disabled:cursor-not-allowed disabled:opacity-50",
          isCompact
            ? "h-auto w-full gap-1 border border-transparent bg-trellis-surface-2 px-2 py-1.5 text-xs hover:border-trellis-accent/25 focus-visible:border-trellis-accent"
            : "h-[42px] w-full gap-2 border border-trellis-border bg-trellis-surface px-3 text-sm hover:border-trellis-accent/35 focus-visible:border-trellis-accent"
        )}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{active?.label ?? value}</span>
        <ChevronsUpDown
          className={cn("shrink-0 text-trellis-muted", isCompact ? "h-3.5 w-3.5" : "h-4 w-4")}
          aria-hidden
        />
      </button>
      {open && (
        <div className="trellis-elevated absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-field border border-trellis-border">
          <ul
            id={listboxId}
            className={cn("max-h-[220px] overflow-y-auto p-1.5", isCompact && "max-h-[200px]")}
            role="listbox"
            aria-label={listboxAriaLabel}
          >
            {options.map((option) => (
              <li key={option.id || "__empty__"} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-field text-left transition",
                    isCompact ? "gap-1 px-2 py-1.5 text-xs" : "gap-2 px-3 py-2 text-sm",
                    option.id === value
                      ? "trellis-selected-surface"
                      : "hover:bg-trellis-surface"
                  )}
                  onClick={() => {
                    onSelect(option.id);
                    setOpen(false);
                  }}
                >
                  {option.id === value ? (
                    <Check
                      className={cn(
                        "shrink-0 text-trellis-accent",
                        isCompact ? "h-3.5 w-3.5" : "h-4 w-4"
                      )}
                      aria-hidden
                    />
                  ) : (
                    <span
                      className={cn("inline-block shrink-0", isCompact ? "w-3.5" : "w-4")}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
