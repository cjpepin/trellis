/**
 * Search within chat message bodies (stored markdown). Used by Cmd/Ctrl+F transcript find.
 */

export interface TranscriptFindMatch {
  messageId: string;
  start: number;
  end: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** True if `index` falls inside a fenced ``` block (line-based, commonmark-style toggles). */
export function indexInFencedCode(markdown: string, index: number): boolean {
  let fenced = false;
  let offset = 0;
  const lines = markdown.split("\n");

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li] ?? "";
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const trimmed = line.trimStart();

    if (trimmed.startsWith("```")) {
      fenced = !fenced;
      offset = lineEnd + (li < lines.length - 1 ? 1 : 0);
      continue;
    }

    if (fenced && index >= lineStart && index < lineEnd) {
      return true;
    }

    offset = lineEnd + (li < lines.length - 1 ? 1 : 0);
  }

  return false;
}

export function buildTranscriptFindMatches(
  messages: Array<{ id: string; content: string }>,
  query: string
): TranscriptFindMatch[] {
  const q = query.trim();
  if (!q) {
    return [];
  }

  const lowerQ = q.toLowerCase();
  const out: TranscriptFindMatch[] = [];

  for (const m of messages) {
    const text = m.content;
    const lower = text.toLowerCase();
    let from = 0;

    while (true) {
      const i = lower.indexOf(lowerQ, from);
      if (i === -1) {
        break;
      }
      if (!indexInFencedCode(text, i)) {
        out.push({ messageId: m.id, start: i, end: i + q.length });
      }
      from = i + q.length;
    }
  }

  return out;
}

/**
 * Wraps the active match in a `<mark>` for RichTextRenderer. Escapes the matched slice only;
 * splitting inside markdown syntax can produce odd rendering (acceptable for rare edge cases).
 */
export function markdownWithTranscriptFindMark(
  markdown: string,
  range: { start: number; end: number } | null | undefined
): string {
  if (!range || range.start < 0 || range.end > markdown.length || range.start >= range.end) {
    return markdown;
  }

  if (indexInFencedCode(markdown, range.start)) {
    return markdown;
  }

  const before = markdown.slice(0, range.start);
  const mid = markdown.slice(range.start, range.end);
  const after = markdown.slice(range.end);

  return `${before}<mark class="trellis-transcript-find-mark">${escapeHtml(mid)}</mark>${after}`;
}
