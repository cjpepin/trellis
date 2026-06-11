export const extractionFeatureFlagNames = {
  localExtraction: "TRELLIS_FEATURE_LOCAL_EXTRACTION",
  cloudExtraction: "TRELLIS_FEATURE_CLOUD_EXTRACTION",
  heuristicFallback: "TRELLIS_ENABLE_HEURISTIC_EXTRACTION_FALLBACK"
} as const;

export const cloudExtractionModels = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5"
} as const;

/**
 * Max completion tokens for cloud extraction APIs. Structured JSON is typically far smaller;
 * capping reduces worst-case latency vs 4096 without affecting normal runs.
 */
export const cloudExtractionMaxOutputTokens = 3072;

/** On-device extraction: cap completion size (structured JSON is typically far smaller). */
export const embeddedExtractionMaxTokensPrimary = 2048;

/** Slightly tighter cap on the embedded “retry thorough” pass. */
export const embeddedExtractionMaxTokensRetry = 1536;

/**
 * Skip the second embedded pass when the transcript has at most this many turns
 * (e.g. 2 = a single user+assistant exchange), to avoid doubling latency on short chats.
 */
export const extractionRetryShortTranscriptMaxTurns = 2;

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

/**
 * SHA-256 (hex) of the canonical GGUF at `defaultEmbeddedExtractionModelDownloadUrl` for this app revision.
 * Filled when the default artifact is pinned; when null, install still checks size (Content-Length) but not hash.
 */
export const embeddedExtractionGgufSha256Hex: string | null = null;

/** Approximate size for UI copy; varies slightly by mirror. */
export const defaultLocalExtractionModelApproxDownload = "2.2 GB";

/**
 * Default number of top-matching note chunks passed into extraction and (when omitted) retrieval IPC.
 * Keeps prompt context rich while staying within model limits (see extraction-v2 §7.3).
 */
export const relatedNotesRetrievalDefaultLimit = 12;

/** Wider retrieval for main-process extraction jobs only (chat context keeps default). */
export const extractionJobRelatedNotesLimit = 16;

/** Lexical retrieval scoring (hybrid with semantic in `electron/lib/retrieval/index.ts`). */
export const retrievalLexicalWeights = {
  titlePhraseMatch: 18,
  headingPhraseMatch: 10,
  tokenHitInTitle: 4,
  tokenHitElsewhere: 2
} as const;

export const extractionThresholds = {
  maxTagsPerNote: 6,
  /** Tuned for extraction eval: balances false positives vs missed rewrites (see extraction contract tests). */
  rewriteConfidenceFloor: 0.72,
  /**
   * When false, validated payloads coerce `merge` to `append` with a flattened body (no sectionPatches).
   * Toggle via `ExtractionValidationOptions.mergeOperationEnabled` from the extraction runtime.
   */
  mergeOperationEnabled: true,
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
