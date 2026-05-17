import {
  extractionFeatureFlagNames,
  parseBooleanFlag
} from "@trellis/shared/extraction/config";

const localExtractionDisabledReason =
  "On-device note processing is turned off in this build.";

export function isLocalExtractionFeatureEnabled(): boolean {
  return parseBooleanFlag(
    process.env[extractionFeatureFlagNames.localExtraction],
    true
  );
}

/** When off, extraction stays on-device only for all sessions. Default on; set `TRELLIS_FEATURE_CLOUD_EXTRACTION=0` to disable. */
export function isCloudExtractionFeatureEnabled(): boolean {
  return parseBooleanFlag(process.env[extractionFeatureFlagNames.cloudExtraction], true);
}

export function getLocalExtractionFeatureDisabledReason(): string {
  return localExtractionDisabledReason;
}
