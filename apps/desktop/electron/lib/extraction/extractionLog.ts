import { parseBooleanFlag } from "@trellis/shared/extraction/config";

/**
 * Opt-in extraction diagnostics in the Electron main process.
 * Set `TRELLIS_LOG_EXTRACTION=1` — logs counts and ids only, never message bodies.
 */
export function isExtractionLoggingEnabled(): boolean {
  return parseBooleanFlag(process.env.TRELLIS_LOG_EXTRACTION, false);
}

/**
 * One-line latency breakdown for completed jobs (prep vs LLM vs retry).
 * Set `TRELLIS_LOG_EXTRACTION_TIMING=1` in the Electron main environment.
 */
export function isExtractionTimingLogEnabled(): boolean {
  return parseBooleanFlag(process.env.TRELLIS_LOG_EXTRACTION_TIMING, false);
}

export function logExtractionTimingSummary(fields: {
  jobId: string;
  prepDurationMs: number;
  llmPrimaryDurationMs: number;
  llmRetryThoroughDurationMs: number | null;
  totalWallMs: number;
  provider: string;
  model: string;
  attemptedProvidersSummary: string;
}): void {
  if (!isExtractionTimingLogEnabled()) {
    return;
  }

  const retry =
    fields.llmRetryThoroughDurationMs === null ? "retryMs=n/a" : `retryMs=${fields.llmRetryThoroughDurationMs}`;
  console.info(
    `[trellis:extraction-timing] job=${fields.jobId} prepMs=${fields.prepDurationMs} primaryMs=${fields.llmPrimaryDurationMs} ${retry} totalMs=${fields.totalWallMs} provider=${fields.provider} model=${fields.model} attempts=${fields.attemptedProvidersSummary}`
  );
}

export function logExtraction(
  phase: string,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  if (!isExtractionLoggingEnabled()) {
    return;
  }

  const payload: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }

    payload[key] = value;
  }

  console.log(`[trellis:extraction] ${phase}`, payload);
}
