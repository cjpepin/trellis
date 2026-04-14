import { parseBooleanFlag } from "../../../shared/extraction/config";

/**
 * Opt-in extraction diagnostics in the Electron main process.
 * Set `TRELLIS_LOG_EXTRACTION=1` — logs counts and ids only, never message bodies.
 */
export function isExtractionLoggingEnabled(): boolean {
  return parseBooleanFlag(process.env.TRELLIS_LOG_EXTRACTION, false);
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
