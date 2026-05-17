/** Rolling window for free-tier message quota (matches Postgres interval `24 hours`). */
export const TRIAL_MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Messages counted toward the current window. When the window has expired, the count
 * is treated as zero until the next increment persists a reset in the database.
 */
export function effectiveTrialMessagesUsed(
  messagesUsed: number,
  windowStartedAt: string | null | undefined
): number {
  if (windowStartedAt == null || windowStartedAt === "") {
    return messagesUsed;
  }

  const startMs = Date.parse(windowStartedAt);

  if (Number.isNaN(startMs)) {
    return messagesUsed;
  }

  if (Date.now() - startMs >= TRIAL_MESSAGE_WINDOW_MS) {
    return 0;
  }

  return messagesUsed;
}

/** ISO time when the current 24h window ends (for UI and error copy). */
export function trialMessageWindowResetAtIso(
  windowStartedAt: string | null | undefined
): string | null {
  if (windowStartedAt == null || windowStartedAt === "") {
    return null;
  }

  const startMs = Date.parse(windowStartedAt);

  if (Number.isNaN(startMs)) {
    return null;
  }

  return new Date(startMs + TRIAL_MESSAGE_WINDOW_MS).toISOString();
}

/** User-visible paragraph for chat inline error (under the failed user message). */
export function formatTrialQuotaChatError(resetAtIso: string | null): string {
  if (!resetAtIso) {
    return "You have reached your free message allowance for this 24-hour window. Your allowance resets automatically, or open Settings to upgrade for unlimited chat.";
  }

  const resetMs = Date.parse(resetAtIso);
  const ms = resetMs - Date.now();

  if (Number.isNaN(ms) || ms <= 0) {
    return "You have reached your free message allowance for this window. Try again in a moment, or open Settings to upgrade for unlimited chat.";
  }

  const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
  const hoursLabel = hours === 1 ? "about an hour" : `about ${hours} hours`;

  return `You have used your free messages for this 24-hour window. More messages unlock in ${hoursLabel}, or open Settings to upgrade for unlimited chat.`;
}
