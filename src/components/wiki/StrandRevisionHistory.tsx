import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ChevronDown, ChevronRight, Eye, FileCode, X } from "lucide-react";
import type { StrandRevisionActor, StrandRevisionSummary } from "@electron/ipc/types";
import { buildMarkdownDiff, type MarkdownDiffLine } from "@/lib/noteActionDiff";
import { DEFAULT_DIFF_CONTEXT_LINES, foldMarkdownDiffLines } from "@/lib/foldMarkdownDiffLines";
import { renderWikiMarkdown } from "@/lib/markdown";
import { prepareStrandPreviewMarkdown } from "@/lib/wikiStrandPreviewMarkdown";
import { cn, formatTimestamp } from "@/lib/utils";

const DIFF_MAX_LINES = 400;

function actorLabel(actor: StrandRevisionActor): string {
  switch (actor) {
    case "user":
      return "You";
    case "trellis":
      return "Trellis";
    case "import":
      return "Import";
    case "system":
      return "System";
    default:
      return actor;
  }
}

type StrandDiffViewMode = "markdown" | "preview";

function StrandDiffViewModeToggle({
  viewMode,
  onChange
}: {
  viewMode: StrandDiffViewMode;
  onChange: (mode: StrandDiffViewMode) => void;
}): JSX.Element {
  const segmentClass = (active: boolean): string =>
    cn(
      "inline-flex h-8 w-8 items-center justify-center rounded-[calc(var(--radius-field)-2px)] transition",
      active ? "trellis-selected-surface text-trellis-text" : "text-trellis-muted hover:text-trellis-text"
    );

  return (
    <div
      className="inline-flex rounded-field border border-trellis-border bg-trellis-surface-2 p-0.5 shadow-[inset_0_1px_0_var(--trellis-border)]"
      data-testid="strand-diff-view-mode"
      role="group"
      aria-label="Comparison view"
    >
      <button
        type="button"
        className={segmentClass(viewMode === "preview")}
        aria-label="Preview — rendered"
        title="Preview — formatted"
        aria-pressed={viewMode === "preview"}
        onClick={() => {
          onChange("preview");
        }}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className={segmentClass(viewMode === "markdown")}
        aria-label="Markdown — line diff"
        title="Markdown — line diff"
        aria-pressed={viewMode === "markdown"}
        onClick={() => {
          onChange("markdown");
        }}
      >
        <FileCode className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

function useSyncedScrollPair(): {
  leftRef: MutableRefObject<HTMLDivElement | null>;
  rightRef: MutableRefObject<HTMLDivElement | null>;
  onScrollLeft: () => void;
  onScrollRight: () => void;
} {
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);

  const onScrollLeft = useCallback(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right || syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    const sl = left.scrollHeight - left.clientHeight;
    const sr = right.scrollHeight - right.clientHeight;
    if (sl > 0 && sr > 0) {
      right.scrollTop = (left.scrollTop / sl) * sr;
    } else {
      right.scrollTop = left.scrollTop;
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  const onScrollRight = useCallback(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right || syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    const sl = left.scrollHeight - left.clientHeight;
    const sr = right.scrollHeight - right.clientHeight;
    if (sl > 0 && sr > 0) {
      left.scrollTop = (right.scrollTop / sr) * sl;
    } else {
      left.scrollTop = right.scrollTop;
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  return { leftRef, rightRef, onScrollLeft, onScrollRight };
}

function StrandPreviewColumns({
  previewBeforeHtml,
  previewAfterHtml,
  beforeEmpty
}: {
  previewBeforeHtml: string;
  previewAfterHtml: string;
  beforeEmpty: boolean;
}): JSX.Element {
  const { leftRef, rightRef, onScrollLeft, onScrollRight } = useSyncedScrollPair();

  return (
    <div
      className="grid min-h-0 flex-1 gap-3 md:grid-cols-2"
      onClickCapture={(event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("a")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
        <p className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-trellis-faint">
          Previous
        </p>
        <div
          ref={(node) => {
            leftRef.current = node;
          }}
          onScroll={onScrollLeft}
          className={cn(
            "trellis-document-content min-h-[12rem] min-w-0 flex-1 overflow-auto overscroll-contain rounded-field border border-trellis-border/80 bg-trellis-surface-2/40 p-3 text-sm",
            beforeEmpty && "text-trellis-faint"
          )}
          dangerouslySetInnerHTML={{
            __html: beforeEmpty ? "<p>(empty)</p>" : previewBeforeHtml
          }}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
        <p className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-trellis-faint">
          This version
        </p>
        <div
          ref={(node) => {
            rightRef.current = node;
          }}
          onScroll={onScrollRight}
          className="trellis-document-content min-h-[12rem] min-w-0 flex-1 overflow-auto overscroll-contain rounded-field border border-trellis-border/80 bg-trellis-surface-2/40 p-3 text-sm"
          dangerouslySetInnerHTML={{ __html: previewAfterHtml }}
        />
      </div>
    </div>
  );
}

function DiffLineRow({ line }: { line: MarkdownDiffLine }): JSX.Element {
  return (
    <code
      className={cn(
        "block whitespace-pre-wrap break-words",
        line.kind === "add" && "text-trellis-success",
        line.kind === "remove" && "text-trellis-error",
        line.kind === "same" && "text-trellis-muted"
      )}
    >
      {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
      {line.text}
    </code>
  );
}

function FoldedMarkdownDiff({
  lines,
  showAllUnchanged,
  expandedGapIds,
  onToggleGap,
  onToggleShowAll
}: {
  lines: MarkdownDiffLine[];
  showAllUnchanged: boolean;
  expandedGapIds: Set<string>;
  onToggleGap: (id: string) => void;
  onToggleShowAll: () => void;
}): JSX.Element {
  const segments = useMemo(
    () =>
      foldMarkdownDiffLines(lines, {
        contextLines: DEFAULT_DIFF_CONTEXT_LINES,
        expandAll: showAllUnchanged
      }),
    [lines, showAllUnchanged]
  );

  const hasCollapsible = useMemo(
    () => segments.some((s) => s.kind === "collapsed") && !showAllUnchanged,
    [segments, showAllUnchanged]
  );

  return (
    <div className="space-y-2">
      {hasCollapsible ? (
        <div className="flex flex-wrap justify-end">
          <button
            type="button"
            className="rounded-field border border-trellis-border/80 px-2 py-1 text-[11px] text-trellis-muted transition hover:border-trellis-accent/35 hover:text-trellis-text"
            onClick={onToggleShowAll}
          >
            {showAllUnchanged ? "Hide unchanged (default)" : "Show all lines"}
          </button>
        </div>
      ) : null}
      <pre className="max-h-[min(56vh,520px)] min-h-[12rem] overflow-auto rounded-field border border-trellis-border bg-trellis-bg/70 p-2 text-[11px] leading-5 text-trellis-muted">
        {segments.map((seg, segIdx) => {
          if (seg.kind === "lines") {
            return (
              <span key={`seg-lines-${segIdx}`} className="block">
                {seg.lines.map((line, idx) => (
                  <DiffLineRow key={`${segIdx}-line-${idx}-${line.kind}`} line={line} />
                ))}
              </span>
            );
          }

          const expanded = expandedGapIds.has(seg.id);
          const hiddenCount = seg.middle.length;

          return (
            <span key={seg.id} className="block">
              {seg.head.map((line, idx) => (
                <DiffLineRow key={`${seg.id}-h-${idx}`} line={line} />
              ))}
              {hiddenCount > 0 ? (
                <span className="my-1 flex flex-col gap-1 border-y border-trellis-border/50 py-1">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-field bg-trellis-surface-2/80 px-2 py-1 text-left text-[10px] text-trellis-faint transition hover:bg-trellis-surface-2 hover:text-trellis-muted"
                    onClick={() => {
                      onToggleGap(seg.id);
                    }}
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    <span>
                      {expanded
                        ? `Hide ${hiddenCount} unchanged line${hiddenCount === 1 ? "" : "s"}`
                        : `Show ${hiddenCount} hidden line${hiddenCount === 1 ? "" : "s"}`}
                    </span>
                  </button>
                  {expanded
                    ? seg.middle.map((line, idx) => (
                        <DiffLineRow key={`${seg.id}-m-${idx}`} line={line} />
                      ))
                    : null}
                </span>
              ) : null}
              {seg.tail.map((line, idx) => (
                <DiffLineRow key={`${seg.id}-t-${idx}`} line={line} />
              ))}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

interface Props {
  vaultId: string;
  file: string;
  open: boolean;
  onClose: () => void;
}

export function StrandRevisionHistory({ vaultId, file, open, onClose }: Props): JSX.Element | null {
  const [rows, setRows] = useState<StrandRevisionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<MarkdownDiffLine[] | null>(null);
  const [beforeBody, setBeforeBody] = useState("");
  const [afterBody, setAfterBody] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [showAllDiffLines, setShowAllDiffLines] = useState(false);
  const [expandedGapIds, setExpandedGapIds] = useState<Set<string>>(() => new Set());
  const [diffViewMode, setDiffViewMode] = useState<StrandDiffViewMode>("markdown");

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !vaultId || !file) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void window.trellis.db
      .listStrandRevisions({ vaultId, file })
      .then((list) => {
        if (!cancelled) {
          setRows(list);
          setSelectedId(list[0]?.id ?? null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load history.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, vaultId, file]);

  useEffect(() => {
    if (!open || !vaultId || !selectedId) {
      setDiffLines(null);
      setBeforeBody("");
      setAfterBody("");
      return;
    }

    const idx = rows.findIndex((r) => r.id === selectedId);
    if (idx === -1) {
      setDiffLines(null);
      setBeforeBody("");
      setAfterBody("");
      return;
    }

    let cancelled = false;
    setDiffLoading(true);
    const newerId = selectedId;
    const olderId = idx < rows.length - 1 ? rows[idx + 1]?.id : null;

    void (async () => {
      try {
        const newerRow = await window.trellis.db.getStrandRevisionBody({
          vaultId,
          revisionId: newerId
        });

        if (!newerRow || cancelled) {
          setDiffLines(null);
          setBeforeBody("");
          setAfterBody("");
          return;
        }

        let before = "";
        if (olderId) {
          const olderRow = await window.trellis.db.getStrandRevisionBody({
            vaultId,
            revisionId: olderId
          });
          before = olderRow?.body ?? "";
        }

        if (cancelled) {
          return;
        }

        const after = newerRow.body;
        setBeforeBody(before);
        setAfterBody(after);
        setDiffLines(buildMarkdownDiff(before, after));
        setExpandedGapIds(new Set());
        setShowAllDiffLines(false);
      } catch {
        if (!cancelled) {
          setDiffLines(null);
          setBeforeBody("");
          setAfterBody("");
        }
      } finally {
        if (!cancelled) {
          setDiffLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, vaultId, selectedId, rows]);

  const previewBefore = useMemo(
    () => renderWikiMarkdown(prepareStrandPreviewMarkdown(beforeBody), new Set<string>()),
    [beforeBody]
  );
  const previewAfter = useMemo(
    () => renderWikiMarkdown(prepareStrandPreviewMarkdown(afterBody), new Set<string>()),
    [afterBody]
  );

  const cappedDiff =
    diffLines && diffLines.length > DIFF_MAX_LINES ? diffLines.slice(0, DIFF_MAX_LINES) : diffLines;
  const diffTruncated = diffLines ? diffLines.length > DIFF_MAX_LINES : false;

  function toggleGap(id: string): void {
    setExpandedGapIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="strand-history-title"
      onClick={onClose}
    >
      <div
        className="trellis-elevated flex max-h-[min(92vh,800px)] w-full max-w-5xl flex-col overflow-hidden rounded-panel border border-trellis-border shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-trellis-border/80 bg-trellis-surface-2/40 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p id="strand-history-title" className="font-display text-lg tracking-tight text-trellis-text">
              Strand history
            </p>
            <p className="mt-1 truncate text-xs text-trellis-muted" title={file}>
              {file}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-field border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="max-h-[36vh] shrink-0 overflow-y-auto border-b border-trellis-border md:max-h-none md:w-[min(260px,34%)] md:border-b-0 md:border-r md:border-trellis-border">
            {loading ? (
              <p className="p-4 text-xs text-trellis-muted">Loading…</p>
            ) : error ? (
              <p className="p-4 text-xs text-trellis-accent">{error}</p>
            ) : rows.length === 0 ? (
              <p className="p-4 text-xs leading-relaxed text-trellis-muted">
                No saved versions yet. Versions appear after you finish an edit session, when Trellis
                updates a note, or when you import.
              </p>
            ) : (
              <ul className="divide-y divide-trellis-border/60">
                {rows.map((row) => {
                  const active = row.id === selectedId;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full flex-col gap-0.5 px-4 py-3 text-left text-xs transition",
                          active
                            ? "bg-trellis-surface-2 text-trellis-text"
                            : "text-trellis-muted hover:bg-trellis-surface-2/60 hover:text-trellis-text"
                        )}
                        onClick={() => {
                          setSelectedId(row.id);
                        }}
                      >
                        <span className="font-medium text-trellis-text">{actorLabel(row.actor)}</span>
                        <span className="text-trellis-faint">
                          {formatTimestamp(row.createdAt)}
                          {row.sessionTitle ? ` · ${row.sessionTitle}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4">
            {diffLoading ? (
              <p className="text-xs text-trellis-muted">Loading diff…</p>
            ) : !cappedDiff || cappedDiff.length === 0 ? (
              <p className="text-xs text-trellis-muted">
                Select a version to compare it with the previous saved snapshot.
              </p>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                <div className="flex shrink-0 justify-end">
                  <StrandDiffViewModeToggle viewMode={diffViewMode} onChange={setDiffViewMode} />
                </div>

                {diffViewMode === "markdown" ? (
                  <>
                    <FoldedMarkdownDiff
                      lines={cappedDiff}
                      showAllUnchanged={showAllDiffLines}
                      expandedGapIds={expandedGapIds}
                      onToggleGap={toggleGap}
                      onToggleShowAll={() => {
                        setShowAllDiffLines((v) => !v);
                      }}
                    />
                    {diffTruncated ? (
                      <p className="text-[10px] text-trellis-faint">
                        Line diff truncated at {DIFF_MAX_LINES} lines; very large changes may be incomplete.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                    <p className="shrink-0 text-[11px] leading-relaxed text-trellis-muted">
                      Links are inactive in this preview.
                    </p>
                    <StrandPreviewColumns
                      previewBeforeHtml={previewBefore.html}
                      previewAfterHtml={previewAfter.html}
                      beforeEmpty={!beforeBody.trim()}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
