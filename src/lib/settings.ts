import type {
  AppSettings,
  ChatPrivacyMode,
  ExtractionMode,
  SubscriptionTier,
  ThemeName,
  VaultDefinition
} from "@electron/ipc/types";

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

export const extractionModeOptions: Array<{
  id: ExtractionMode;
  label: string;
}> = [
  { id: "local", label: "Local only" },
  { id: "auto", label: "Auto" },
  { id: "cloud", label: "Cloud only" }
];

export const chatPrivacyModeOptions: Array<{
  id: ChatPrivacyMode;
  label: string;
}> = [
  { id: "auto", label: "Auto" },
  { id: "off", label: "Off" },
  { id: "local", label: "Local only" }
];

export function getExtractionModeOptions(
  localExtractionEnabled: boolean,
  subscriptionTier: SubscriptionTier = "trial"
): Array<{
  id: ExtractionMode;
  label: string;
}> {
  if (subscriptionTier === "byok") {
    return extractionModeOptions.filter((option) => option.id === "local");
  }

  return localExtractionEnabled
    ? extractionModeOptions
    : extractionModeOptions.filter((option) => option.id === "cloud");
}

export function resolveExtractionModeForSubscription(
  mode: ExtractionMode,
  subscriptionTier: SubscriptionTier
): ExtractionMode {
  return subscriptionTier === "byok" ? "local" : mode;
}

export function getVaultById(
  settings: AppSettings,
  vaultId?: string | null
): VaultDefinition {
  const resolvedVault =
    settings.vaults.find((vault) => vault.id === vaultId) ??
    settings.vaults.find((vault) => vault.id === settings.activeVaultId) ??
    settings.vaults[0];

  if (!resolvedVault) {
    throw new Error("Trellis needs at least one vault.");
  }

  return resolvedVault;
}

export function getActiveVault(settings: AppSettings): VaultDefinition {
  return getVaultById(settings, settings.activeVaultId);
}

export function applyTheme(theme: ThemeName): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
}
