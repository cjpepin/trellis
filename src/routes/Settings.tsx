import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  LogOut,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  UserRound
} from "lucide-react";
import type {
  AppFeatureFlags,
  AppSettings,
  CheckoutPlanCode,
  ExtractionDebugRun,
  ExtractionInstallProgressEvent,
  ExtractionRuntimeStatus,
  LocalExtractionModelInfo,
  ChatProvider,
  WorkspaceInfo
} from "@electron/ipc/types";
import {
  defaultLocalExtractionModelApproxDownload,
  defaultLocalExtractionModelId
} from "@shared/extraction/config";
import { getOptionalExtractionCloudConfig } from "@/lib/api";
import {
  chatPrivacyModeOptions,
  getExtractionModeOptions,
  getActiveVault,
  resolveExtractionModeForSubscription,
  themeOptions
} from "@/lib/settings";
import { cn } from "@/lib/utils";
import { getSupabase, getSupabaseConfigError } from "@/lib/supabase";
import { ExtractionModeSelect } from "@/components/ExtractionModeSelect";
import { ListboxSelect } from "@/components/ListboxSelect";
import { PremiumPlansModal } from "@/components/PremiumPlansModal";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";

interface Props {
  features: AppFeatureFlags;
  settings: AppSettings;
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
  onRefreshVault: (vaultId?: string) => Promise<void>;
  onSwitchWorkspace: (workspaceId: WorkspaceInfo["id"]) => Promise<void>;
  onResetPreview: () => Promise<void>;
}

function formatBytes(value?: number): string | null {
  if (!value || value <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function findLocalProvider(status: ExtractionRuntimeStatus | null) {
  return status?.providers.find((provider) => provider.id === "embedded") ?? null;
}

function findCloudProvider(status: ExtractionRuntimeStatus | null) {
  return status?.providers.find((provider) => provider.id === "cloud") ?? null;
}

function pickInstalledExtractionModelId(
  models: LocalExtractionModelInfo[] | undefined
): string | null {
  const installedExtractionModels = (models ?? []).filter(
    (model) => model.purpose === "extraction" && model.installed
  );

  return installedExtractionModels[0]?.id ?? null;
}

function formatDebugDuration(
  value: number | null,
  status?: ExtractionDebugRun["status"]
): string {
  if (value === null) {
    return status === "running" || status === "queued" ? "In progress" : "Not recorded";
  }

  if (value < 1_000) {
    return `${value} ms`;
  }

  if (value < 60_000) {
    const seconds = value / 1_000;
    return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
  }

  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function formatDebugTimestamp(value: number | null): string {
  if (value === null) {
    return "Not finished yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
}

function formatProviderKeyTimestamp(value: number | null): string {
  if (value === null) {
    return "Not saved";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}

function getDebugStatusClasses(status: ExtractionDebugRun["status"]): string {
  if (status === "completed") {
    return "border-emerald-500/20 text-emerald-300";
  }

  if (status === "failed") {
    return "border-rose-500/20 text-rose-300";
  }

  if (status === "skipped") {
    return "border-trellis-border text-trellis-muted";
  }

  if (status === "running") {
    return "border-trellis-accent/25 text-trellis-accent";
  }

  return "border-trellis-border text-trellis-faint";
}

function formatInstallProgressLine(event: ExtractionInstallProgressEvent | null): string {
  if (!event) {
    return "";
  }

  if (event.kind === "status") {
    return event.status;
  }

  if (event.kind === "layer" && event.total && event.completed !== undefined) {
    const pct = Math.min(100, Math.round((event.completed / event.total) * 100));
    return `Downloading ${pct}%`;
  }

  if (event.kind === "complete") {
    return "Finishing…";
  }

  if (event.kind === "aborted") {
    return "Cancelled";
  }

  return "";
}

function installProgressPercent(event: ExtractionInstallProgressEvent | null): number | null {
  if (!event || event.kind !== "layer") {
    return null;
  }

  if (!event.total || event.total <= 0 || event.completed === undefined) {
    return null;
  }

  return Math.min(100, Math.round((event.completed / event.total) * 100));
}

function formatAttemptSummary(run: ExtractionDebugRun): string | null {
  if (run.attemptedProviders.length === 0) {
    return null;
  }

  return run.attemptedProviders
    .map((attempt) => {
      const parts: string[] = [attempt.id, attempt.outcome];

      if (attempt.durationMs !== undefined) {
        parts.push(formatDebugDuration(attempt.durationMs));
      }

      if (attempt.reason) {
        parts.push(attempt.reason);
      }

      return parts.join(" · ");
    })
    .join("  |  ");
}

export function Settings({
  settings,
  features,
  workspace,
  workspaces,
  onUpdateSettings,
  onRefreshVault,
  onSwitchWorkspace,
  onResetPreview
}: Props) {
  const [authMode, setAuthMode] = useState<"sign-in" | "create-account">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newVaultName, setNewVaultName] = useState("");
  const [isAddingVault, setIsAddingVault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<ExtractionRuntimeStatus | null>(null);
  const [isRefreshingRuntime, setIsRefreshingRuntime] = useState(false);
  const [debugRuns, setDebugRuns] = useState<ExtractionDebugRun[]>([]);
  const [isRefreshingDebugRuns, setIsRefreshingDebugRuns] = useState(false);
  const [isRunningManualSync, setIsRunningManualSync] = useState(false);
  const [isRunningManualExtraction, setIsRunningManualExtraction] = useState(false);
  const [busyModelAction, setBusyModelAction] = useState<{
    modelId: string;
    action: "install" | "remove";
  } | null>(null);
  const [extractionAdvancedOpen, setExtractionAdvancedOpen] = useState(false);
  const [premiumPlansModalOpen, setPremiumPlansModalOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlanCode | null>(null);
  const [providerKeyDrafts, setProviderKeyDrafts] = useState<Record<ChatProvider, string>>({
    openai: "",
    anthropic: ""
  });
  const [busyProvider, setBusyProvider] = useState<{
    provider: ChatProvider;
    action: "save" | "delete";
  } | null>(null);
  const [obsidianTransfer, setObsidianTransfer] = useState<"import" | "export" | null>(null);
  const [installProgressEvent, setInstallProgressEvent] =
    useState<ExtractionInstallProgressEvent | null>(null);
  const installingModelIdRef = useRef<string | null>(null);
  const authState = useAuthStore();
  const chatSessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const pushToast = useUiStore((state) => state.pushToast);
  const configError = getSupabaseConfigError();
  const activeVault = getActiveVault(settings);
  const normalizedEmail = email.trim().toLowerCase();
  const localProvider = useMemo(() => findLocalProvider(runtimeStatus), [runtimeStatus]);
  const cloudProvider = useMemo(() => findCloudProvider(runtimeStatus), [runtimeStatus]);
  const localExtractionEnabled = features.localExtraction;
  const effectiveExtractionMode = resolveExtractionModeForSubscription(
    settings.extraction.mode,
    authState.subscriptionTier
  );
  const availableExtractionModeOptions = useMemo(
    () => getExtractionModeOptions(localExtractionEnabled, authState.subscriptionTier),
    [authState.subscriptionTier, localExtractionEnabled]
  );
  const localModels = localProvider?.models ?? [];
  const extractionModels = localModels.filter((model) => model.purpose === "extraction");
  const embeddingModels = localModels.filter((model) => model.purpose === "embedding");
  const needsLocalSetup =
    localExtractionEnabled &&
    effectiveExtractionMode === "local" &&
    !localProvider?.available;

  const defaultNoteProcessorModel = extractionModels.find(
    (model) => model.id === defaultLocalExtractionModelId
  );
  const showDefaultNoteProcessorSetup =
    localExtractionEnabled &&
    Boolean(defaultNoteProcessorModel) &&
    !defaultNoteProcessorModel?.installed &&
    (effectiveExtractionMode === "auto" || effectiveExtractionMode === "local");
  const manualExtractionSession = useMemo(
    () =>
      chatSessions.find((session) => session.id === activeSessionId) ??
      chatSessions[0] ??
      null,
    [activeSessionId, chatSessions]
  );
  const manualExtractionSessionLabel =
    manualExtractionSession?.title.trim() || "your latest chat";
  const providerKeyStatuses = authState.providerKeys.statuses;

  const notesFromChatsStatusLine = useMemo(() => {
    if (isRefreshingRuntime) {
      return "Checking status…";
    }
    if (!localExtractionEnabled) {
      return cloudProvider?.available
        ? "Cloud ready."
        : (cloudProvider?.reason ?? "Cloud unavailable.");
    }

    const mode = effectiveExtractionMode;
    const localOk = localProvider?.available;
    const cloudOk = cloudProvider?.available;

    if (mode === "cloud") {
      return cloudOk
        ? "Cloud processing."
        : (cloudProvider?.reason ?? "Cloud unavailable.");
    }

    if (mode === "local") {
      if (localOk) {
        return localProvider?.selectedModel
          ? `On-device · ${localProvider.selectedModel}`
          : "On-device ready.";
      }
      return localProvider?.reason ?? "On-device not ready.";
    }

    return [
      localOk ? "On-device ready" : "On-device not ready",
      cloudOk ? "Cloud available" : (cloudProvider?.reason ?? "Cloud unavailable")
    ].join(" · ");
  }, [
    effectiveExtractionMode,
    isRefreshingRuntime,
    localExtractionEnabled,
    cloudProvider,
    localProvider
  ]);

  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function refreshRuntimeStatus(): Promise<void> {
    setIsRefreshingRuntime(true);

    try {
      const status = await window.trellis.extraction.getRuntimeStatus({
        mode: effectiveExtractionMode,
        cloud: getOptionalExtractionCloudConfig(authState.accessToken ?? null)
      });
      setRuntimeStatus(status);
    } catch (error) {
      pushToast({
        title:
          error instanceof Error
            ? error.message
            : "Could not load note processing status.",
        tone: "warning"
      });
    } finally {
      setIsRefreshingRuntime(false);
    }
  }

  async function refreshDebugRuns(limit = 12): Promise<void> {
    setIsRefreshingDebugRuns(true);

    try {
      const runs = await window.trellis.extraction.listDebugRuns(limit);
      setDebugRuns(runs);
    } catch (error) {
      pushToast({
        title:
          error instanceof Error ? error.message : "Could not load recent note processing logs.",
        tone: "warning"
      });
    } finally {
      setIsRefreshingDebugRuns(false);
    }
  }

  async function runManualSync(): Promise<void> {
    setIsRunningManualSync(true);

    try {
      const result = await window.trellis.retrieval.rebuildIndex(activeVault.id);
      pushToast({
        title: result.usedEmbeddings
          ? `Synced ${result.notesIndexed} notes for ${activeVault.name}.`
          : `Synced ${result.notesIndexed} notes for ${activeVault.name} without embeddings.`,
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not sync the vault index.",
        tone: "warning"
      });
    } finally {
      setIsRunningManualSync(false);
    }
  }

  async function runManualExtraction(): Promise<void> {
    if (!manualExtractionSession) {
      pushToast({
        title: "Start a chat before running manual extraction.",
        tone: "warning"
      });
      return;
    }

    setIsRunningManualExtraction(true);

    try {
      const result = await window.trellis.extraction.queueSession({
        sessionId: manualExtractionSession.id,
        trigger: "manual",
        mode: effectiveExtractionMode,
        cloud: getOptionalExtractionCloudConfig(authState.accessToken ?? null),
        preferredLocalModelId: settings.extraction.preferredLocalModelId ?? undefined,
        force: true
      });

      if (result.state === "queued") {
        pushToast({
          title: `Manual extraction queued for ${manualExtractionSessionLabel}.`,
          tone: "success"
        });
        return;
      }

      if (result.state === "duplicate") {
        pushToast({
          title: `Manual extraction is already running for ${manualExtractionSessionLabel}.`,
          tone: "warning"
        });
        return;
      }

      pushToast({
        title: "That chat needs at least one full exchange before it can be extracted.",
        tone: "warning"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not run manual extraction.",
        tone: "warning"
      });
    } finally {
      setIsRunningManualExtraction(false);
    }
  }

  function getAuthValidationError(): string | null {
    if (!isValidEmail(normalizedEmail)) {
      return "Enter a valid email address.";
    }

    if (password.trim().length === 0) {
      return "Enter your password.";
    }

    if (authMode === "create-account") {
      if (password.length < 8) {
        return "Use at least 8 characters for your password.";
      }

      if (confirmPassword.length === 0) {
        return "Confirm your password.";
      }

      if (password !== confirmPassword) {
        return "Passwords do not match.";
      }
    }

    return null;
  }

  const authValidationError = getAuthValidationError();

  useEffect(() => {
    void refreshRuntimeStatus();
  }, [authState.accessToken, effectiveExtractionMode]);

  useEffect(() => {
    void refreshDebugRuns();
  }, []);

  useEffect(() => {
    const unsubscribe = window.trellis.extraction.onJobUpdate(() => {
      void refreshDebugRuns();
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return window.trellis.extraction.onInstallProgress((event) => {
      if (!installingModelIdRef.current) {
        return;
      }

      setInstallProgressEvent(event);
    });
  }, []);

  async function cancelLocalModelInstall(): Promise<void> {
    try {
      await window.trellis.extraction.cancelInstallLocalModel();
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not cancel the download.",
        tone: "warning"
      });
    }
  }

  async function openVault(targetPath: string): Promise<void> {
    try {
      await window.trellis.shell.openPath(targetPath);
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not open that vault.",
        tone: "warning"
      });
    }
  }

  async function addVault(): Promise<void> {
    const normalizedName = newVaultName.trim();

    if (!normalizedName) {
      pushToast({
        title: "Name the vault before choosing its folder.",
        tone: "warning"
      });
      return;
    }

    try {
      const selectedPath = await window.trellis.vault.selectDirectory({
        title: "Choose your Trellis vault",
        buttonLabel: "Use folder"
      });

      if (!selectedPath) {
        return;
      }

      if (settings.vaults.some((vault) => vault.path === selectedPath)) {
        throw new Error("That folder is already in your vault list.");
      }

      const nextVault = {
        id: crypto.randomUUID(),
        name: normalizedName,
        path: selectedPath
      };

      await onUpdateSettings({
        ...settings,
        vaults: [...settings.vaults, nextVault],
        activeVaultId: nextVault.id
      });
      setNewVaultName("");
      setIsAddingVault(false);
      pushToast({
        title: `${normalizedName} added.`,
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not add that vault.",
        tone: "error"
      });
    }
  }

  async function activateVault(vaultId: string): Promise<void> {
    try {
      await onUpdateSettings({
        ...settings,
        activeVaultId: vaultId
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not switch vaults.",
        tone: "error"
      });
    }
  }

  async function importFromObsidian(): Promise<void> {
    setObsidianTransfer("import");

    try {
      const sourcePath = await window.trellis.vault.selectDirectory({
        title: "Choose an Obsidian vault to import",
        buttonLabel: "Import"
      });

      if (!sourcePath) {
        return;
      }

      const result = await window.trellis.vault.importFromObsidian({
        sourcePath,
        vaultId: activeVault.id
      });

      await onRefreshVault(activeVault.id);
      pushToast({
        title: `Imported ${result.importedNoteCount} Obsidian notes into ${activeVault.name}.`,
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not import that Obsidian vault.",
        tone: "error"
      });
    } finally {
      setObsidianTransfer(null);
    }
  }

  async function exportToObsidian(): Promise<void> {
    setObsidianTransfer("export");

    try {
      const targetPath = await window.trellis.vault.selectDirectory({
        title: "Choose an Obsidian vault to export into",
        buttonLabel: "Export"
      });

      if (!targetPath) {
        return;
      }

      const result = await window.trellis.vault.exportToObsidian({
        targetPath,
        vaultId: activeVault.id
      });

      pushToast({
        title: `Exported ${result.exportedNoteCount} Trellis notes for Obsidian.`,
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not export to that Obsidian vault.",
        tone: "error"
      });
    } finally {
      setObsidianTransfer(null);
    }
  }

  async function updateTheme(theme: AppSettings["theme"]): Promise<void> {
    try {
      await onUpdateSettings({
        ...settings,
        theme
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not change the theme.",
        tone: "error"
      });
    }
  }

  async function signIn(): Promise<void> {
    if (configError) {
      pushToast({
        title: configError,
        tone: "warning"
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await getSupabase().auth.signInWithPassword({
        email: normalizedEmail,
        password
      });

      if (error) {
        throw error;
      }

      setPassword("");
      pushToast({
        title: "Signed in.",
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Unable to sign in.",
        tone: "error"
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createAccount(): Promise<void> {
    if (configError) {
      pushToast({
        title: configError,
        tone: "warning"
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await getSupabase().auth.signUp({
        email: normalizedEmail,
        password
      });

      if (error) {
        throw error;
      }

      setPassword("");
      setConfirmPassword("");
      pushToast({
        title: "Account created. Check your email if confirmation is enabled.",
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Unable to create account.",
        tone: "error"
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitAuth(): Promise<void> {
    if (authValidationError) {
      pushToast({
        title: authValidationError,
        tone: "warning"
      });
      return;
    }

    await (authMode === "sign-in" ? signIn() : createAccount());
  }

  async function signOut(): Promise<void> {
    if (configError) {
      pushToast({
        title: configError,
        tone: "warning"
      });
      return;
    }

    try {
      const { error } = await getSupabase().auth.signOut();

      if (error) {
        throw error;
      }

      pushToast({
        title: "Signed out.",
        tone: "default"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not sign out.",
        tone: "warning"
      });
    }
  }

  async function updateRememberSession(enabled: boolean): Promise<void> {
    try {
      await onUpdateSettings({
        ...settings,
        rememberSession: enabled
      });
      pushToast({
        title: enabled
          ? "Stay signed in is on for this device."
          : "Stay signed in is off. You will need to sign in again next time you open Trellis.",
        tone: "default"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not update sign-in persistence.",
        tone: "error"
      });
    }
  }

  async function updateExtractionMode(mode: AppSettings["extraction"]["mode"]): Promise<void> {
    try {
      await onUpdateSettings({
        ...settings,
        extraction: {
          ...settings.extraction,
          mode: resolveExtractionModeForSubscription(mode, authState.subscriptionTier)
        }
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not update how chats are turned into notes.",
        tone: "error"
      });
    }
  }

  async function saveProviderKey(provider: ChatProvider): Promise<void> {
    const apiKey = providerKeyDrafts[provider].trim();

    if (!apiKey) {
      pushToast({
        title: `Paste your ${provider === "openai" ? "OpenAI" : "Anthropic"} key before saving.`,
        tone: "warning"
      });
      return;
    }

    setBusyProvider({
      provider,
      action: "save"
    });

    try {
      const nextProviderKeys = await window.trellis.chat.setProviderKey({
        provider,
        apiKey
      });
      authState.setProviderKeys(nextProviderKeys);
      setProviderKeyDrafts((current) => ({
        ...current,
        [provider]: ""
      }));
      pushToast({
        title: `${provider === "openai" ? "OpenAI" : "Anthropic"} key saved on this device.`,
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not save that provider key.",
        tone: "error"
      });
    } finally {
      setBusyProvider(null);
    }
  }

  async function removeProviderKey(provider: ChatProvider): Promise<void> {
    setBusyProvider({
      provider,
      action: "delete"
    });

    try {
      const nextProviderKeys = await window.trellis.chat.deleteProviderKey({
        provider
      });
      authState.setProviderKeys(nextProviderKeys);
      setProviderKeyDrafts((current) => ({
        ...current,
        [provider]: ""
      }));
      pushToast({
        title: `${provider === "openai" ? "OpenAI" : "Anthropic"} key removed from this device.`,
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not remove that provider key.",
        tone: "error"
      });
    } finally {
      setBusyProvider(null);
    }
  }

  async function beginCheckout(plan: CheckoutPlanCode): Promise<void> {
    if (!authState.accessToken) {
      pushToast({
        title: "Sign in before opening checkout.",
        tone: "warning"
      });
      return;
    }

    setCheckoutPlan(plan);

    try {
      const result = await window.trellis.billing.createCheckoutSession({
        accessToken: authState.accessToken,
        plan
      });
      setPremiumPlansModalOpen(false);
      await window.trellis.shell.openExternal(result.url);
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not open the checkout page.",
        tone: "warning"
      });
    } finally {
      setCheckoutPlan(null);
    }
  }

  async function updateChatPrivacyMode(mode: AppSettings["chat"]["privacyMode"]): Promise<void> {
    try {
      await onUpdateSettings({
        ...settings,
        chat: {
          ...settings.chat,
          privacyMode: mode
        }
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not update chat privacy.",
        tone: "error"
      });
    }
  }

  async function updateReadAloudAutoPlay(enabled: boolean): Promise<void> {
    try {
      await onUpdateSettings({
        ...settings,
        chat: {
          ...settings.chat,
          readAloudAutoPlay: enabled
        }
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not update read-aloud setting.",
        tone: "error"
      });
    }
  }

  async function updatePreferredLocalModel(modelId: string | null): Promise<void> {
    try {
      await onUpdateSettings({
        ...settings,
        extraction: {
          ...settings.extraction,
          preferredLocalModelId: modelId
        }
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not update the local note processor.",
        tone: "error"
      });
    }
  }

  async function installLocalModel(model: LocalExtractionModelInfo): Promise<void> {
    setBusyModelAction({
      modelId: model.id,
      action: "install"
    });
    installingModelIdRef.current = model.id;
    setInstallProgressEvent({ kind: "status", status: "Starting download…" });

    try {
      const nextStatus = await window.trellis.extraction.installLocalModel(model.id);
      setRuntimeStatus(nextStatus);
      await refreshRuntimeStatus();

      const modelsAfter = findLocalProvider(nextStatus)?.models ?? [];
      const preferredId = settings.extraction.preferredLocalModelId;
      const preferredInstalled =
        preferredId &&
        modelsAfter.some(
          (m) =>
            m.purpose === "extraction" &&
            m.installed &&
            (m.id === preferredId || m.variant === preferredId)
        );

      if (model.purpose === "extraction" && (!preferredId || !preferredInstalled)) {
        await updatePreferredLocalModel(model.id);
      }

      pushToast({
        title: `${model.label} installed.`,
        tone: "success"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not install that local model.";
      pushToast({
        title: message,
        tone: message.includes("cancelled") ? "default" : "error"
      });
    } finally {
      installingModelIdRef.current = null;
      setInstallProgressEvent(null);
      setBusyModelAction(null);
    }
  }

  async function removeLocalModel(model: LocalExtractionModelInfo): Promise<void> {
    setBusyModelAction({
      modelId: model.id,
      action: "remove"
    });

    try {
      const nextStatus = await window.trellis.extraction.removeLocalModel(model.id);
      setRuntimeStatus(nextStatus);
      await refreshRuntimeStatus();

      if (settings.extraction.preferredLocalModelId === model.id) {
        const nextPreferredModelId = pickInstalledExtractionModelId(
          findLocalProvider(nextStatus)?.models
        );
        await updatePreferredLocalModel(nextPreferredModelId);
      }

      pushToast({
        title: `${model.label} removed.`,
        tone: "default"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not remove that local model.",
        tone: "error"
      });
    } finally {
      setBusyModelAction(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6" data-testid="route-settings">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-6 overflow-hidden">
      <section className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-1">
        <div className="trellis-panel px-4 py-3">
          <p className="font-display text-3xl text-trellis-text">Settings</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-trellis-muted">
            Choose where your notes live, how Trellis looks, and how this device stays signed in.
          </p>
        </div>

        <div className="trellis-panel px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-trellis-text">Workspace mode</p>
              <p className="mt-1 text-[11px] leading-snug text-trellis-muted">
                {workspace.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {workspaces.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`workspace-switch-${item.id}`}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition",
                    item.id === workspace.id
                      ? "border-trellis-accent/30 bg-trellis-accent/10 text-trellis-accent"
                      : "border-trellis-border text-trellis-text hover:border-trellis-accent/35"
                  )}
                  onClick={() => {
                    if (item.id !== workspace.id) {
                      void onSwitchWorkspace(item.id);
                    }
                  }}
                >
                  {item.label}
                </button>
              ))}
              {workspace.canReset && (
                <button
                  type="button"
                  data-testid="reset-preview-workspace"
                  className="rounded-full border border-trellis-border px-3 py-1.5 text-xs text-trellis-text transition hover:border-trellis-accent/35"
                  onClick={() => {
                    void onResetPreview();
                  }}
                >
                  Reset preview
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="trellis-panel flex min-h-0 flex-col px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-trellis-text">Vaults</p>
                <p className="mt-0.5 text-[11px] leading-snug text-trellis-muted">
                  Separate vaults for projects, clients, or research threads.
                </p>
              </div>
              <button
                type="button"
                className="trellis-accent-button shrink-0 rounded-field border px-2.5 py-1.5 text-xs transition"
                onClick={() => {
                  void openVault(activeVault.path);
                }}
              >
                <span className="flex items-center gap-2">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open active vault
                </span>
              </button>
            </div>

            <div className="mt-2 min-h-0 space-y-1.5">
              {settings.vaults.map((vault) => {
                const isActive = vault.id === settings.activeVaultId;

                return (
                  <div
                    key={vault.id}
                    className={`rounded-panel border px-2.5 py-2 ${
                      isActive ? "trellis-selected-surface border-trellis-accent/30" : "bg-trellis-surface-2"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium text-trellis-text">{vault.name}</p>
                          {isActive && (
                            <span className="rounded-full border border-trellis-accent/25 px-2 py-0.5 text-[11px] text-trellis-accent">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-trellis-muted">{vault.path}</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          className="rounded-field border border-trellis-border px-2.5 py-1.5 text-xs text-trellis-text transition hover:border-trellis-accent/35"
                          onClick={() => {
                            void openVault(vault.path);
                          }}
                        >
                          Open
                        </button>
                        {!isActive && (
                          <button
                            type="button"
                            className="trellis-accent-button rounded-field border px-2.5 py-1.5 text-xs transition"
                            onClick={() => {
                              void activateVault(vault.id);
                            }}
                          >
                            Use now
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {isAddingVault ? (
              <div className="mt-2 grid gap-2 rounded-panel border border-dashed border-trellis-border px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-trellis-text">New vault</p>
                  <button
                    type="button"
                    className="shrink-0 text-[11px] text-trellis-muted underline-offset-2 transition hover:text-trellis-text"
                    onClick={() => {
                      setIsAddingVault(false);
                      setNewVaultName("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <input
                  value={newVaultName}
                  onChange={(event) => setNewVaultName(event.target.value)}
                  className="trellis-input py-1.5 text-xs"
                  placeholder="Name this vault…"
                  autoFocus
                />
                <button
                  type="button"
                  className="trellis-accent-button w-fit rounded-field border px-2.5 py-1.5 text-xs transition"
                  onClick={() => {
                    void addVault();
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Plus className="h-3.5 w-3.5" />
                    Choose folder and add
                  </span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-field border border-dashed border-trellis-border px-2.5 py-2 text-[11px] text-trellis-muted transition hover:border-trellis-accent/35 hover:text-trellis-text"
                onClick={() => {
                  setIsAddingVault(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add vault
              </button>
            )}

            <div
              className="mt-4 rounded-panel border border-trellis-border bg-trellis-surface-2 px-3 py-3"
              data-testid="settings-obsidian-bridge"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 max-w-md">
                  <p className="text-xs font-medium text-trellis-text">Obsidian import / export</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-trellis-muted">
                    Bring markdown notes from an Obsidian vault into {activeVault.name}, or export
                    this Trellis vault back into an Obsidian-friendly folder.
                  </p>
                </div>
                <span className="rounded-full border border-trellis-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-trellis-faint">
                  Markdown bridge
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  data-testid="settings-obsidian-import"
                  className="rounded-field border border-trellis-border px-3 py-2 text-left text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:text-trellis-faint"
                  onClick={() => {
                    void importFromObsidian();
                  }}
                  disabled={obsidianTransfer !== null}
                >
                  <span className="flex items-center gap-2">
                    {obsidianTransfer === "import" ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Import from Obsidian
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="settings-obsidian-export"
                  className="rounded-field border border-trellis-border px-3 py-2 text-left text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:text-trellis-faint"
                  onClick={() => {
                    void exportToObsidian();
                  }}
                  disabled={obsidianTransfer !== null}
                >
                  <span className="flex items-center gap-2">
                    {obsidianTransfer === "export" ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Export to Obsidian
                  </span>
                </button>
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-trellis-muted">
                Imports land in a dedicated <span className="font-mono text-trellis-text">imports/</span> folder
                inside your active Trellis vault. Exports write into{" "}
                <span className="font-mono text-trellis-text">Trellis/{activeVault.name}</span> in the
                Obsidian vault you choose so existing notes stay untouched.
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="trellis-panel px-4 py-3">
            <label className="block" htmlFor="settings-theme">
              <div className="flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5 text-trellis-accent" aria-hidden />
                <span className="text-sm font-medium text-trellis-text">Appearance</span>
              </div>
              <span className="mt-0.5 block text-[11px] leading-snug text-trellis-muted">
                Workspace color theme.
              </span>
            </label>
            <ListboxSelect
              id="settings-theme"
              className="mt-2"
              options={themeOptions}
              value={settings.theme}
              listboxAriaLabel="Appearance theme"
              onSelect={(theme) => {
                void updateTheme(theme);
              }}
            />
            </div>

            <div className="trellis-panel px-4 py-3">
            <label className="block" htmlFor="settings-chat-privacy-mode">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-trellis-text">Chat privacy</span>
              </div>
              <span className="mt-0.5 block text-[11px] leading-snug text-trellis-muted">
                Keep vault retrieval local and choose how much context Trellis may send with a chat reply.
              </span>
            </label>
            <ListboxSelect
              id="settings-chat-privacy-mode"
              className="mt-2"
              options={chatPrivacyModeOptions}
              value={settings.chat.privacyMode}
              listboxAriaLabel="Chat privacy mode"
              onSelect={(mode) => {
                void updateChatPrivacyMode(mode);
              }}
            />
            <p className="mt-3 text-[11px] leading-snug text-trellis-muted">
              {settings.chat.privacyMode === "auto"
                ? "Auto keeps retrieval on-device and sends only a small selected context packet when it helps."
                : settings.chat.privacyMode === "off"
                  ? "Off keeps note and memory context on-device and sends only the live chat transcript."
                  : "Local only never sends note content to cloud chat. It uses the on-device model and will ask you to install it if needed."}
            </p>
            <p className="mt-3 text-[11px] leading-snug text-trellis-muted">
              Voice dictation, read-aloud, pasted images, and inline image generation use cloud APIs (OpenAI).
              On the BYOK plan, add an OpenAI API key for those features; Anthropic keys alone cannot drive
              speech or DALL-E. Local-only chat stays text-first and does not send images or audio to the
              cloud. Media files are cached under app data unless you save a note explicitly.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-left">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-trellis-border text-trellis-accent"
                checked={settings.chat.readAloudAutoPlay ?? false}
                onChange={(event) => {
                  void updateReadAloudAutoPlay(event.target.checked);
                }}
              />
              <span>
                <span className="block text-sm text-trellis-text">Read assistant replies aloud automatically</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-trellis-muted">
                  Off by default. When enabled, new assistant messages are spoken after they finish streaming.
                </span>
              </span>
            </label>
            </div>

            <div className="trellis-panel px-4 py-3">
          <label className="block" htmlFor="settings-notes-from-chats-mode">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-trellis-accent" aria-hidden />
              <span className="text-sm font-medium text-trellis-text">Notes from chats</span>
            </div>
            <span className="mt-0.5 block text-[11px] leading-snug text-trellis-muted">
              Linked notes from chat into your vault.
            </span>
          </label>

          {authState.subscriptionTier === "byok" && (
            <div className="mt-3 rounded-panel border border-trellis-border bg-trellis-surface-2 px-3 py-2.5">
              <p className="text-xs leading-6 text-trellis-muted">
                BYOK keeps chat inference on your own provider account, so Trellis only turns chats
                into notes on-device. Cloud note processing is not included on this tier.
              </p>
            </div>
          )}

          {localExtractionEnabled && (
            <div
              className={cn(
                "mt-3 flex flex-col gap-3",
                showDefaultNoteProcessorSetup &&
                  defaultNoteProcessorModel &&
                  "sm:flex-row sm:items-start sm:gap-4"
              )}
            >
              <ExtractionModeSelect
                id="settings-notes-from-chats-mode"
                className={
                  showDefaultNoteProcessorSetup && defaultNoteProcessorModel
                    ? "w-full shrink-0 self-start sm:max-w-[min(100%,240px)]"
                    : undefined
                }
                options={availableExtractionModeOptions}
                value={effectiveExtractionMode}
                onSelect={(mode) => {
                  void updateExtractionMode(mode);
                }}
              />

              {showDefaultNoteProcessorSetup && defaultNoteProcessorModel && (
                <div
                  className={cn(
                    "flex min-w-0 flex-1 rounded-panel border border-trellis-accent/25 bg-trellis-surface-2/80 px-3",
                    busyModelAction?.modelId === defaultNoteProcessorModel.id &&
                      busyModelAction.action === "install"
                      ? "flex-col justify-center gap-2 py-2.5"
                      : "h-[42px] flex-row items-center gap-2 overflow-hidden sm:gap-3"
                  )}
                >
                  {busyModelAction?.modelId === defaultNoteProcessorModel.id &&
                  busyModelAction.action === "install" ? (
                    <div className="space-y-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-trellis-surface">
                        <div
                          className="h-full rounded-full bg-trellis-accent transition-[width] duration-300"
                          style={{
                            width: `${installProgressPercent(installProgressEvent) ?? 0}%`
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] text-trellis-muted">
                          {formatInstallProgressLine(installProgressEvent) || "Downloading…"}
                        </p>
                        <button
                          type="button"
                          className="shrink-0 rounded-field border border-trellis-border px-2.5 py-1.5 text-xs text-trellis-text transition hover:border-trellis-accent/35"
                          onClick={() => {
                            void cancelLocalModelInstall();
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-0 w-full min-w-0 flex-row flex-nowrap items-center gap-2 sm:justify-between sm:gap-3">
                      <p className="min-w-0 flex-1 truncate text-[11px] leading-none text-trellis-muted">
                        {defaultNoteProcessorModel.label} (~{defaultLocalExtractionModelApproxDownload})
                      </p>
                      <button
                        type="button"
                        className="trellis-accent-button shrink-0 rounded-field border px-2.5 py-1.5 text-xs transition"
                        onClick={() => {
                          void installLocalModel(defaultNoteProcessorModel);
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <p className="mt-3 text-[11px] leading-snug text-trellis-muted">{notesFromChatsStatusLine}</p>

          {needsLocalSetup && !showDefaultNoteProcessorSetup && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-[11px] text-trellis-muted">
                {localProvider?.reason ?? "Install a model under Advanced."}
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-[11px] text-trellis-text underline decoration-trellis-border underline-offset-2 transition hover:decoration-trellis-accent"
                onClick={() => {
                  void refreshRuntimeStatus();
                }}
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                Refresh status
              </button>
            </div>
          )}

          <button
            type="button"
            className="mt-4 flex w-full items-center justify-between gap-2 rounded-field border border-trellis-border px-3 py-2 text-left text-xs text-trellis-text transition hover:border-trellis-accent/35"
            onClick={() => {
              setExtractionAdvancedOpen((open) => !open);
            }}
          >
            <span className="font-medium">Advanced</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-trellis-muted transition",
                extractionAdvancedOpen && "-rotate-180"
              )}
              aria-hidden
            />
          </button>

          {extractionAdvancedOpen && (
            <div className="mt-4 space-y-4 border-t border-trellis-border/60 pt-4">
              <div className="rounded-panel border border-trellis-border bg-trellis-surface-2/80 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 max-w-2xl">
                    <p className="text-xs font-medium text-trellis-text">Manual tools</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-trellis-muted">
                      Refresh the active vault’s search index or force note processing for{" "}
                      {manualExtractionSession ? manualExtractionSessionLabel : "your next chat"}.
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 xl:grid-cols-2">
                  <div className="rounded-panel border border-trellis-border bg-trellis-surface px-3 py-3">
                    <p className="text-xs font-medium text-trellis-text">Manual sync</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-trellis-muted">
                      Rebuild the retrieval index for {activeVault.name}.
                    </p>
                    <button
                      type="button"
                      className="mt-3 rounded-field border border-trellis-border px-2.5 py-1.5 text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:text-trellis-faint"
                      onClick={() => {
                        void runManualSync();
                      }}
                      disabled={isRunningManualSync}
                    >
                      <span className="flex items-center gap-2">
                        {isRunningManualSync ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Run sync
                      </span>
                    </button>
                  </div>

                  <div className="rounded-panel border border-trellis-border bg-trellis-surface px-3 py-3">
                    <p className="text-xs font-medium text-trellis-text">Manual extraction</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-trellis-muted">
                      Force note processing for{" "}
                      {manualExtractionSession ? manualExtractionSessionLabel : "the active chat"}.
                    </p>
                    <button
                      type="button"
                      className="mt-3 rounded-field border border-trellis-border px-2.5 py-1.5 text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:text-trellis-faint"
                      onClick={() => {
                        void runManualExtraction();
                      }}
                      disabled={isRunningManualExtraction || !manualExtractionSession}
                    >
                      <span className="flex items-center gap-2">
                        {isRunningManualExtraction ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        Run extraction
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {localExtractionEnabled && (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-trellis-text">Local models</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-trellis-muted">
                        Install models and run diagnostics.
                      </p>
                    </div>
                    {settings.extraction.preferredLocalModelId && (
                      <span className="rounded-full border border-trellis-accent/25 px-2 py-0.5 text-[10px] text-trellis-accent">
                        Preferred: {settings.extraction.preferredLocalModelId}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-2 xl:grid-cols-2">
                    {[...extractionModels, ...embeddingModels].map((model) => {
                      const isBusy = busyModelAction?.modelId === model.id;
                      const isSelectedExtractionModel =
                        model.purpose === "extraction" &&
                        settings.extraction.preferredLocalModelId === model.id;

                      return (
                        <div
                          key={model.id}
                          className={cn(
                            "rounded-panel border px-3 py-3",
                            isSelectedExtractionModel
                              ? "border-trellis-accent/30 bg-trellis-surface"
                              : "border-trellis-border bg-trellis-surface-2"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-xs font-medium text-trellis-text">
                                  {model.label}
                                </p>
                                <span className="rounded-full border border-trellis-border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-trellis-faint">
                                  {model.purpose === "extraction" ? "Notes" : "Search"}
                                </span>
                                {model.recommended && (
                                  <span className="rounded-full border border-trellis-accent/20 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-trellis-accent">
                                    Recommended
                                  </span>
                                )}
                                {isSelectedExtractionModel && (
                                  <span className="rounded-full border border-trellis-accent/20 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-trellis-accent">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-trellis-muted">
                                {[
                                  model.parameterSize,
                                  formatBytes(model.sizeBytes),
                                  model.installed ? "Installed" : "Not installed"
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                            {model.installed ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-trellis-accent/20 px-2 py-0.5 text-[10px] text-trellis-accent">
                                <Check className="h-3 w-3" />
                                Ready
                              </span>
                            ) : (
                              <span className="rounded-full border border-trellis-border px-2 py-0.5 text-[10px] text-trellis-muted">
                                Needs install
                              </span>
                            )}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            {model.installed ? (
                              <>
                                {model.purpose === "extraction" && !isSelectedExtractionModel && (
                                  <button
                                    type="button"
                                    className="trellis-accent-button rounded-field border px-2.5 py-1.5 text-xs transition"
                                    onClick={() => {
                                      void updatePreferredLocalModel(model.id);
                                    }}
                                  >
                                    Use model
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="rounded-field border border-trellis-border px-2.5 py-1.5 text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:text-trellis-faint"
                                  onClick={() => {
                                    void removeLocalModel(model);
                                  }}
                                  disabled={isBusy}
                                >
                                  <span className="flex items-center gap-2">
                                    {isBusy && busyModelAction?.action === "remove" ? (
                                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                    Remove
                                  </span>
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="trellis-accent-button rounded-field border px-2.5 py-1.5 text-xs transition disabled:text-trellis-faint"
                                onClick={() => {
                                  void installLocalModel(model);
                                }}
                                disabled={isBusy}
                              >
                                <span className="flex items-center gap-2">
                                  {isBusy && busyModelAction?.action === "install" ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Download className="h-3.5 w-3.5" />
                                  )}
                                  Install
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="flex min-h-0 flex-col rounded-panel border border-trellis-border bg-trellis-surface-2/80 px-3 py-3">
                <div className="flex shrink-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 max-w-2xl">
                    <p className="text-xs font-medium text-trellis-text">Note processing diagnostics</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-trellis-muted">
                      Recent runs on this device (this session): providers, timing, and validation
                      summaries. Message text is not stored here.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-field border border-trellis-border px-2.5 py-1.5 text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:text-trellis-faint"
                    onClick={() => {
                      void refreshDebugRuns();
                    }}
                    disabled={isRefreshingDebugRuns}
                  >
                    <span className="flex items-center gap-2">
                      {isRefreshingDebugRuns ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Refresh
                    </span>
                  </button>
                </div>

                <div
                  className="trellis-scrollbar mt-3 min-h-0 max-h-[min(28rem,50vh)] overflow-y-auto overscroll-contain pr-0.5"
                  role="region"
                  aria-label="Extraction run history"
                >
                  {debugRuns.length === 0 ? (
                    <div className="rounded-panel border border-dashed border-trellis-border px-3 py-3 text-[11px] text-trellis-muted">
                      No note processing runs logged in this session yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {debugRuns.map((run) => {
                        const attemptsSummary = formatAttemptSummary(run);
                        const validationPreview =
                          run.validationIssues.length > 2
                            ? `${run.validationIssues.slice(0, 2).join("  |  ")}  |  +${
                                run.validationIssues.length - 2
                              } more`
                            : run.validationIssues.join("  |  ");

                        return (
                          <div
                            key={run.id}
                            className="rounded-panel border border-trellis-border bg-trellis-surface px-3 py-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
                                    getDebugStatusClasses(run.status)
                                  )}
                                >
                                  {run.status}
                                </span>
                                <span className="rounded-full border border-trellis-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-trellis-faint">
                                  {run.scope}
                                </span>
                                <span className="rounded-full border border-trellis-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-trellis-faint">
                                  {run.mode}
                                </span>
                                {run.trigger && (
                                  <span className="rounded-full border border-trellis-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-trellis-faint">
                                    {run.trigger}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-trellis-muted">
                                {formatDebugTimestamp(run.createdAt)}
                              </p>
                            </div>

                            <div className="mt-2 grid gap-2 text-[11px] text-trellis-muted sm:grid-cols-2 xl:grid-cols-4">
                              <p>
                                Provider:{" "}
                                <span className="text-trellis-text">
                                  {run.selectedProvider ?? "Not selected"}
                                  {run.model ? ` · ${run.model}` : ""}
                                </span>
                              </p>
                              <p>
                                Duration:{" "}
                                <span className="text-trellis-text">
                                  {formatDebugDuration(run.durationMs, run.status)}
                                </span>
                              </p>
                              <p>
                                Updates:{" "}
                                <span className="text-trellis-text">
                                  {run.requestedUpdateCount ?? 0} requested
                                  {run.appliedUpdateCount !== null
                                    ? ` · ${run.appliedUpdateCount} applied`
                                    : ""}
                                  {run.guardrailDropCount !== null
                                    ? ` · ${run.guardrailDropCount} dropped`
                                    : ""}
                                </span>
                              </p>
                              <p>
                                Context:{" "}
                                <span className="text-trellis-text">
                                  {run.transcriptMessageCount} messages
                                  {run.relatedNoteCount !== null ? ` · ${run.relatedNoteCount} notes` : ""}
                                </span>
                              </p>
                            </div>

                            <div className="mt-2 grid gap-1.5 text-[11px] text-trellis-muted sm:grid-cols-2">
                              <p>
                                Transcript span:{" "}
                                <span className="text-trellis-text">
                                  {run.transcriptStartIndex ?? 0} to {run.transcriptEndIndex ?? 0}
                                </span>
                              </p>
                              <p>
                                Finished:{" "}
                                <span className="text-trellis-text">
                                  {formatDebugTimestamp(run.finishedAt)}
                                </span>
                              </p>
                            </div>

                            {attemptsSummary && (
                              <p className="mt-2 text-[11px] leading-relaxed text-trellis-muted">
                                Attempts: <span className="text-trellis-text">{attemptsSummary}</span>
                              </p>
                            )}

                            {validationPreview && (
                              <p className="mt-1.5 text-[11px] leading-relaxed text-trellis-muted">
                                Validation: <span className="text-trellis-text">{validationPreview}</span>
                              </p>
                            )}

                            {run.errorMessage && (
                              <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">
                                Issue: {run.errorMessage}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
            </div>
          </div>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain">
        <div className="trellis-panel px-4 py-3">
          <div className="flex items-center gap-2.5">
            <UserRound className="h-5 w-5 text-trellis-accent" />
            <p className="text-lg text-trellis-text">Account</p>
          </div>
          {workspace.isPreview && (
            <div className="mt-3 rounded-panel border border-trellis-border bg-trellis-surface-2 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint">
                Preview mode
              </p>
              <p className="mt-1 text-sm text-trellis-text">
                Seeded chats, notes, and graph state live here, but your sign-in, plan, and live
                chat work the same as your normal workspace. Resetting preview clears only the
                preview data.
              </p>
            </div>
          )}

          {authState.status === "authenticated" ? (
            <>
              <p className="mt-2 text-sm leading-6 text-trellis-muted">
                You’re signed in on this device. Trellis keeps you logged in between app launches so you can pick up where you left off.
              </p>
              <div className="mt-3 rounded-panel border border-trellis-border bg-trellis-surface-2 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint">Signed in as</p>
                <p className="mt-1 text-sm text-trellis-text">{authState.user?.email ?? "Account owner"}</p>
              </div>
              <div className="mt-3 rounded-panel border border-trellis-border bg-trellis-surface-2 px-3 py-2.5">
                <label className="flex cursor-pointer items-start justify-between gap-3">
                  <span>
                    <p className="text-sm leading-snug text-trellis-text">Stay signed in on this device</p>
                    <p className="mt-0.5 text-xs leading-5 text-trellis-muted">
                      Keep your account session between app launches on this computer.
                    </p>
                  </span>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                    checked={settings.rememberSession}
                    onChange={(event) => {
                      void updateRememberSession(event.target.checked);
                    }}
                  />
                </label>
              </div>
              <button
                type="button"
                className="mt-4 rounded-field border border-trellis-border px-4 py-3 text-sm text-trellis-text transition hover:border-trellis-accent/35"
                onClick={() => {
                  void signOut();
                }}
              >
                <span className="flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  Sign out
                </span>
              </button>
            </>
          ) : (
            <>
              <div className="mt-5 inline-flex rounded-full border border-trellis-border bg-trellis-surface-2 p-1">
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    authMode === "sign-in"
                      ? "trellis-selected-surface text-trellis-text"
                      : "text-trellis-muted"
                  }`}
                  onClick={() => {
                    setAuthMode("sign-in");
                    setConfirmPassword("");
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    authMode === "create-account"
                      ? "trellis-selected-surface text-trellis-text"
                      : "text-trellis-muted"
                  }`}
                  onClick={() => {
                    setAuthMode("create-account");
                  }}
                >
                  Create account
                </button>
              </div>
              <p className="mt-4 text-sm leading-7 text-trellis-muted">
                {authMode === "sign-in"
                  ? "Sign back in to resume chat and sync your plan on this device."
                  : "Create an account to unlock chat, sync your plan, and keep going across sessions."}
              </p>
              <div className="mt-5 grid gap-3">
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="trellis-input"
                  placeholder="you@example.com"
                  type="email"
                  autoComplete="email"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitAuth();
                    }
                  }}
                />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="trellis-input"
                  placeholder="Password"
                  type="password"
                  autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitAuth();
                    }
                  }}
                />
                {authMode === "create-account" && (
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="trellis-input"
                    placeholder="Confirm password"
                    type="password"
                    autoComplete="new-password"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitAuth();
                      }
                    }}
                  />
                )}
              </div>
              <button
                type="button"
                disabled={Boolean(configError) || isSubmitting || Boolean(authValidationError)}
                className="trellis-accent-button mt-5 rounded-field border px-4 py-3 text-sm transition disabled:border-trellis-border disabled:bg-trellis-surface disabled:text-trellis-faint"
                onClick={() => {
                  void submitAuth();
                }}
              >
                {isSubmitting ? "Working…" : authMode === "sign-in" ? "Sign in" : "Create account"}
              </button>
              {!configError && authValidationError && (
                <p className="mt-3 text-xs text-trellis-warning">{authValidationError}</p>
              )}
              {configError && (
                <p className="mt-4 text-sm text-trellis-warning">{configError}</p>
              )}
            </>
          )}
        </div>

        <div className="trellis-panel px-4 py-3">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-trellis-accent" />
            <p className="text-lg text-trellis-text">AI Providers</p>
          </div>
          {authState.subscriptionTier !== "byok" ? (
            <p className="mt-2 text-sm leading-6 text-trellis-muted">
              The discounted BYOK tier lets you bring your own OpenAI or Anthropic key for chat
              while Trellis keeps your vault, local history, and app experience intact.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm leading-6 text-trellis-muted">
                Save your provider keys on this device to unlock chat through your own OpenAI or
                Anthropic account. Trellis stores only masked status in the UI.
              </p>
              <div className="mt-3 rounded-panel border border-trellis-border bg-trellis-surface-2 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint">
                  Storage
                </p>
                <p className="mt-1 text-sm text-trellis-text">
                  {authState.providerKeys.secureStorageAvailable
                    ? "Encrypted on this device"
                    : "Session-only for this launch"}
                </p>
                <p className="mt-1 text-xs leading-5 text-trellis-muted">
                  {authState.providerKeys.secureStorageAvailable
                    ? "Keys stay in Electron secure storage for this device and work across workspaces."
                    : "Electron secure storage is unavailable here, so keys clear when you quit Trellis."}
                </p>
              </div>
              <div className="mt-4 space-y-4">
                {providerKeyStatuses.map((status) => {
                  const providerLabel = status.provider === "openai" ? "OpenAI" : "Anthropic";
                  const draftValue = providerKeyDrafts[status.provider];
                  const isSaving =
                    busyProvider?.provider === status.provider && busyProvider.action === "save";
                  const isDeleting =
                    busyProvider?.provider === status.provider && busyProvider.action === "delete";

                  return (
                    <div
                      key={status.provider}
                      className="rounded-panel border border-trellis-border bg-trellis-surface-2 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-trellis-text">{providerLabel}</p>
                          <p className="mt-1 text-xs leading-5 text-trellis-muted">
                            {status.configured && status.lastFour
                              ? `Configured · ends in ${status.lastFour} · updated ${formatProviderKeyTimestamp(status.updatedAt)}`
                              : "Not configured on this device yet."}
                          </p>
                        </div>
                        {status.configured && (
                          <button
                            type="button"
                            disabled={isDeleting}
                            className="rounded-field border border-trellis-border px-2.5 py-1.5 text-xs text-trellis-text transition hover:border-trellis-accent/35 disabled:cursor-not-allowed disabled:opacity-70"
                            onClick={() => {
                              void removeProviderKey(status.provider);
                            }}
                          >
                            {isDeleting ? "Removing…" : "Remove"}
                          </button>
                        )}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          value={draftValue}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setProviderKeyDrafts((current) => ({
                              ...current,
                              [status.provider]: nextValue
                            }));
                          }}
                          className="trellis-input"
                          placeholder={`Paste your ${providerLabel} API key`}
                          type="password"
                        />
                        <button
                          type="button"
                          disabled={isSaving || draftValue.trim().length === 0}
                          className="trellis-accent-button rounded-field border px-4 py-2 text-sm transition disabled:border-trellis-border disabled:bg-trellis-surface disabled:text-trellis-faint"
                          onClick={() => {
                            void saveProviderKey(status.provider);
                          }}
                        >
                          {isSaving ? "Saving…" : status.configured ? "Update key" : "Save key"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="trellis-panel px-3 py-2">
          <p className="text-lg text-trellis-text">Plan & usage</p>
          <p className="mt-1 text-[11px] leading-snug text-trellis-muted">
            {workspace.isPreview
              ? "Preview uses your live account limits against seeded local data."
              : authState.subscriptionTier === "byok"
                ? "BYOK chat runs on your own provider account while Trellis still manages the app, local history, and billing tier."
                : "Your subscription tier and limits. View plans to compare tiers or upgrade."}
          </p>
          <div className="mt-3 space-y-3 text-sm text-trellis-text">
            <div>
              <p className="text-trellis-muted">Tier</p>
              <p className="mt-1">
                {workspace.isPreview
                  ? authState.subscriptionTier === "pro"
                    ? "Trellis Pro"
                    : authState.subscriptionTier === "byok"
                      ? "Trellis BYOK"
                      : "Free trial"
                  : authState.subscriptionTier === "pro"
                    ? "Trellis Pro"
                    : authState.subscriptionTier === "byok"
                      ? "Trellis BYOK"
                      : "Free trial"}
              </p>
            </div>
            <div>
              <p className="text-trellis-muted">Messages</p>
              <p className="mt-1">
                {workspace.isPreview
                  ? authState.subscriptionTier === "byok"
                    ? "Billed by your provider"
                    : `${authState.usage.messagesUsed} / ${authState.usage.messageLimit}`
                  : authState.subscriptionTier === "byok"
                    ? "Billed by your provider"
                    : `${authState.usage.messagesUsed} / ${authState.usage.messageLimit}`}
              </p>
            </div>
            <div>
              <p className="text-trellis-muted">Ingests</p>
              <p className="mt-1">
                {`${authState.usage.ingestsUsed} / ${authState.usage.ingestLimit}`}
              </p>
            </div>
            <div>
              <p className="text-trellis-muted">Status</p>
              <p className="mt-1 capitalize">
                {authState.subscriptionStatus}
              </p>
            </div>
            <button
              type="button"
              className="w-full rounded-field border border-trellis-border px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
              onClick={() => {
                setPremiumPlansModalOpen(true);
              }}
            >
              View plans
            </button>
          </div>
        </div>
      </aside>
      </div>

      <PremiumPlansModal
        open={premiumPlansModalOpen}
        onClose={() => {
          setPremiumPlansModalOpen(false);
        }}
        subscriptionTier={authState.subscriptionTier}
        canCheckout={authState.status === "authenticated" && !configError}
        checkoutPlan={checkoutPlan}
        onSubscribe={(plan) => {
          void beginCheckout(plan);
        }}
      />
    </div>
  );
}
