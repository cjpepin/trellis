import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { z } from "zod";
import { registerChatIpc } from "./ipc/chat";
import { registerChatAttachmentIpc } from "./ipc/chatAttachment";
import { registerMediaIpc } from "./ipc/media";
import { registerDatabaseIpc } from "./ipc/db";
import { registerExtractionIpc } from "./ipc/extraction";
import { registerIngestIpc } from "./ipc/ingest";
import { registerRetrievalIpc } from "./ipc/retrieval";
import { createExtractionOrchestrator } from "./lib/extraction/orchestrator";
import {
  getLocalExtractionFeatureDisabledReason,
  isLocalExtractionFeatureEnabled
} from "./lib/extraction/rollout";
import { applyElectronTestPathOverrides } from "./lib/appPaths";
import { ensurePreviewWorkspaceSeed, readPreviewSeedManifest, resetPreviewWorkspaceSeed } from "./lib/previewSeed";
import {
  getSharedAccountStoragePaths,
  getWorkspaceInfo,
  getWorkspacePaths,
  listWorkspaceInfos,
  migrateLegacyPersonalWorkspace,
  readWorkspaceState,
  workspaceIds,
  writeWorkspaceState,
  type WorkspaceState
} from "./lib/workspaces";
import {
  buildSnapshot,
  ensureVaultLayout,
  registerVaultIpc
} from "./ipc/vault";
import { getProviderKeyStatusSnapshot } from "./lib/providerKeys";
import { defaultLocalExtractionModelId } from "../shared/extraction/config";
import {
  ipcChannels,
  type AppBootstrap,
  type AppFeatureFlags,
  type AppSettings,
  type ChatSettings,
  type AppWorkspaceId,
  type AuthSessionSnapshot,
  type ExtractionSettings,
  type SwitchWorkspaceInput,
  type ThemeName,
  type VaultDefinition
} from "./ipc/types";
import { closeDatabase, initializeDatabase, listSessions } from "./lib/database";

const themeValues = [
  "dark",
  "light",
  "nature-dark",
  "nature-light",
  "ocean-dark",
  "ocean-light",
  "high-contrast",
  "twilight",
  "dawn",
  "graphite",
  "cream",
  "ember",
  "fog"
] as const satisfies readonly ThemeName[];

const themeSchema = z.preprocess(
  (value) => (value === "nature" ? "nature-dark" : value),
  z.enum(themeValues)
);

const vaultDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  path: z.string().min(1)
});

const settingsSchema = z.object({
  vaults: z.array(vaultDefinitionSchema).min(1),
  activeVaultId: z.string().min(1),
  theme: themeSchema,
  rememberSession: z.boolean().optional(),
  chat: z
    .object({
      privacyMode: z.enum(["auto", "off", "local"]).optional(),
      readAloudAutoPlay: z.boolean().optional()
    })
    .optional(),
  extraction: z
    .object({
      mode: z.enum(["auto", "cloud", "local"]).optional(),
      preferredLocalModelId: z.string().min(1).nullable().optional()
    })
    .optional()
});

const legacySettingsSchema = z.object({
  vaultPath: z.string().min(1)
});

const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().optional(),
  user: z.object({
    id: z.string().min(1),
    email: z.string().nullable().optional()
  })
});

let mainWindow: BrowserWindow | null = null;
let currentWorkspaceState: WorkspaceState = {
  activeWorkspaceId: "personal",
  hasCompletedSelection: false
};
let currentSettings: AppSettings = createDefaultSettings();
let hasWarnedAboutSessionPersistence = false;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let extractionOrchestrator: ReturnType<typeof createExtractionOrchestrator> | null = null;
let previewSeedVersion: string | null = null;

function getCurrentWorkspaceId(): AppWorkspaceId {
  return currentWorkspaceState.activeWorkspaceId;
}

function getCurrentWorkspacePaths() {
  return getWorkspacePaths(getCurrentWorkspaceId());
}

function getSettingsPath(): string {
  return getCurrentWorkspacePaths().settingsPath;
}

function getAuthPath(): string {
  return getSharedAccountStoragePaths().authPath;
}

function getDefaultVaultPath(workspaceId: AppWorkspaceId): string {
  if (workspaceId === "preview") {
    return path.join(getWorkspacePaths("preview").root, "Preview Vault");
  }

  return path.join(app.getPath("documents"), "Trellis Vault");
}

function getWindowBackgroundColor(theme: ThemeName): string {
  if (theme === "light") {
    return "#f4efe4";
  }

  if (theme === "nature-light") {
    return "#eef1ea";
  }

  if (theme === "ocean-light") {
    return "#f0f4f8";
  }

  if (theme === "nature-dark") {
    return "#121814";
  }

  if (theme === "ocean-dark") {
    return "#0c1418";
  }

  if (theme === "high-contrast") {
    return "#000000";
  }

  if (theme === "twilight") {
    return "#13101a";
  }

  if (theme === "dawn") {
    return "#faf5f2";
  }

  if (theme === "graphite") {
    return "#131518";
  }

  if (theme === "cream") {
    return "#f4efe6";
  }

  if (theme === "ember") {
    return "#161210";
  }

  if (theme === "fog") {
    return "#eceef2";
  }

  return "#0f0f0f";
}

function createVaultDefinition(targetPath: string, name = "Main Vault"): VaultDefinition {
  return {
    id: crypto.randomUUID(),
    name,
    path: targetPath
  };
}

function createDefaultExtractionSettings(): ExtractionSettings {
  const localExtractionEnabled = isLocalExtractionFeatureEnabled();

  return {
    // Prefer on-device when installed, but fall back to cloud until the GGUF is present.
    mode: localExtractionEnabled ? "auto" : "cloud",
    preferredLocalModelId: localExtractionEnabled ? defaultLocalExtractionModelId : null
  };
}

function createDefaultChatSettings(): ChatSettings {
  return {
    privacyMode: "auto",
    readAloudAutoPlay: false
  };
}

function createDefaultSettings(workspaceId: AppWorkspaceId = getCurrentWorkspaceId()): AppSettings {
  const vault = createVaultDefinition(
    getDefaultVaultPath(workspaceId),
    workspaceId === "preview" ? "Preview Vault" : "Main Vault"
  );

  return {
    vaults: [vault],
    activeVaultId: vault.id,
    theme: "light",
    rememberSession: true,
    chat: createDefaultChatSettings(),
    extraction: createDefaultExtractionSettings()
  };
}

function getAppFeatureFlags(): AppFeatureFlags {
  return {
    localExtraction: isLocalExtractionFeatureEnabled()
  };
}

function normalizeSettings(rawSettings: unknown): AppSettings {
  const parsedLegacy = legacySettingsSchema.safeParse(rawSettings);

  if (parsedLegacy.success) {
    const vault = createVaultDefinition(parsedLegacy.data.vaultPath);
    return {
      vaults: [vault],
      activeVaultId: vault.id,
      theme: "light",
      rememberSession: true,
      chat: createDefaultChatSettings(),
      extraction: createDefaultExtractionSettings()
    };
  }

  const parsed = settingsSchema.parse(rawSettings);
  const firstVault = parsed.vaults[0];

  if (!firstVault) {
    throw new Error("Trellis needs at least one vault in settings.");
  }

  const activeVaultExists = parsed.vaults.some((vault) => vault.id === parsed.activeVaultId);
  const localExtractionEnabled = isLocalExtractionFeatureEnabled();
  const extractionMode =
    parsed.extraction?.mode ?? (localExtractionEnabled ? "auto" : "cloud");

  return {
    vaults: parsed.vaults,
    activeVaultId: activeVaultExists ? parsed.activeVaultId : firstVault.id,
    theme: parsed.theme,
    rememberSession: parsed.rememberSession ?? true,
    chat: {
      privacyMode: parsed.chat?.privacyMode ?? "auto",
      readAloudAutoPlay: parsed.chat?.readAloudAutoPlay ?? false
    },
    extraction: {
      mode:
        localExtractionEnabled || extractionMode === "cloud"
          ? extractionMode
          : "cloud",
      preferredLocalModelId: localExtractionEnabled
        ? parsed.extraction?.preferredLocalModelId ?? defaultLocalExtractionModelId
        : null
    }
  };
}

function getActiveVault(settings: AppSettings, preferredVaultId?: string): VaultDefinition {
  const resolvedVault =
    settings.vaults.find((vault) => vault.id === preferredVaultId) ??
    settings.vaults.find((vault) => vault.id === settings.activeVaultId) ??
    settings.vaults[0];

  if (!resolvedVault) {
    throw new Error("Trellis needs at least one vault in settings.");
  }

  return resolvedVault;
}

async function ensureAllVaultLayouts(settings: AppSettings): Promise<void> {
  await Promise.all(settings.vaults.map((vault) => ensureVaultLayout(vault.path)));
}

function createPreviewSettings(vaultPath: string, vaultName: string): AppSettings {
  const vault = createVaultDefinition(vaultPath, vaultName);

  return {
    vaults: [vault],
    activeVaultId: vault.id,
    theme: "light",
    rememberSession: getSharedRememberSessionDefault(),
    chat: createDefaultChatSettings(),
    extraction: {
      mode: isLocalExtractionFeatureEnabled() ? "local" : "cloud",
      preferredLocalModelId: isLocalExtractionFeatureEnabled()
        ? defaultLocalExtractionModelId
        : null
    }
  };
}

function getSharedRememberSessionDefault(): boolean {
  const settingsCandidates = [
    getWorkspacePaths("personal").settingsPath,
    getWorkspacePaths("preview").settingsPath
  ];

  for (const settingsPath of settingsCandidates) {
    if (!fs.existsSync(settingsPath)) {
      continue;
    }

    try {
      return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).rememberSession;
    } catch (error) {
      console.warn("Could not read remembered sign-in preference, trying the next workspace.", error);
    }
  }

  return true;
}

function canPersistAuthSession(): boolean {
  const available = safeStorage.isEncryptionAvailable();

  if (!available && !hasWarnedAboutSessionPersistence) {
    hasWarnedAboutSessionPersistence = true;
    console.warn(
      "Electron safeStorage encryption is unavailable. Trellis will keep account sessions in memory only."
    );
  }

  return available;
}

function parseExternalUrl(url: unknown): string {
  const parsedUrl = new URL(z.string().url().parse(url));

  if (parsedUrl.protocol !== "https:") {
    throw new Error("Only https URLs can be opened externally.");
  }

  return parsedUrl.toString();
}

function pathsEqualNormalized(left: string, right: string): boolean {
  const a = path.normalize(left);
  const b = path.normalize(right);

  if (process.platform === "win32") {
    return a.toLowerCase() === b.toLowerCase();
  }

  return a === b;
}

function isAllowedVaultFolderPath(resolvedPath: string, vaults: VaultDefinition[]): boolean {
  return vaults.some((vault) => pathsEqualNormalized(path.resolve(vault.path), resolvedPath));
}

function getFunctionsBaseUrl(): string {
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();

  if (!supabaseUrl) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  return `${supabaseUrl}/functions/v1`;
}

function getPublishableKey(): string {
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!publishableKey) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  return publishableKey;
}

async function readFunctionError(response: Response, fallbackMessage: string): Promise<Error> {
  const text = await response.text();

  try {
    const payload = JSON.parse(text) as {
      error?: string;
      message?: string;
    };

    if (typeof payload.error === "string" && payload.error.length > 0) {
      return new Error(payload.error);
    }

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return new Error(payload.message);
    }
  } catch {
    if (text.length > 0) {
      return new Error(text);
    }
  }

  return new Error(fallbackMessage);
}

function readSettingsFromPath(settingsPath: string, workspaceId: AppWorkspaceId): AppSettings {
  if (!fs.existsSync(settingsPath)) {
    return createDefaultSettings(workspaceId);
  }

  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    console.warn("Could not read Trellis settings, falling back to defaults.", error);
    return createDefaultSettings(workspaceId);
  }
}

function readSettings(): AppSettings {
  return readSettingsFromPath(getSettingsPath(), getCurrentWorkspaceId());
}

function writeSettings(nextSettings: AppSettings): AppSettings {
  currentSettings = normalizeSettings(nextSettings);
  const settingsPath = getSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2), "utf8");
  syncRememberSessionAcrossWorkspaces(currentSettings.rememberSession, getCurrentWorkspaceId());
  return currentSettings;
}

function syncRememberSessionAcrossWorkspaces(
  rememberSession: boolean,
  sourceWorkspaceId: AppWorkspaceId
): void {
  for (const workspaceId of workspaceIds) {
    if (workspaceId === sourceWorkspaceId) {
      continue;
    }

    const settingsPath = getWorkspacePaths(workspaceId).settingsPath;

    if (!fs.existsSync(settingsPath)) {
      continue;
    }

    try {
      const nextSettings = readSettingsFromPath(settingsPath, workspaceId);

      if (nextSettings.rememberSession === rememberSession) {
        continue;
      }

      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ ...nextSettings, rememberSession }, null, 2),
        "utf8"
      );
    } catch (error) {
      console.warn("Could not sync sign-in persistence across workspaces.", error);
    }
  }
}

async function ensureWorkspaceReady(
  workspaceId: AppWorkspaceId,
  options?: { forcePreviewReset?: boolean }
): Promise<void> {
  const paths = getWorkspacePaths(workspaceId);
  fs.mkdirSync(paths.root, { recursive: true });

  if (workspaceId === "preview") {
    const settings =
      options?.forcePreviewReset
        ? await resetPreviewWorkspaceSeed({
            workspaceRoot: paths.root,
            settingsPath: paths.settingsPath,
            databasePath: paths.databasePath,
            previewStatePath: paths.previewSeedStatePath,
            createSettings: createPreviewSettings,
            normalizeSettings
          })
        : await ensurePreviewWorkspaceSeed({
            workspaceRoot: paths.root,
            settingsPath: paths.settingsPath,
            databasePath: paths.databasePath,
            previewStatePath: paths.previewSeedStatePath,
            createSettings: createPreviewSettings,
            normalizeSettings
          });

    currentSettings = normalizeSettings(settings);
    await ensureAllVaultLayouts(currentSettings);
    return;
  }

  currentSettings = readSettingsFromPath(paths.settingsPath, workspaceId);
  await ensureAllVaultLayouts(currentSettings);
  if (!fs.existsSync(paths.settingsPath)) {
    fs.writeFileSync(paths.settingsPath, JSON.stringify(currentSettings, null, 2), "utf8");
  }
}

function readAuthSession(): AuthSessionSnapshot | null {
  const authPath = getAuthPath();

  if (!fs.existsSync(authPath)) {
    return null;
  }

  if (!canPersistAuthSession()) {
    clearAuthSession();
    return null;
  }

  try {
    const payload = fs.readFileSync(authPath);
    const raw = safeStorage.decryptString(payload);

    return authSessionSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn("Could not restore the persisted auth session, clearing it.", error);
    clearAuthSession();
    return null;
  }
}

function writeAuthSession(session: AuthSessionSnapshot): void {
  if (!canPersistAuthSession()) {
    clearAuthSession();
    return;
  }

  const parsed = authSessionSchema.parse(session);
  const payload = JSON.stringify(parsed);
  const serialized = safeStorage.encryptString(payload);

  fs.mkdirSync(path.dirname(getAuthPath()), { recursive: true });
  fs.writeFileSync(getAuthPath(), serialized);
}

function clearAuthSession(): void {
  const authPath = getAuthPath();

  if (fs.existsSync(authPath)) {
    fs.unlinkSync(authPath);
  }
}

function getSettings(): AppSettings {
  return currentSettings;
}

function getWorkspace() {
  return getWorkspaceInfo(getCurrentWorkspaceId(), previewSeedVersion);
}

function notifyExtractionJobUpdate(notification: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(ipcChannels.extractionJobUpdated, notification);
    }
  }
}

async function buildBootstrapPayload(): Promise<AppBootstrap> {
  const sessions = await listSessions();
  const preferredVaultId = sessions[0]?.vaultId || currentSettings.activeVaultId;
  const activeVault = getActiveVault(currentSettings, preferredVaultId);

  if (activeVault.id !== currentSettings.activeVaultId) {
    currentSettings = writeSettings({
      ...currentSettings,
      activeVaultId: activeVault.id
    });
  }

  const vault = await buildSnapshot(activeVault.path, activeVault.id, activeVault.name);

  return {
    settings: currentSettings,
    features: getAppFeatureFlags(),
    workspace: getWorkspace(),
    workspaces: listWorkspaceInfos(previewSeedVersion),
    providerKeys: getProviderKeyStatusSnapshot(getCurrentWorkspaceId()),
    needsWorkspaceChoice: !currentWorkspaceState.hasCompletedSelection,
    authSession: readAuthSession(),
    sessions: sessions.map((session) => ({
      ...session,
      vaultId: session.vaultId || activeVault.id
    })),
    notes: vault.notes,
    folders: vault.folders,
    graph: vault.graph
  };
}

async function rebindWorkspace(
  workspaceId: AppWorkspaceId,
  options?: { completeSelection?: boolean; forcePreviewReset?: boolean }
): Promise<AppBootstrap> {
  currentWorkspaceState = writeWorkspaceState({
    activeWorkspaceId: workspaceId,
    hasCompletedSelection:
      currentWorkspaceState.hasCompletedSelection || Boolean(options?.completeSelection)
  });

  await closeDatabase();
  await ensureWorkspaceReady(workspaceId, {
    forcePreviewReset: options?.forcePreviewReset
  });
  await initializeDatabase(getWorkspacePaths(workspaceId).databasePath);
  extractionOrchestrator = createExtractionOrchestrator({
    getSettings,
    getAuthSession: () => readAuthSession(),
    notifyJobUpdate: notifyExtractionJobUpdate
  });
  await extractionOrchestrator.resumePendingJobs();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(getWindowBackgroundColor(currentSettings.theme));
  }

  return buildBootstrapPayload();
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: getWindowBackgroundColor(currentSettings.theme),
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devServerUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
  const builtIndexPath = path.join(__dirname, "../renderer/index.html");

  if (devServerUrl) {
    mainWindow
      .loadURL(devServerUrl)
      .catch(async (error) => {
        console.warn(`Could not load dev server at ${devServerUrl}, falling back to built assets.`, error);

        if (fs.existsSync(builtIndexPath)) {
          await mainWindow?.loadFile(builtIndexPath);
          return;
        }

        throw error;
      })
      .catch((error) => {
        reportMainProcessError(error, "Could not load the Trellis renderer.");
      });
  } else {
    mainWindow.loadFile(builtIndexPath).catch((error) => {
      reportMainProcessError(error, "Could not load the built Trellis renderer.");
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerAppIpc(): void {
  const checkoutSessionInputSchema = z.object({
    accessToken: z.string().min(1),
    plan: z.enum(["byok", "pro"])
  });

  ipcMain.handle(ipcChannels.appBootstrap, async () => buildBootstrapPayload());
  ipcMain.handle(ipcChannels.settingsGet, async () => currentSettings);
  ipcMain.handle(ipcChannels.settingsSet, async (_event, settings: unknown) => {
    const parsed = normalizeSettings(settings);

    if (!getAppFeatureFlags().localExtraction && parsed.extraction.mode !== "cloud") {
      console.warn(getLocalExtractionFeatureDisabledReason());
    }

    await ensureAllVaultLayouts(parsed);
    return writeSettings(parsed);
  });
  ipcMain.handle(ipcChannels.workspaceGet, async () => getWorkspace());
  ipcMain.handle(ipcChannels.workspaceList, async () => listWorkspaceInfos(previewSeedVersion));
  ipcMain.handle(ipcChannels.workspaceSwitch, async (_event, input: unknown) => {
    const parsed = z
      .object({
        workspaceId: z.enum(["personal", "preview"]),
        completeSelection: z.boolean().optional()
      })
      .parse(input) as SwitchWorkspaceInput;

    return rebindWorkspace(parsed.workspaceId, {
      completeSelection: parsed.completeSelection
    });
  });
  ipcMain.handle(ipcChannels.workspaceResetPreview, async () => {
    if (getCurrentWorkspaceId() !== "preview") {
      throw new Error("Switch to the preview workspace before resetting it.");
    }

    return rebindWorkspace("preview", {
      forcePreviewReset: true
    });
  });
  ipcMain.handle(ipcChannels.authGet, async () => readAuthSession());
  ipcMain.handle(ipcChannels.authSet, async (_event, session: unknown) => {
    writeAuthSession(authSessionSchema.parse(session));
  });
  ipcMain.handle(ipcChannels.authClear, async () => {
    clearAuthSession();
  });
  ipcMain.handle(ipcChannels.billingCreateCheckoutSession, async (_event, input: unknown) => {
    const parsed = checkoutSessionInputSchema.parse(input);
    const response = await fetch(`${getFunctionsBaseUrl()}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: getPublishableKey(),
        Authorization: `Bearer ${parsed.accessToken}`
      },
      body: JSON.stringify({
        plan: parsed.plan
      })
    });

    if (!response.ok) {
      throw await readFunctionError(response, "Could not open the checkout page.");
    }

    return response.json();
  });
  ipcMain.handle(ipcChannels.shellOpenPath, async (_event, targetPath: unknown) => {
    const parsedPath = z.string().min(1).parse(targetPath);
    const resolved = path.resolve(parsedPath);

    if (!isAllowedVaultFolderPath(resolved, getSettings().vaults)) {
      throw new Error("Only vault folders configured in Trellis can be opened from here.");
    }

    await shell.openPath(resolved);
  });
  ipcMain.handle(ipcChannels.shellOpenExternal, async (_event, url: unknown) => {
    const parsedUrl = parseExternalUrl(url);
    await shell.openExternal(parsedUrl);
  });
}

function formatStartupError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown startup error.";
  }

  if (error.message.includes("NODE_MODULE_VERSION")) {
    return [
      "A native module was built for a different runtime than Electron.",
      "",
      "Run `npm run rebuild:native` and restart the app.",
      "",
      error.message
    ].join("\n");
  }

  return error.message;
}

function reportMainProcessError(error: unknown, title: string): void {
  const detail = formatStartupError(error);
  console.error(title, error);

  if (app.isReady()) {
    dialog.showErrorBox("Trellis encountered an error", detail);
  }
}

async function bootstrapApplication(): Promise<void> {
  previewSeedVersion = readPreviewSeedManifest().version;
  migrateLegacyPersonalWorkspace();
  currentWorkspaceState = writeWorkspaceState(readWorkspaceState());
  await ensureWorkspaceReady(currentWorkspaceState.activeWorkspaceId);
  await initializeDatabase(getWorkspacePaths(currentWorkspaceState.activeWorkspaceId).databasePath);
  extractionOrchestrator = createExtractionOrchestrator({
    getSettings,
    getAuthSession: () => readAuthSession(),
    notifyJobUpdate: notifyExtractionJobUpdate
  });
  registerAppIpc();
  registerDatabaseIpc();
  registerExtractionIpc({
    queueSession: async (input) => {
      if (!extractionOrchestrator) {
        throw new Error("Note processing is not ready yet.");
      }

      return extractionOrchestrator.queueSession(input);
    }
  });
  registerVaultIpc(getSettings);
  registerRetrievalIpc(getSettings);
  registerIngestIpc(getSettings);
  registerChatIpc({
    getSettings,
    getWorkspaceId: getCurrentWorkspaceId
  });
  registerMediaIpc({ getWorkspaceId: getCurrentWorkspaceId });
  registerChatAttachmentIpc();
  createMainWindow();
  await extractionOrchestrator.resumePendingJobs();
}

app.whenReady()
  .then(async () => {
    applyElectronTestPathOverrides();
    try {
      await bootstrapApplication();
    } catch (error) {
      const detail = formatStartupError(error);
      console.error("Trellis failed during startup.", error);
      dialog.showErrorBox("Trellis couldn't start", detail);
      app.quit();
    }
  })
  .catch((error) => {
    const detail = formatStartupError(error);
    console.error("Trellis failed before startup completed.", error);
    dialog.showErrorBox("Trellis couldn't start", detail);
    app.quit();
  });

process.on("unhandledRejection", (error) => {
  reportMainProcessError(error, "Unhandled promise rejection in Electron main process.");
});

process.on("uncaughtException", (error) => {
  reportMainProcessError(error, "Uncaught exception in Electron main process.");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
