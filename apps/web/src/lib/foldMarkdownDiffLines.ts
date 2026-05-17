import type { MarkdownDiffLine } from "@/lib/noteActionDiff";

/** Lines of unchanged context kept above/below collapsed same-line runs (GitHub-style). */
export const DEFAULT_DIFF_CONTEXT_LINES = 3;

export type FoldedDiffSegment =
  | { kind: "lines"; lines: MarkdownDiffLine[] }
  | {
      kind: "collapsed";
      id: string;
      head: MarkdownDiffLine[];
      middle: MarkdownDiffLine[];
      tail: MarkdownDiffLine[];
    };

/**
 * Splits a line diff into visible hunks and collapsible runs of consecutive `same` lines.
 * Change lines (add/remove) are always shown; long runs of `same` show only context at the ends until expanded.
 */
export function foldMarkdownDiffLines(
  lines: MarkdownDiffLine[],
  options: { contextLines: number; expandAll: boolean }
): FoldedDiffSegment[] {
  if (options.expandAll || lines.length === 0) {
    return [{ kind: "lines", lines }];
  }

  const ctx = Math.max(1, options.contextLines);
  const maxShort = 2 * ctx + 1;
  const segments: FoldedDiffSegment[] = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];
    if (!line) {
      break;
    }

    if (line.kind !== "same") {
      let j = i;
      while (j < n && lines[j]?.kind !== "same") {
        j += 1;
      }
      segments.push({ kind: "lines", lines: lines.slice(i, j) });
      i = j;
      continue;
    }

    let j = i;
    while (j < n && lines[j]?.kind === "same") {
      j += 1;
    }
    const run = lines.slice(i, j);
    if (run.length <= maxShort) {
      segments.push({ kind: "lines", lines: run });
    } else {
      const head = run.slice(0, ctx);
      const tail = run.slice(-ctx);
      const middle = run.slice(ctx, run.length - ctx);
      segments.push({
        kind: "collapsed",
        id: `same-${i}-${j}`,
        head,
        middle,
        tail
      });
    }
    i = j;
  }

  return segments;
}
