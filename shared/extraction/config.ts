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

export const extractionThresholds = {
  maxTagsPerNote: 6,
  rewriteConfidenceFloor: 0.78,
  /** Minimum body length after basic sanitization in shared validation (keeps tiny junk out). */
  minValidatedBodyChars: 20,
  /** After guardrails strip headings and links, the note must still have enough prose to save. */
  minPreparedBodyChars: 32,
  minPreparedBodyWords: 6
} as const;

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
