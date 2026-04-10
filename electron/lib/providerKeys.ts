import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { z } from "zod";
import type {
  AppWorkspaceId,
  ChatProvider,
  DeleteProviderKeyInput,
  ProviderKeyStatusSnapshot,
  SetProviderKeyInput
} from "../ipc/types";
import { getSharedAccountStoragePaths } from "./workspaces";

const providerCredentialSchema = z.object({
  apiKey: z.string().min(1),
  updatedAt: z.number().int().nonnegative()
});

const providerCredentialRecordSchema = z.object({
  openai: providerCredentialSchema.optional(),
  anthropic: providerCredentialSchema.optional()
});

type ProviderCredential = z.infer<typeof providerCredentialSchema>;
type ProviderCredentialRecord = z.infer<typeof providerCredentialRecordSchema>;

const sessionProviderKeys = new Map<AppWorkspaceId, ProviderCredentialRecord>();

function readPersistedProviderKeys(workspaceId: AppWorkspaceId): ProviderCredentialRecord {
  const providerKeysPath = getSharedAccountStoragePaths().providerKeysPath;

  if (!fs.existsSync(providerKeysPath)) {
    return {};
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return {};
  }

  try {
    const payload = fs.readFileSync(providerKeysPath);
    const raw = safeStorage.decryptString(payload);
    return providerCredentialRecordSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn("Could not restore provider keys, clearing them for this workspace.", error);
    fs.rmSync(providerKeysPath, { force: true });
    return {};
  }
}

function writePersistedProviderKeys(
  workspaceId: AppWorkspaceId,
  providerKeys: ProviderCredentialRecord
): void {
  const providerKeysPath = getSharedAccountStoragePaths().providerKeysPath;
  const hasAnyProviderKey = Boolean(providerKeys.openai || providerKeys.anthropic);

  if (!hasAnyProviderKey) {
    fs.rmSync(providerKeysPath, { force: true });
    return;
  }

  const payload = JSON.stringify(providerCredentialRecordSchema.parse(providerKeys));
  const encrypted = safeStorage.encryptString(payload);
  fs.mkdirSync(path.dirname(providerKeysPath), { recursive: true });
  fs.writeFileSync(providerKeysPath, encrypted);
}

function readProviderKeys(workspaceId: AppWorkspaceId): ProviderCredentialRecord {
  if (safeStorage.isEncryptionAvailable()) {
    return readPersistedProviderKeys(workspaceId);
  }

  return sessionProviderKeys.get(workspaceId) ?? {};
}

function writeProviderKeys(workspaceId: AppWorkspaceId, providerKeys: ProviderCredentialRecord): void {
  if (safeStorage.isEncryptionAvailable()) {
    writePersistedProviderKeys(workspaceId, providerKeys);
    return;
  }

  const hasAnyProviderKey = Boolean(providerKeys.openai || providerKeys.anthropic);

  if (!hasAnyProviderKey) {
    sessionProviderKeys.delete(workspaceId);
    return;
  }

  sessionProviderKeys.set(workspaceId, providerKeys);
}

function buildStatus(
  provider: ChatProvider,
  credential: ProviderCredential | undefined
): ProviderKeyStatusSnapshot["statuses"][number] {
  return {
    provider,
    configured: Boolean(credential),
    lastFour: credential ? credential.apiKey.slice(-4) : null,
    updatedAt: credential?.updatedAt ?? null
  };
}

export function getProviderKeyStatusSnapshot(
  workspaceId: AppWorkspaceId
): ProviderKeyStatusSnapshot {
  const providerKeys = readProviderKeys(workspaceId);

  return {
    statuses: [
      buildStatus("openai", providerKeys.openai),
      buildStatus("anthropic", providerKeys.anthropic)
    ],
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    persistenceMode: safeStorage.isEncryptionAvailable() ? "encrypted" : "session"
  };
}

export function setProviderKey(
  workspaceId: AppWorkspaceId,
  input: SetProviderKeyInput
): ProviderKeyStatusSnapshot {
  const normalizedApiKey = input.apiKey.trim();

  if (normalizedApiKey.length === 0) {
    throw new Error("Enter an API key before saving.");
  }

  const providerKeys = readProviderKeys(workspaceId);
  providerKeys[input.provider] = {
    apiKey: normalizedApiKey,
    updatedAt: Date.now()
  };
  writeProviderKeys(workspaceId, providerKeys);
  return getProviderKeyStatusSnapshot(workspaceId);
}

export function deleteProviderKey(
  workspaceId: AppWorkspaceId,
  input: DeleteProviderKeyInput
): ProviderKeyStatusSnapshot {
  const providerKeys = readProviderKeys(workspaceId);
  delete providerKeys[input.provider];
  writeProviderKeys(workspaceId, providerKeys);
  return getProviderKeyStatusSnapshot(workspaceId);
}

export function getProviderKey(
  workspaceId: AppWorkspaceId,
  provider: ChatProvider
): string | null {
  return readProviderKeys(workspaceId)[provider]?.apiKey ?? null;
}
