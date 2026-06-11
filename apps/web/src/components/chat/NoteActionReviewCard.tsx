import { useMemo, useState } from "react";
import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import type { ChatNoteActionProposal } from "@trellis/contracts";
import { buildMarkdownDiff } from "@/lib/noteActionDiff";
import { cn } from "@/lib/utils";

interface Props {
  action: ChatNoteActionProposal;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDraftChange?: (afterMarkdown: string) => void;
}

function actionLabel(kind: ChatNoteActionProposal["kind"]): string {
  switch (kind) {
    case "create_note":
      return "Create note";
    case "update_note":
      return "Update note";
  }
}

function targetPath(action: ChatNoteActionProposal): string {
  const folder = action.targetFolderPath.trim();
  return `wiki/${folder ? `${folder}/` : ""}${action.targetSlug}.md`;
}

const DIFF_PREVIEW_MAX_LINES = 160;

export function NoteActionReviewCard({
  action,
  busy = false,
  onApprove,
  onReject,
  onDraftChange
}: Props) {
  const [diffOpen, setDiffOpen] = useState(false);
  const resolved = action.status !== "pending";
  const canEdit = !resolved && Boolean(onDraftChange);

  const diff = useMemo(
    () => buildMarkdownDiff(action.beforeMarkdown, action.afterMarkdown),
    [action.beforeMarkdown, action.afterMarkdown]
  );

  const addLineCount = useMemo(() => diff.filter((line) => line.kind === "add").length, [diff]);

  const visibleDiff = diff.length > DIFF_PREVIEW_MAX_LINES ? diff.slice(0, DIFF_PREVIEW_MAX_LINES) : diff;
  const hasHiddenLines = diff.length > visibleDiff.length;
  const hasBefore = action.beforeMarkdown.trim().length > 0;

  return (
    <section
      className="mt-4 w-full rounded-panel border border-trellis-accent/25 bg-trellis-surface/70 p-3 text-left"
      data-testid="note-action-review-card"
      aria-label="Proposed note change"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-trellis-accent">
            Proposed change
          </p>
          <h3 className="mt-1 text-sm font-medium text-trellis-text">
            {actionLabel(action.kind)}
          </h3>
          <p className="mt-1 break-words font-mono text-[11px] text-trellis-muted">
            {targetPath(action)}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px]",
            action.status === "approved" && "border-trellis-success/50 text-trellis-success",
            action.status === "rejected" && "border-trellis-border text-trellis-muted",
            action.status === "failed" && "border-trellis-error/60 text-trellis-error",
            action.status === "pending" && "border-trellis-accent/40 text-trellis-accent"
          )}
        >
          {action.status}
        </span>
      </div>

      <p className="mt-3 text-xs leading-5 text-trellis-muted">{action.rationale}</p>

      {canEdit ? (
        <div className="mt-3">
          <label
            className="text-[10px] uppercase tracking-[0.16em] text-trellis-faint"
            htmlFor={`note-action-draft-${action.id}`}
          >
            Note markdown
          </label>
          <textarea
            id={`note-action-draft-${action.id}`}
            data-testid="note-action-draft-editor"
            className="trellis-input mt-1.5 min-h-[11rem] w-full max-h-[28rem] resize-y rounded-field border border-trellis-border bg-trellis-bg/80 px-2.5 py-2 font-mono text-[12px] leading-5 text-trellis-text"
            spellCheck={false}
            value={action.afterMarkdown}
            onChange={(event) => {
              onDraftChange?.(event.target.value);
            }}
            disabled={busy}
          />
          <p className="mt-1.5 text-[11px] leading-4 text-trellis-muted">
            Edit freely, ask Trellis to revise in chat if you want another pass, then approve to write
            to your vault—or reject to dismiss.
          </p>
        </div>
      ) : (
        <pre className="mt-3 max-h-72 overflow-auto rounded-field border border-trellis-border bg-trellis-bg/70 p-2 text-[11px] leading-5 text-trellis-muted">
          {visibleDiff.map((line, index) => (
            <code
              key={`${line.kind}-${index}-${line.text}`}
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
          ))}
          {hasHiddenLines ? (
            <code className="block text-trellis-faint">  ... diff truncated for review</code>
          ) : null}
        </pre>
      )}

      {canEdit ? (
        <div className="mt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-field border border-trellis-border/60 bg-trellis-bg/40 px-2.5 py-2 text-left text-[11px] text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text"
            aria-expanded={diffOpen}
            onClick={() => {
              setDiffOpen((open) => !open);
            }}
          >
            <span>Line-by-line changes</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 transition-transform",
                diffOpen ? "rotate-180" : "rotate-0"
              )}
              aria-hidden
            />
          </button>
          {diffOpen ? (
            <pre className="mt-2 max-h-56 overflow-auto rounded-field border border-trellis-border bg-trellis-bg/70 p-2 text-[11px] leading-5 text-trellis-muted">
              {!hasBefore ? (
                <code className="block text-trellis-faint">
                  New file — {addLineCount} line{addLineCount === 1 ? "" : "s"} added
                </code>
              ) : null}
              {visibleDiff.map((line, index) => (
                <code
                  key={`${line.kind}-${index}-${line.text}`}
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
              ))}
              {hasHiddenLines ? (
                <code className="block text-trellis-faint">  ... diff truncated</code>
              ) : null}
            </pre>
          ) : null}
        </div>
      ) : null}

      {action.errorMessage ? (
        <p className="mt-2 text-xs text-trellis-error">{action.errorMessage}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || resolved}
          className="inline-flex items-center gap-1.5 rounded-field border border-trellis-accent/40 px-3 py-1.5 text-xs text-trellis-text transition hover:border-trellis-accent disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onApprove}
        >
          {busy ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-trellis-accent" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5 text-trellis-accent" aria-hidden />
          )}
          Approve
        </button>
        <button
          type="button"
          disabled={busy || resolved}
          className="inline-flex items-center gap-1.5 rounded-field border border-trellis-border px-3 py-1.5 text-xs text-trellis-muted transition hover:text-trellis-text disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onReject}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Reject
        </button>
      </div>
    </section>
  );
}
