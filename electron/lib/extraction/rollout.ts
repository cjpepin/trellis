import {
  extractionFeatureFlagNames,
  parseBooleanFlag
} from "@shared/extraction/config";

const localExtractionDisabledReason =
  "On-device note processing is turned off in this build.";

export function isLocalExtractionFeatureEnabled(): boolean {
  return parseBooleanFlag(
    process.env[extractionFeatureFlagNames.localExtraction],
    true
  );
}

export function getLocalExtractionFeatureDisabledReason(): string {
  return localExtractionDisabledReason;
}
