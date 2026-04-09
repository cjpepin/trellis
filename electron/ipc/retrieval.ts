import { ipcMain } from "electron";
import { z } from "zod";
import type { AppSettings } from "./types";
import {
  ipcChannels,
  type RetrievalSearchInput
} from "./types";
import { rebuildVaultEmbeddings, searchRelevantNotes } from "../lib/retrieval/index";
import { readAllNotes } from "./vault";

const retrievalSearchSchema = z.object({
  query: z.string().min(1).max(40_000),
  explicitSlugs: z.array(z.string().min(1)).max(12).optional(),
  vaultId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(12).optional()
});

function resolveVault(settings: AppSettings, vaultId?: string) {
  const resolvedVault =
    settings.vaults.find((vault) => vault.id === vaultId) ??
    settings.vaults.find((vault) => vault.id === settings.activeVaultId) ??
    settings.vaults[0];

  if (!resolvedVault) {
    throw new Error("Trellis needs at least one configured vault.");
  }

  return resolvedVault;
}

export function registerRetrievalIpc(getSettings: () => AppSettings): void {
  ipcMain.handle(ipcChannels.retrievalSearchNotes, async (_event, input: unknown) => {
    const parsed = retrievalSearchSchema.parse(input) as RetrievalSearchInput;
    const vault = resolveVault(getSettings(), parsed.vaultId);
    let results = await searchRelevantNotes({
      vaultId: vault.id,
      query: parsed.query,
      explicitSlugs: parsed.explicitSlugs,
      limit: parsed.limit
    });

    if (results.length === 0) {
      const notes = await readAllNotes(vault.path);
      await rebuildVaultEmbeddings(vault.id, notes);
      results = await searchRelevantNotes({
        vaultId: vault.id,
        query: parsed.query,
        explicitSlugs: parsed.explicitSlugs,
        limit: parsed.limit
      });
    }

    return results;
  });

  ipcMain.handle(ipcChannels.retrievalRebuildIndex, async (_event, vaultId: unknown) => {
    const resolvedVaultId = z.string().min(1).optional().parse(vaultId);
    const vault = resolveVault(getSettings(), resolvedVaultId);
    const notes = await readAllNotes(vault.path);
    return rebuildVaultEmbeddings(vault.id, notes);
  });
}
