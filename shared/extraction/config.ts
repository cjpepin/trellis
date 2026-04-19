export const extractionFeatureFlagNames = {
  localExtraction: "TRELLIS_FEATURE_LOCAL_EXTRACTION",
  heuristicFallback: "TRELLIS_ENABLE_HEURISTIC_EXTRACTION_FALLBACK"
} as const;

/**
 * Logical id for the single on-device note processor download (GGUF path in app data, not this string).
 * Settings and first-run refer to this id.
 */
export const defaultLocalExtractionModelId = "trellis-ondevice-extractor";

/** GGUF filename stored under the app userData extraction folder. */
export const embeddedExtractionGgufFilename = "Qwen2.5-3B-Instruct-Q4_K_M.gguf";

/**
 * Default HTTPS URL for that GGUF. Override with `TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL` in the main process.
 * Uses Hugging Face `resolve` links; large file, downloaded once.
 */
export const defaultEmbeddedExtractionModelDownloadUrl =
  "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf";

/** Approximate size for UI copy; varies slightly by mirror. */
export const defaultLocalExtractionModelApproxDownload = "2.2 GB";

/**
 * Default number of top-matching note chunks passed into extraction and (when omitted) retrieval IPC.
 * Keeps prompt context rich while staying within model limits (see extraction-v2 §7.3).
 */
export const relatedNotesRetrievalDefaultLimit = 12;

/** Wider retrieval for main-process extraction jobs only (chat context keeps default). */
export const extractionJobRelatedNotesLimit = 16;

export const extractionThresholds = {
  maxTagsPerNote: 6,
  rewriteConfidenceFloor: 0.72,
  /** Minimum body length after basic sanitization in shared validation (keeps tiny junk out). */
  minValidatedBodyChars: 20,
  /** After guardrails strip headings and links, the note must still have enough prose to save. */
  minPreparedBodyChars: 32,
  minPreparedBodyWords: 6
} as const;

/** Total attempts the queue will make before marking a job failed. */
export const extractionDefaultMaxAttempts = 3;

/** Priority value used for user-initiated ("manual") extraction triggers; higher runs first. */
export const extractionManualTriggerPriority = 10;

/**
 * Backoff schedule (ms) for retried jobs. `extractionRetryBackoffMs[n]` is waited before the
 * (n+1)-th attempt. Values beyond the array use the last entry.
 */
export const extractionRetryBackoffMs = [15_000, 60_000, 180_000] as const;

export function extractionRetryDelayMs(attemptNumber: number): number {
  const index =
    attemptNumber < 1
      ? 0
      : Math.min(attemptNumber - 1, extractionRetryBackoffMs.length - 1);
  return extractionRetryBackoffMs[index] ?? extractionRetryBackoffMs[0];
}

export function parseBooleanFlag(
  value: string | null | undefined,
  defaultValue: boolean
): boolean {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.length === 0) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}
