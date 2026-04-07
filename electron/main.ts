import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { z } from "zod";
import { registerDatabaseIpc } from "./ipc/db";
import { registerIngestIpc } from "./ipc/ingest";
import {
  buildSnapshot,
  ensureVaultLayout,
  registerVaultIpc
} from "./ipc/vault";
import {
  ipcChannels,
  type AppBootstrap,
  type AppSettings,
  type AuthSessionSnapshot,
  type ThemeName,
  type VaultDefinition
} from "./ipc/types";
import { initializeDatabase, listSessions } from "./lib/database";

const themeValues = ["dark", "light", "nature", "high-contrast"] as const satisfies readonly ThemeName[];
const themeSchema = z.enum(themeValues);

const vaultDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  path: z.string().min(1)
});

const settingsSchema = z.object({
  vaults: z.array(vaultDefinitionSchema).min(1),
  activeVaultId: z.string().min(1),
  theme: themeSchema,
  rememberSession: z.boolean().optional()
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
let currentSettings: AppSettings = createDefaultSettings();
let hasWarnedAboutSessionPersistence = false;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function getAuthPath(): string {
  return path.join(app.getPath("userData"), "supabase-session.bin");
}

function getDefaultVaultPath(): string {
  return path.join(app.getPath("documents"), "Trellis Vault");
}

function getWindowBackgroundColor(theme: ThemeName): string {
  if (theme === "light") {
    return "#f4efe4";
  }

  if (theme === "nature") {
    return "#121814";
  }

  if (theme === "high-contrast") {
    return "#000000";
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

function createDefaultSettings(): AppSettings {
  const vault = createVaultDefinition(getDefaultVaultPath());

  return {
    vaults: [vault],
    activeVaultId: vault.id,
    theme: "dark",
    rememberSession: true
  };
}

function normalizeSettings(rawSettings: unknown): AppSettings {
  const parsedLegacy = legacySettingsSchema.safeParse(rawSettings);

  if (parsedLegacy.success) {
    const vault = createVaultDefinition(parsedLegacy.data.vaultPath);
    return {
      vaults: [vault],
      activeVaultId: vault.id,
      theme: "dark",
      rememberSession: true
    };
  }

  const parsed = settingsSchema.parse(rawSettings);
  const firstVault = parsed.vaults[0];

  if (!firstVault) {
    throw new Error("Trellis needs at least one vault in settings.");
  }

  const activeVaultExists = parsed.vaults.some((vault) => vault.id === parsed.activeVaultId);

  return {
    vaults: parsed.vaults,
    activeVaultId: activeVaultExists ? parsed.activeVaultId : firstVault.id,
    theme: parsed.theme,
    rememberSession: parsed.rememberSession ?? true
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

function readSettings(): AppSettings {
  const settingsPath = getSettingsPath();

  if (!fs.existsSync(settingsPath)) {
    return createDefaultSettings();
  }

  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    console.warn("Could not read Trellis settings, falling back to defaults.", error);
    return createDefaultSettings();
  }
}

function writeSettings(nextSettings: AppSettings): AppSettings {
  currentSettings = normalizeSettings(nextSettings);
  fs.writeFileSync(getSettingsPath(), JSON.stringify(currentSettings, null, 2), "utf8");
  return currentSettings;
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
    authSession: readAuthSession(),
    sessions: sessions.map((session) => ({
      ...session,
      vaultId: session.vaultId || activeVault.id
    })),
    notes: vault.notes,
    graph: vault.graph
  };
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
  const builtIndexPath = path.join(__dirname, "../dist/index.html");

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
  ipcMain.handle(ipcChannels.appBootstrap, async () => buildBootstrapPayload());
  ipcMain.handle(ipcChannels.settingsGet, async () => currentSettings);
  ipcMain.handle(ipcChannels.settingsSet, async (_event, settings: unknown) => {
    const parsed = normalizeSettings(settings);
    await ensureAllVaultLayouts(parsed);
    return writeSettings(parsed);
  });
  ipcMain.handle(ipcChannels.authGet, async () => readAuthSession());
  ipcMain.handle(ipcChannels.authSet, async (_event, session: unknown) => {
    writeAuthSession(authSessionSchema.parse(session));
  });
  ipcMain.handle(ipcChannels.authClear, async () => {
    clearAuthSession();
  });
  ipcMain.handle(ipcChannels.shellOpenPath, async (_event, targetPath: unknown) => {
    const parsedPath = z.string().min(1).parse(targetPath);
    await shell.openPath(parsedPath);
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
  currentSettings = readSettings();
  await ensureAllVaultLayouts(currentSettings);
  await initializeDatabase(path.join(app.getPath("userData"), "pglite-data"));
  registerAppIpc();
  registerDatabaseIpc();
  registerVaultIpc(getSettings);
  registerIngestIpc(getSettings);
  createMainWindow();
}

app.whenReady()
  .then(async () => {
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
