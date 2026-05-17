import type { Editor } from "@tiptap/core";

export interface WikiBracketMatch {
  /** Document position where `[[` starts */
  from: number;
  /** Current cursor position (end of query) */
  to: number;
  /** Text after `[[`, before closing `]]` */
  query: string;
}

/**
 * If the cursor is inside an unfinished `[[ ...` wiki link token, returns its range and query.
 * Works on plain text within the current block (paragraph, heading, etc.).
 */
export function findWikiBracketQuery(editor: Editor): WikiBracketMatch | null {
  const { $from } = editor.state.selection;
  const pos = $from.pos;
  const blockStart = $from.start();
  const textBefore = editor.state.doc.textBetween(blockStart, pos, "\n", " ");

  const match = textBefore.match(/\[\[([^\]]*)$/);
  if (!match) {
    return null;
  }

  const full = match[0];
  const query = match[1] ?? "";
  const from = pos - full.length;

  return {
    from,
    to: pos,
    query
  };
}
