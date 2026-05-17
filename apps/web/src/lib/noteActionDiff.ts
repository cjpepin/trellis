export interface MarkdownDiffLine {
  kind: "same" | "add" | "remove";
  text: string;
}

export function buildMarkdownDiff(beforeMarkdown: string, afterMarkdown: string): MarkdownDiffLine[] {
  const beforeLines = beforeMarkdown.split("\n");
  const afterLines = afterMarkdown.split("\n");
  const rows = beforeLines.length + 1;
  const cols = afterLines.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        beforeLines[i] === afterLines[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const diff: MarkdownDiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      diff.push({ kind: "same", text: beforeLines[i] ?? "" });
      i += 1;
      j += 1;
      continue;
    }

    if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      diff.push({ kind: "remove", text: beforeLines[i] ?? "" });
      i += 1;
    } else {
      diff.push({ kind: "add", text: afterLines[j] ?? "" });
      j += 1;
    }
  }

  while (i < beforeLines.length) {
    diff.push({ kind: "remove", text: beforeLines[i] ?? "" });
    i += 1;
  }

  while (j < afterLines.length) {
    diff.push({ kind: "add", text: afterLines[j] ?? "" });
    j += 1;
  }

  return diff;
}
