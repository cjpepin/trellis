/**
 * Chat sessions are created with this title until the first assistant reply or extraction sets one.
 */
export const DEFAULT_CHAT_SESSION_TITLE = "Untitled Session";

export function isUnsetChatSessionTitle(title: string | null | undefined): boolean {
  const t = title?.trim() ?? "";
  return t.length === 0 || t === DEFAULT_CHAT_SESSION_TITLE;
}
