import type {
  AppSettings,
  ExtractionMode,
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
  { id: "high-contrast", label: "High Contrast" }
];

export const extractionModeOptions: Array<{
  id: ExtractionMode;
  label: string;
}> = [
  { id: "local", label: "Local only" },
  { id: "auto", label: "Auto" },
  { id: "cloud", label: "Cloud only" }
];

export function getExtractionModeOptions(localExtractionEnabled: boolean): Array<{
  id: ExtractionMode;
  label: string;
}> {
  return localExtractionEnabled
    ? extractionModeOptions
    : extractionModeOptions.filter((option) => option.id === "cloud");
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
