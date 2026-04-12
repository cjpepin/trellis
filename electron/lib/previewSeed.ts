import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { z } from "zod";
import type { AppSettings, ChatModel, MessageRecord } from "../ipc/types";
import { initializeDatabase, seedDatabase, type SeedDatabaseFixture } from "./database";

const previewSeedManifestSchema = z.object({
  version: z.string().min(1),
  vaultName: z.string().min(1),
  vaultFolder: z.string().min(1),
  databaseFile: z.string().min(1)
});

const previewSeedStateSchema = z.object({
  version: z.string().min(1)
});

const chatAttachmentSchema = z.object({
  kind: z.enum(["file", "url"]),
  label: z.string().min(1),
  text: z.string().min(1),
  sourceUrl: z.string().url().optional()
});

const chatMediaArtifactSeedSchema = z.object({
  kind: z.enum(["image", "generated_image"]),
  fileId: z.string().uuid(),
  mimeType: z.string().min(1),
  label: z.string().min(1),
  prompt: z.string().optional(),
  pendingGeneration: z.boolean().optional()
});

const seedFixtureSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string().min(1),
      createdAt: z.number().int(),
      updatedAt: z.number().int(),
      model: z.string().min(1),
      vaultId: z.string().min(1)
    })
  ),
  messages: z.array(
    z.object({
      id: z.string().uuid(),
      sessionId: z.string().uuid(),
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      createdAt: z.number().int(),
      tokens: z.number().int().nullable(),
      attachments: z.array(chatAttachmentSchema).optional(),
      mediaArtifacts: z.array(chatMediaArtifactSeedSchema).optional()
    })
  )
});

export interface PreviewSeedManifest {
  version: string;
  vaultName: string;
  vaultFolder: string;
  databaseFile: string;
}

export type PreviewFixtureId = "preview" | "preview-heavy";

const PREVIEW_FIXTURE_SUBDIRS: Record<PreviewFixtureId, string> = {
  preview: "preview-seed",
  "preview-heavy": "preview-heavy-seed"
};

interface PreviewSeedPaths {
  root: string;
  manifestPath: string;
}

interface EnsurePreviewSeedOptions {
  fixtureId: PreviewFixtureId;
  workspaceRoot: string;
  settingsPath: string;
  databasePath: string;
  previewStatePath: string;
  createSettings: (vaultPath: string, vaultName: string) => AppSettings;
  normalizeSettings: (rawSettings: unknown) => AppSettings;
}

function getPreviewSeedPaths(fixtureId: PreviewFixtureId): PreviewSeedPaths {
  const root = path.join(app.getAppPath(), "fixtures", PREVIEW_FIXTURE_SUBDIRS[fixtureId]);

  return {
    root,
    manifestPath: path.join(root, "manifest.json")
  };
}

export function readPreviewSeedManifest(fixtureId: PreviewFixtureId): PreviewSeedManifest {
  const seedPaths = getPreviewSeedPaths(fixtureId);
  const raw = JSON.parse(fs.readFileSync(seedPaths.manifestPath, "utf8"));
  return previewSeedManifestSchema.parse(raw);
}

function readPreviewSeedFixture(
  fixtureId: PreviewFixtureId,
  manifest: PreviewSeedManifest
): SeedDatabaseFixture {
  const seedPaths = getPreviewSeedPaths(fixtureId);
  const raw = JSON.parse(
    fs.readFileSync(path.join(seedPaths.root, manifest.databaseFile), "utf8")
  );
  const parsed = seedFixtureSchema.parse(raw);

  return {
    sessions: parsed.sessions.map((session) => ({
      ...session,
      model: session.model as ChatModel
    })),
    messages: parsed.messages as MessageRecord[]
  };
}

function readPreviewSeedVersion(previewStatePath: string): string | null {
  if (!fs.existsSync(previewStatePath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(previewStatePath, "utf8"));
    return previewSeedStateSchema.parse(raw).version;
  } catch {
    return null;
  }
}

function copySeedVault(
  fixtureId: PreviewFixtureId,
  manifest: PreviewSeedManifest,
  workspaceRoot: string
): string {
  const seedPaths = getPreviewSeedPaths(fixtureId);
  const sourceVaultPath = path.join(seedPaths.root, manifest.vaultFolder);
  const targetVaultPath = path.join(workspaceRoot, manifest.vaultName);

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.cpSync(sourceVaultPath, targetVaultPath, { recursive: true, force: true });
  return targetVaultPath;
}

async function reseedPreviewWorkspace(options: EnsurePreviewSeedOptions): Promise<AppSettings> {
  const manifest = readPreviewSeedManifest(options.fixtureId);
  fs.rmSync(options.workspaceRoot, { recursive: true, force: true });
  fs.mkdirSync(options.workspaceRoot, { recursive: true });
  const vaultPath = copySeedVault(options.fixtureId, manifest, options.workspaceRoot);
  const settings = options.normalizeSettings(
    options.createSettings(vaultPath, manifest.vaultName)
  );
  fs.writeFileSync(options.settingsPath, JSON.stringify(settings, null, 2), "utf8");
  await initializeDatabase(options.databasePath);
  const fixture = readPreviewSeedFixture(options.fixtureId, manifest);
  const vaultId = settings.vaults[0]?.id ?? "preview-main-vault";
  await seedDatabase({
    sessions: fixture.sessions.map((session) => ({
      ...session,
      vaultId
    })),
    messages: fixture.messages
  });
  fs.writeFileSync(
    options.previewStatePath,
    JSON.stringify({ version: manifest.version }, null, 2),
    "utf8"
  );
  return settings;
}

export async function ensurePreviewWorkspaceSeed(
  options: EnsurePreviewSeedOptions
): Promise<AppSettings> {
  const manifest = readPreviewSeedManifest(options.fixtureId);
  const cachedVersion = readPreviewSeedVersion(options.previewStatePath);
  const expectedVaultPath = path.join(options.workspaceRoot, manifest.vaultName);

  if (
    cachedVersion !== manifest.version ||
    !fs.existsSync(options.settingsPath) ||
    !fs.existsSync(options.databasePath) ||
    !fs.existsSync(expectedVaultPath)
  ) {
    return reseedPreviewWorkspace(options);
  }

  const rawSettings = JSON.parse(fs.readFileSync(options.settingsPath, "utf8"));
  return options.normalizeSettings(rawSettings);
}

export async function resetPreviewWorkspaceSeed(
  options: EnsurePreviewSeedOptions
): Promise<AppSettings> {
  return reseedPreviewWorkspace(options);
}
