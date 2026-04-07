import { useState } from "react";
import { Check, FolderOpen, LogOut, Palette, Plus, UserRound } from "lucide-react";
import type { AppSettings } from "@electron/ipc/types";
import { getActiveVault, themeOptions } from "@/lib/settings";
import { getSupabase, getSupabaseConfigError } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";

interface Props {
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => Promise<void>;
}

export function Settings({ settings, onUpdateSettings }: Props) {
  const [authMode, setAuthMode] = useState<"sign-in" | "create-account">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newVaultName, setNewVaultName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const authState = useAuthStore();
  const pushToast = useUiStore((state) => state.pushToast);
  const configError = getSupabaseConfigError();
  const stripeCheckoutUrl = import.meta.env.VITE_STRIPE_CHECKOUT_URL;
  const activeVault = getActiveVault(settings);
  const normalizedEmail = email.trim().toLowerCase();

  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
      const selectedPath = await window.trellis.vault.selectDirectory();

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

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_360px] gap-6 p-6">
      <section className="flex min-h-0 flex-col gap-6">
        <div className="trellis-panel px-6 py-6">
          <p className="font-display text-3xl text-trellis-text">Settings</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-trellis-muted">
            Choose where your notes live, how Trellis looks, and how this device stays signed in.
          </p>
        </div>

        <div className="trellis-panel px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg text-trellis-text">Vaults</p>
              <p className="mt-2 text-sm text-trellis-muted">
                Keep separate vaults for different projects, clients, or research threads.
              </p>
            </div>
            <button
              type="button"
              className="trellis-accent-button rounded-field border px-4 py-3 text-sm transition"
              onClick={() => {
                void openVault(activeVault.path);
              }}
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Open active vault
              </span>
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {settings.vaults.map((vault) => {
              const isActive = vault.id === settings.activeVaultId;

              return (
                <div
                  key={vault.id}
                  className={`rounded-panel border px-4 py-4 ${
                    isActive ? "trellis-selected-surface border-trellis-accent/30" : "bg-trellis-surface-2"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-trellis-text">{vault.name}</p>
                        {isActive && (
                          <span className="rounded-full border border-trellis-accent/25 px-2 py-0.5 text-[11px] text-trellis-accent">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="mt-2 truncate text-xs text-trellis-muted">{vault.path}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-field border border-trellis-border px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
                        onClick={() => {
                          void openVault(vault.path);
                        }}
                      >
                        Open
                      </button>
                      {!isActive && (
                        <button
                          type="button"
                          className="trellis-accent-button rounded-field border px-3 py-2 text-sm transition"
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

          <div className="mt-6 grid gap-3 rounded-panel border border-dashed border-trellis-border px-4 py-4">
            <p className="text-sm text-trellis-text">Add another vault</p>
            <input
              value={newVaultName}
              onChange={(event) => setNewVaultName(event.target.value)}
              className="trellis-input"
              placeholder="Client research, Personal notes, Paper drafts…"
            />
            <button
              type="button"
              className="trellis-accent-button w-fit rounded-field border px-4 py-3 text-sm transition"
              onClick={() => {
                void addVault();
              }}
            >
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Choose folder and add
              </span>
            </button>
          </div>
        </div>

        <div className="trellis-panel px-6 py-6">
          <div className="flex items-center gap-3">
            <Palette className="h-5 w-5 text-trellis-accent" />
            <p className="text-lg text-trellis-text">Appearance</p>
          </div>
          <p className="mt-3 text-sm leading-7 text-trellis-muted">
            Pick the workspace mood that feels right for the way you think.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {themeOptions.map((theme) => {
              const isSelected = settings.theme === theme.id;

              return (
                <button
                  key={theme.id}
                  type="button"
                  className={`rounded-field border px-4 py-3 text-left text-sm transition ${
                    isSelected
                      ? "trellis-selected-surface border-trellis-accent/30 text-trellis-text"
                      : "border-trellis-border bg-trellis-surface-2 text-trellis-muted hover:border-trellis-accent/35 hover:text-trellis-text"
                  }`}
                  onClick={() => {
                    void updateTheme(theme.id);
                  }}
                >
                  <span className="flex items-center justify-between gap-3">
                    {theme.label}
                    {isSelected && <Check className="h-4 w-4 text-trellis-accent" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-6">
        <div className="trellis-panel px-6 py-6">
          <div className="flex items-center gap-3">
            <UserRound className="h-5 w-5 text-trellis-accent" />
            <p className="text-lg text-trellis-text">Account</p>
          </div>

          {authState.status === "authenticated" ? (
            <>
              <p className="mt-3 text-sm leading-7 text-trellis-muted">
                You’re signed in on this device. Trellis keeps you logged in between app launches so you can pick up where you left off.
              </p>
              <div className="mt-5 rounded-panel border border-trellis-border bg-trellis-surface-2 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Signed in as</p>
                <p className="mt-2 text-sm text-trellis-text">{authState.user?.email ?? "Account owner"}</p>
              </div>
              <div className="mt-5 rounded-panel border border-trellis-border bg-trellis-surface-2 px-4 py-4">
                <label className="flex cursor-pointer items-start justify-between gap-3">
                  <span>
                    <p className="text-sm text-trellis-text">Stay signed in on this device</p>
                    <p className="mt-1 text-xs leading-6 text-trellis-muted">
                      Keep your account session between app launches on this computer.
                    </p>
                  </span>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-amber-500"
                    checked={settings.rememberSession}
                    onChange={(event) => {
                      void updateRememberSession(event.target.checked);
                    }}
                  />
                </label>
              </div>
              <button
                type="button"
                className="mt-5 rounded-field border border-trellis-border px-4 py-3 text-sm text-trellis-text transition hover:border-trellis-accent/35"
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

        <div className="trellis-panel px-6 py-6">
          <p className="text-lg text-trellis-text">Plan & usage</p>
          <div className="mt-5 space-y-4 text-sm text-trellis-text">
            <div>
              <p className="text-trellis-muted">Tier</p>
              <p className="mt-1">
                {authState.subscriptionTier === "pro" ? "Trellis Pro" : "Free trial"}
              </p>
            </div>
            <div>
              <p className="text-trellis-muted">Messages</p>
              <p className="mt-1">
                {authState.usage.messagesUsed} / {authState.usage.messageLimit}
              </p>
            </div>
            <div>
              <p className="text-trellis-muted">Ingests</p>
              <p className="mt-1">
                {authState.usage.ingestsUsed} / {authState.usage.ingestLimit}
              </p>
            </div>
            <div>
              <p className="text-trellis-muted">Status</p>
              <p className="mt-1 capitalize">{authState.subscriptionStatus}</p>
            </div>
            {stripeCheckoutUrl && (
              <button
                type="button"
                className="trellis-accent-button rounded-field border px-4 py-3 text-sm transition"
                onClick={() => {
                  void window.trellis.shell.openExternal(stripeCheckoutUrl).catch((error) => {
                    pushToast({
                      title:
                        error instanceof Error ? error.message : "Could not open the upgrade page.",
                      tone: "warning"
                    });
                  });
                }}
              >
                Unlock Trellis Pro
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
