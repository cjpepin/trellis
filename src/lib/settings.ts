import type { AppSettings, ThemeName, VaultDefinition } from "@electron/ipc/types";

export const themeOptions: Array<{ id: ThemeName; label: string }> = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "nature", label: "Nature" },
  { id: "high-contrast", label: "High Contrast" }
];

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
