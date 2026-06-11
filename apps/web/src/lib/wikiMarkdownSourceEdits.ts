/** Helpers for wiki note markdown source editing (toolbar parity with rich text). */

export interface MarkdownSourceSlice {
  value: string;
  start: number;
  end: number;
}

export interface MarkdownEditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function replaceSlice(
  slice: MarkdownSourceSlice,
  insert: string,
  cursorStart: number,
  cursorEnd: number
): MarkdownEditResult {
  const { value, start, end } = slice;
  const next = value.slice(0, start) + insert + value.slice(end);
  const a = clamp(cursorStart, 0, next.length);
  const b = clamp(cursorEnd, 0, next.length);
  return { value: next, selectionStart: a, selectionEnd: b };
}

function selectedText(slice: MarkdownSourceSlice): string {
  return slice.value.slice(slice.start, slice.end);
}

/** If selection is wrapped with left+right delimiters, unwrap; else wrap. */
export function toggleAround(
  slice: MarkdownSourceSlice,
  left: string,
  right: string
): MarkdownEditResult {
  const inner = selectedText(slice);
  const { value, start, end } = slice;
  if (value.slice(start - left.length, start) === left && value.slice(end, end + right.length) === right) {
    const unwrapped = value.slice(start, end);
    const next = value.slice(0, start - left.length) + unwrapped + value.slice(end + right.length);
    const shift = -left.length;
    return {
      value: next,
      selectionStart: start + shift,
      selectionEnd: end + shift
    };
  }
  const insert = left + inner + right;
  return replaceSlice(slice, insert, start + left.length, start + left.length + inner.length);
}

export function toggleBold(slice: MarkdownSourceSlice): MarkdownEditResult {
  return toggleAround(slice, "**", "**");
}

export function toggleItalic(slice: MarkdownSourceSlice): MarkdownEditResult {
  return toggleAround(slice, "_", "_");
}

export function toggleUnderline(slice: MarkdownSourceSlice): MarkdownEditResult {
  return toggleAround(slice, "<u>", "</u>");
}

export function toggleStrikethrough(slice: MarkdownSourceSlice): MarkdownEditResult {
  return toggleAround(slice, "~~", "~~");
}

export function toggleInlineCode(slice: MarkdownSourceSlice): MarkdownEditResult {
  return toggleAround(slice, "`", "`");
}

function lineBounds(value: string, index: number): { lineStart: number; lineEnd: number } {
  let lineStart = value.lastIndexOf("\n", index - 1) + 1;
  if (lineStart < 0) {
    lineStart = 0;
  }
  let lineEnd = value.indexOf("\n", index);
  if (lineEnd === -1) {
    lineEnd = value.length;
  }
  return { lineStart, lineEnd };
}

function linesInRange(value: string, start: number, end: number): { firstLineStart: number; lastLineEnd: number } {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const head = lineBounds(value, a);
  const tail = lineBounds(value, Math.max(a, b - 1));
  return { firstLineStart: head.lineStart, lastLineEnd: tail.lineEnd };
}

const HEADING_PREFIX_RE = /^#{1,3}\s+/;

export function toggleHeadingLevel(
  slice: MarkdownSourceSlice,
  level: 1 | 2 | 3 | null
): MarkdownEditResult {
  const { value } = slice;
  const { firstLineStart, lastLineEnd } = linesInRange(value, slice.start, slice.end);
  const block = value.slice(firstLineStart, lastLineEnd);
  const lines = block.split("\n");

  const nextLines = lines.map((line) => {
    const stripped = line.replace(HEADING_PREFIX_RE, "");
    if (level === null) {
      return stripped;
    }
    return `${"#".repeat(level)} ${stripped}`;
  });

  const nextBlock = nextLines.join("\n");
  const next = value.slice(0, firstLineStart) + nextBlock + value.slice(lastLineEnd);
  return {
    value: next,
    selectionStart: firstLineStart,
    selectionEnd: firstLineStart + nextBlock.length
  };
}

export function toggleBulletList(slice: MarkdownSourceSlice): MarkdownEditResult {
  const { value } = slice;
  const { firstLineStart, lastLineEnd } = linesInRange(value, slice.start, slice.end);
  const block = value.slice(firstLineStart, lastLineEnd);
  const lines = block.split("\n");
  const allBulleted = lines.every((line) => line === "" || /^-\s+/.test(line));
  const nextLines = lines.map((line) => {
    if (line === "") {
      return line;
    }
    if (allBulleted) {
      return line.replace(/^-\s+/, "");
    }
    return `- ${line}`;
  });
  const nextBlock = nextLines.join("\n");
  const next = value.slice(0, firstLineStart) + nextBlock + value.slice(lastLineEnd);
  const delta = nextBlock.length - block.length;
  return {
    value: next,
    selectionStart: clamp(slice.start + delta, 0, next.length),
    selectionEnd: clamp(slice.end + delta, 0, next.length)
  };
}

export function toggleOrderedList(slice: MarkdownSourceSlice): MarkdownEditResult {
  const { value } = slice;
  const { firstLineStart, lastLineEnd } = linesInRange(value, slice.start, slice.end);
  const block = value.slice(firstLineStart, lastLineEnd);
  const lines = block.split("\n");
  const nonEmpty = lines.filter((line) => line.trim() !== "");
  const allNumbered =
    nonEmpty.length > 0 && nonEmpty.every((line) => /^\d+\.\s+/.test(line));
  let n = 1;
  const nextLines = lines.map((line) => {
    if (line.trim() === "") {
      return line;
    }
    if (allNumbered) {
      return line.replace(/^\d+\.\s+/, "");
    }
    const body = line.replace(/^[-*]\s+/, "");
    const numbered = `${n}. ${body}`;
    n += 1;
    return numbered;
  });
  const nextBlock = nextLines.join("\n");
  const next = value.slice(0, firstLineStart) + nextBlock + value.slice(lastLineEnd);
  const delta = nextBlock.length - block.length;
  return {
    value: next,
    selectionStart: clamp(slice.start + delta, 0, next.length),
    selectionEnd: clamp(slice.end + delta, 0, next.length)
  };
}

export function toggleBlockquote(slice: MarkdownSourceSlice): MarkdownEditResult {
  const { value } = slice;
  const { firstLineStart, lastLineEnd } = linesInRange(value, slice.start, slice.end);
  const block = value.slice(firstLineStart, lastLineEnd);
  const lines = block.split("\n");
  const allQuoted = lines.every((line) => line === "" || /^>\s?/.test(line));
  const nextLines = lines.map((line) => {
    if (line === "") {
      return line;
    }
    if (allQuoted) {
      return line.replace(/^>\s?/, "");
    }
    return `> ${line}`;
  });
  const nextBlock = nextLines.join("\n");
  const next = value.slice(0, firstLineStart) + nextBlock + value.slice(lastLineEnd);
  const delta = nextBlock.length - block.length;
  return {
    value: next,
    selectionStart: clamp(slice.start + delta, 0, next.length),
    selectionEnd: clamp(slice.end + delta, 0, next.length)
  };
}

export function toggleCodeBlock(slice: MarkdownSourceSlice): MarkdownEditResult {
  const inner = selectedText(slice);
  const fence = "```";
  const wrapped = `${fence}\n${inner}\n${fence}\n`;
  return replaceSlice(slice, wrapped, slice.start + fence.length + 1, slice.start + fence.length + 1 + inner.length);
}

export function insertHorizontalRule(slice: MarkdownSourceSlice): MarkdownEditResult {
  const insert = "\n\n---\n\n";
  return replaceSlice(slice, insert, slice.start + insert.length, slice.start + insert.length);
}

export function wrapColoredSpan(slice: MarkdownSourceSlice, color: string): MarkdownEditResult {
  if (!color) {
    return {
      value: slice.value,
      selectionStart: slice.start,
      selectionEnd: slice.end
    };
  }
  const inner = selectedText(slice);
  const open = `<span style="color:${color}">`;
  const close = "</span>";
  return replaceSlice(slice, open + inner + close, slice.start + open.length, slice.start + open.length + inner.length);
}

function lineStartEndForPos(value: string, pos: number): { lineStart: number; lineEnd: number } {
  const i = clamp(pos, 0, Math.max(0, value.length));
  let lineStart = value.lastIndexOf("\n", i - 1) + 1;
  if (lineStart < 0) {
    lineStart = 0;
  }
  let lineEnd = value.indexOf("\n", i);
  if (lineEnd === -1) {
    lineEnd = value.length;
  }
  return { lineStart, lineEnd };
}

export function cursorInPipeTable(value: string, pos: number): boolean {
  const { lineStart, lineEnd } = lineStartEndForPos(value, pos);
  const line = value.slice(lineStart, lineEnd);
  return (line.match(/\|/g)?.length ?? 0) >= 2;
}

export function insertHttpsLink(slice: MarkdownSourceSlice, href: string): MarkdownEditResult | null {
  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }
  const inner = selectedText(slice) || "link";
  const md = `[${inner}](${trimmed})`;
  return replaceSlice(slice, md, slice.start + md.length, slice.start + md.length);
}

export function insertMarkdownImage(slice: MarkdownSourceSlice, alt: string, src: string): MarkdownEditResult {
  const safeAlt = alt.replace(/[\[\]]/g, "\\$&");
  const md = `![${safeAlt}](${src})`;
  return replaceSlice(slice, md, slice.start + md.length, slice.start + md.length);
}

const TABLE_SEP = "|---|---|---|";

export function insertPipeTable(): string {
  return [
    "",
    "|   |   |   |",
    TABLE_SEP,
    "|   |   |   |",
    "|   |   |   |",
    ""
  ].join("\n");
}

export function insertRaw(slice: MarkdownSourceSlice, text: string): MarkdownEditResult {
  const endPos = slice.start + text.length;
  return replaceSlice(slice, text, endPos, endPos);
}
