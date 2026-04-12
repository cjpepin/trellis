import type { Editor } from "@tiptap/core";
import { matchTemplateMacroInTextBefore } from "@shared/chat/templateMacros";
import { findWikiBracketQuery } from "@/components/wiki/findWikiBracketQuery";

export interface TemplateMacroMatch {
  /** Document position where `{{` starts */
  from: number;
  /** Current cursor position (end of query) */
  to: number;
  /** Text after `{{`, before closing `}}` */
  query: string;
}

/**
 * If the cursor is inside an unfinished `{{ ...` macro token, returns its range and query.
 * Skips when an unfinished `[[` wiki link is active (that range can contain `{{`).
 */
export function findTemplateMacroQuery(editor: Editor): TemplateMacroMatch | null {
  if (findWikiBracketQuery(editor)) {
    return null;
  }

  const { $from } = editor.state.selection;
  const pos = $from.pos;
  const blockStart = $from.start();
  const textBefore = editor.state.doc.textBetween(blockStart, pos, "\n", " ");

  const matched = matchTemplateMacroInTextBefore(textBefore);
  if (!matched) {
    return null;
  }

  const from = pos - matched.fullLength;

  return {
    from,
    to: pos,
    query: matched.query
  };
}
