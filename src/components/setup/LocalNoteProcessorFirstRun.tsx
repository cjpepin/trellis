import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import type {
  AppFeatureFlags,
  AppSettings,
  ExtractionInstallProgressEvent,
  ExtractionRuntimeStatus
} from "@electron/ipc/types";
import { getOptionalExtractionCloudConfig } from "@/lib/api";
import {
  defaultLocalExtractionModelApproxDownload,
  defaultLocalExtractionModelId
} from "@shared/extraction/config";
import {
  getSkipCloudPromptAfterLocalModelCancel,
  setSkipCloudPromptAfterLocalModelCancel
} from "@/lib/localModelInstallPrefs";
import { resolveExtractionModeForSubscription } from "@/lib/settings";
import {
  readWorkspaceSessionStorage,
  removeWorkspaceSessionStorage,
  writeWorkspaceSessionStorage
} from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";

/** Preserves dismiss state for users who already closed the older “extractor” first-run. */
const SESSION_DISMISS_KEYS = [
  "trellis:local-note-processor-first-run-dismissed",
  "trellis:local-extractor-first-run-dismissed"
] as const;

function isDismissed(): boolean {
  return SESSION_DISMISS_KEYS.some((key) => readWorkspaceSessionStorage(key) === "1");
}

function dismissForSessionStorage(): void {
  writeWorkspaceSessionStorage(SESSION_DISMISS_KEYS[0], "1");
}

function clearDismissForSessionStorage(): void {
  for (const key of SESSION_DISMISS_KEYS) {
    removeWorkspaceSessionStorage(key);
  }
}

interface Props {
  settings: AppSettings;
  features: AppFeatureFlags;
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
}

function formatInstallLine(event: ExtractionInstallProgressEvent | null): string {
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

function layerPercent(event: ExtractionInstallProgressEvent | null): number | null {
  if (!event || event.kind !== "layer") {
    return null;
  }
  if (!event.total || event.total <= 0 || event.completed === undefined) {
    return null;
  }
  return Math.min(100, Math.round((event.completed / event.total) * 100));
}

export function LocalNoteProcessorFirstRun({ settings, features, onUpdateSettings }: Props) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const subscriptionTier = useAuthStore((state) => state.subscriptionTier);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const effectiveExtractionMode = resolveExtractionModeForSubscription(
    settings.extraction.mode,
    subscriptionTier
  );
  const [phase, setPhase] = useState<
    "idle" | "checking" | "blocked" | "installing" | "confirm-cloud" | "hidden"
  >("idle");
  const [runtimeStatus, setRuntimeStatus] = useState<ExtractionRuntimeStatus | null>(null);
  const [installProgress, setInstallProgress] = useState<ExtractionInstallProgressEvent | null>(null);
  const installStartedRef = useRef(false);
  const installingRef = useRef(false);
  const [skipCloudPromptIfCancel, setSkipCloudPromptIfCancel] = useState(
    getSkipCloudPromptAfterLocalModelCancel
  );

  useEffect(() => {
    return window.trellis.extraction.onInstallProgress((event) => {
      if (!installingRef.current) {
        return;
      }
      setInstallProgress(event);
    });
  }, []);

  useEffect(() => {
    if (!features.localExtraction || effectiveExtractionMode === "cloud") {
      setPhase("hidden");
      return;
    }

    if (isDismissed()) {
      setPhase("hidden");
      return;
    }

    let cancelled = false;

    async function evaluate(): Promise<void> {
      setPhase("checking");

      try {
        const status = await window.trellis.extraction.getRuntimeStatus({
          mode: effectiveExtractionMode,
          cloud: getOptionalExtractionCloudConfig(accessTokenRef.current ?? null)
        });

        if (cancelled) {
          return;
        }

        setRuntimeStatus(status);

        const embedded = status.providers.find((p) => p.id === "embedded");
        const models = embedded?.models ?? [];
        const primary = models.find((m) => m.id === defaultLocalExtractionModelId);

        if (primary?.installed) {
          setPhase("hidden");
          return;
        }

        setPhase("installing");
      } catch {
        if (!cancelled) {
          setPhase("blocked");
        }
      }
    }

    void evaluate();

    return () => {
      cancelled = true;
    };
  }, [effectiveExtractionMode, features.localExtraction]);

  useEffect(() => {
    if (phase !== "installing" || installStartedRef.current) {
      return;
    }

    installStartedRef.current = true;
    installingRef.current = true;
    setInstallProgress({ kind: "status", status: "Starting download…" });

    void (async () => {
      try {
        const next = await window.trellis.extraction.installLocalModel(defaultLocalExtractionModelId);
        setRuntimeStatus(next);
        installStartedRef.current = false;
        setPhase("hidden");
        clearDismissForSessionStorage();
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("Another model download is already in progress")) {
          setPhase("installing");
          return;
        }
        installStartedRef.current = false;
        if (message.toLowerCase().includes("cancel")) {
          if (getSkipCloudPromptAfterLocalModelCancel()) {
            dismissForSessionStorage();
            setPhase("hidden");
          } else if (subscriptionTier === "byok") {
            setPhase("blocked");
          } else {
            setPhase("confirm-cloud");
          }
        } else {
          setPhase("blocked");
        }
      } finally {
        installingRef.current = false;
        setInstallProgress(null);
      }
    })();
  }, [phase, subscriptionTier]);

  async function handleCancelDownload(): Promise<void> {
    await window.trellis.extraction.cancelInstallLocalModel();
  }

  async function switchToCloudNoteProcessing(): Promise<void> {
    try {
      await onUpdateSettings({
        ...settings,
        extraction: {
          ...settings.extraction,
          mode: "cloud"
        }
      });
      setPhase("hidden");
      clearDismissForSessionStorage();
    } catch {
      // Parent may toast
    }
  }

  function dismissForSession(): void {
    dismissForSessionStorage();
    setPhase("hidden");
  }

  async function goBackFromConfirmCloud(): Promise<void> {
    try {
      const status = await window.trellis.extraction.getRuntimeStatus({
        mode: effectiveExtractionMode,
        cloud: getOptionalExtractionCloudConfig(accessTokenRef.current ?? null)
      });
      setRuntimeStatus(status);
      const embedded = status.providers.find((p) => p.id === "embedded");
      const models = embedded?.models ?? [];
      const primary = models.find((m) => m.id === defaultLocalExtractionModelId);

      if (!primary?.installed) {
        installStartedRef.current = false;
        setPhase("installing");
      } else {
        setPhase("blocked");
      }
    } catch {
      setPhase("blocked");
    }
  }

  if (phase === "idle" || phase === "checking" || phase === "hidden") {
    return null;
  }

  const pct = layerPercent(installProgress);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 py-8 backdrop-blur-sm"
      data-testid="local-note-processor-first-run"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-note-processor-first-run-title"
    >
      <div className="trellis-elevated relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-panel border border-trellis-border px-5 py-5 shadow-xl">
        {phase === "installing" && (
          <button
            type="button"
            data-testid="local-note-processor-cancel-download"
            className="absolute right-3 top-3 rounded-field border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text"
            aria-label="Cancel download"
            onClick={() => {
              void handleCancelDownload();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <h2 id="local-note-processor-first-run-title" className="text-lg font-medium text-trellis-text">
          {phase === "confirm-cloud"
            ? "Process notes in the cloud?"
            : phase === "blocked"
              ? "Set up on-device note processing"
              : "Downloading note processor"}
        </h2>

        {phase === "installing" && (
          <div className="mt-3 space-y-3">
            <p className="text-sm leading-relaxed text-trellis-muted">
              Trellis is downloading the small on-device model that turns chats into notes (about{" "}
              ~{defaultLocalExtractionModelApproxDownload}). This runs once; later launches use the
              copy stored in app data on your machine.
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-trellis-surface">
              <div
                className="h-full rounded-full bg-trellis-accent transition-[width] duration-300"
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-trellis-muted">
              {formatInstallLine(installProgress) || "Preparing…"}
            </p>
            <p className="text-[11px] leading-relaxed text-trellis-faint">
              Cancel if you need to pause. You can finish the download from Settings anytime.
            </p>
          </div>
        )}

        {phase === "confirm-cloud" && (
          <div className="mt-3 space-y-4">
            <p className="text-sm leading-relaxed text-trellis-muted">
              Without the local model, Trellis will process chats into notes in the cloud. That can
              mean higher usage when this runs often. Switch to cloud-only processing now?
            </p>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                checked={skipCloudPromptIfCancel}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSkipCloudPromptIfCancel(checked);
                  setSkipCloudPromptAfterLocalModelCancel(checked);
                }}
              />
              <span className="text-[11px] leading-snug text-trellis-muted">
                Don&apos;t ask again
              </span>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                data-testid="local-note-processor-go-back"
                className="rounded-field border border-trellis-border px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
                onClick={() => {
                  void goBackFromConfirmCloud();
                }}
              >
                Go back
              </button>
              <button
                type="button"
                data-testid="local-note-processor-not-now"
                className="rounded-field border border-trellis-border px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
                onClick={() => {
                  dismissForSession();
                }}
              >
                Not now
              </button>
              <button
                type="button"
                data-testid="local-note-processor-use-cloud"
                className="trellis-accent-button rounded-field border px-3 py-2 text-sm transition"
                onClick={() => {
                  void switchToCloudNoteProcessing();
                }}
              >
                Use cloud processing
              </button>
            </div>
          </div>
        )}

        {phase === "blocked" && (
          <div className="mt-3 space-y-4">
            <p className="text-sm leading-relaxed text-trellis-muted">
              {runtimeStatus?.providers.find((p) => p.id === "embedded")?.reason ??
                (subscriptionTier === "byok"
                  ? "The download did not finish. Check your network and try again to keep notes from chats on-device."
                  : "The download did not finish. Check your network and try again, or use cloud processing for now.")}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                data-testid="local-note-processor-check-again"
                className="rounded-field border border-trellis-border px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
                onClick={() => {
                  void (async () => {
                    try {
                      const status = await window.trellis.extraction.getRuntimeStatus({
                        mode: effectiveExtractionMode,
                        cloud: getOptionalExtractionCloudConfig(accessTokenRef.current ?? null)
                      });
                      setRuntimeStatus(status);
                      const embedded = status.providers.find((p) => p.id === "embedded");
                      const models = embedded?.models ?? [];
                      const primary = models.find((m) => m.id === defaultLocalExtractionModelId);
                      if (!primary?.installed) {
                        installStartedRef.current = false;
                        setPhase("installing");
                      }
                    } catch {
                      // stay blocked
                    }
                  })();
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className="h-4 w-4" />
                  Check again
                </span>
              </button>
              {subscriptionTier !== "byok" && (
                <button
                  type="button"
                  data-testid="local-note-processor-use-cloud"
                  className="rounded-field border border-trellis-border px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
                  onClick={() => {
                    setPhase("confirm-cloud");
                  }}
                >
                  Use cloud processing…
                </button>
              )}
              <button
                type="button"
                data-testid="local-note-processor-remind-later"
                className={cn(
                  "text-sm text-trellis-faint underline-offset-2 transition hover:text-trellis-muted"
                )}
                onClick={() => {
                  dismissForSession();
                }}
              >
                Remind me later
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
