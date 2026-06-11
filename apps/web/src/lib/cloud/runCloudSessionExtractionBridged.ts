import type { CloudSessionExtractionResponse } from "@trellis/shared/cloud/types";
import { getTrellisApiClient } from "@/lib/cloud/client";

/** Transient but expected cases: row not visible yet, or race on session switch before messages land. */
export function isBenignCloudSessionExtractionError(message: string): boolean {
  return (
    message.includes("That chat session could not be found") ||
    message.includes("No messages in that session yet")
  );
}

const retryDelayMs = 700;

/**
 * Calls `chat-session-extract` once, then retries once after a short delay if the server
 * reports a missing session or empty transcript (common with read-after-write lag or a
 * session switch before persistence finishes).
 */
export async function runCloudSessionExtractionBridged(input: {
  workspaceId: string;
  sessionId: string;
  retryThorough?: boolean;
}): Promise<CloudSessionExtractionResponse> {
  const client = getTrellisApiClient();
  const run = (): Promise<CloudSessionExtractionResponse> =>
    client.runCloudSessionExtraction({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      ...(input.retryThorough !== undefined ? { retryThorough: input.retryThorough } : {})
    });

  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isBenignCloudSessionExtractionError(message)) {
      throw error;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, retryDelayMs);
    });
    return await run();
  }
}
