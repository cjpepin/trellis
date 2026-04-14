/** Heuristic for automatic chat model tier selection (see `src/lib/chatModelRouting.ts`). */
export type ChatComplexityTier = "low" | "medium" | "high";

export interface ChatModelRoutingSignals {
  userTextLength: number;
  transcriptMessageCount: number;
  hasVisionInTurn: boolean;
  nonImageAttachmentCount: number;
}

export function inferChatComplexity(signals: ChatModelRoutingSignals): ChatComplexityTier {
  let score = 0;
  const { userTextLength, transcriptMessageCount, hasVisionInTurn, nonImageAttachmentCount } =
    signals;

  if (userTextLength > 8000) {
    score += 2;
  } else if (userTextLength > 2500) {
    score += 1;
  }

  if (transcriptMessageCount > 48) {
    score += 2;
  } else if (transcriptMessageCount > 20) {
    score += 1;
  }

  if (hasVisionInTurn) {
    score += 1;
  }

  if (nonImageAttachmentCount > 2) {
    score += 1;
  }

  if (score >= 4) {
    return "high";
  }

  if (score >= 2) {
    return "medium";
  }

  return "low";
}
