export const maxParallelChatRuns = 3;

export const parallelChatLimitMessage =
  "Three chats are already running. Wait for one to finish before starting another.";

export type ChatRunAttention = "ready" | "needs_attention";

export interface ChatRunState {
  sessionId: string;
  assistantMessageId: string | null;
  startedAt: number;
  awaitingFirstToken: boolean;
}

export type ChatRunsBySession = Record<string, ChatRunState>;

export function getRunningChatRunCount(runs: ChatRunsBySession): number {
  return Object.keys(runs).length;
}

export function canStartChatRun(
  runs: ChatRunsBySession,
  sessionId: string
): { allowed: true } | { allowed: false; reason: "session_running" | "limit_reached" } {
  if (runs[sessionId]) {
    return { allowed: false, reason: "session_running" };
  }

  if (getRunningChatRunCount(runs) >= maxParallelChatRuns) {
    return { allowed: false, reason: "limit_reached" };
  }

  return { allowed: true };
}

export function filterChatRunsBySessionIds(
  runs: ChatRunsBySession,
  allowedSessionIds: Set<string>
): ChatRunsBySession {
  return Object.fromEntries(
    Object.entries(runs).filter(([sessionId]) => allowedSessionIds.has(sessionId))
  );
}
