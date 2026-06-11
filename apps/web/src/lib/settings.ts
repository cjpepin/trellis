import type {
  AppSettings,
  ChatPrivacyMode,
  ExtractionMode,
  SubscriptionTier,
  ThemeName,
  BucketDefinition
} from "@trellis/contracts";

export const themeOptions: Array<{ id: ThemeName; label: string }> = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "nature-dark", label: "Nature · dark" },
  { id: "nature-light", label: "Nature · light" },
  { id: "ocean-dark", label: "Ocean · dark" },
  { id: "ocean-light", label: "Ocean · light" },
  { id: "high-contrast", label: "High Contrast" },
  { id: "twilight", label: "Twilight" },
  { id: "dawn", label: "Dawn" },
  { id: "graphite", label: "Graphite" },
  { id: "cream", label: "Cream" },
  { id: "ember", label: "Ember" },
  { id: "fog", label: "Fog" }
];

export const chatPrivacyModeOptions: Array<{
  id: ChatPrivacyMode;
  label: string;
}> = [
  { id: "auto", label: "Auto" },
  { id: "off", label: "Off" },
  { id: "local", label: "Local only" }
];

export function resolveExtractionModeForSubscription(
  _mode: ExtractionMode,
  _subscriptionTier: SubscriptionTier
): ExtractionMode {
  return "local";
}

export function getBucketById(
  settings: AppSettings,
  bucketId?: string | null
): BucketDefinition {
  const resolved =
    settings.buckets.find((b) => b.id === bucketId) ??
    settings.buckets.find((b) => b.id === settings.activeBucketId) ??
    settings.buckets[0];

  if (!resolved) {
    throw new Error("Trellis needs at least one bucket.");
  }

  return resolved;
}

export function getActiveBucket(settings: AppSettings): BucketDefinition {
  return getBucketById(settings, settings.activeBucketId);
}

export function applyTheme(theme: ThemeName): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
}
