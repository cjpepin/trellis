import { useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { getProfileSnapshot, GUEST_MESSAGE_LIMIT } from "@/lib/auth";
import { getTrellisApiClient } from "@/lib/cloud/client";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function formatDeadline(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return "";
  }
  const end = t + WINDOW_MS;
  return new Date(end).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function mapAccountError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("recovery_window_expired") || lower.includes("410")) {
    return "The recovery window has ended. You can sign up again with this email after it is released.";
  }
  if (lower.includes("invalid_password") || lower.includes("401")) {
    return "That password did not match.";
  }
  if (lower.includes("email_mismatch")) {
    return "That email does not match your account.";
  }
  if (lower.includes("verified_email_required")) {
    return "A verified email is required for this action.";
  }
  if (lower.includes("missing") || lower.includes("400")) {
    return "Please fill in all required fields.";
  }
  return message;
}

export function AccountPendingDeletionModal(): JSX.Element | null {
  const accountDeletedAt = useAuthStore((s) => s.accountDeletedAt);
  const isAnonymousUser = useAuthStore((s) => s.isAnonymousUser);
  const authStatus = useAuthStore((s) => s.status);
  const userEmail = useAuthStore((s) => s.user?.email ?? null);
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);

  const pushToast = useUiStore((state) => state.pushToast);

  const [recoverPassword, setRecoverPassword] = useState("");
  const [abandonPassword, setAbandonPassword] = useState("");
  const [abandonEmail, setAbandonEmail] = useState("");
  const [abandonConfirmed, setAbandonConfirmed] = useState(false);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);

  const [recoverBusy, setRecoverBusy] = useState(false);
  const [abandonBusy, setAbandonBusy] = useState(false);

  const deadlineLabel = useMemo(
    () => (accountDeletedAt ? formatDeadline(accountDeletedAt) : ""),
    [accountDeletedAt]
  );

  const visible =
    authStatus === "authenticated" &&
    Boolean(accountDeletedAt) &&
    !isAnonymousUser &&
    Boolean(userEmail);

  if (!visible) {
    return null;
  }

  async function refreshAuthFromProfile(): Promise<void> {
    const {
      data: { session }
    } = await getSupabase().auth.getSession();
    if (!session) {
      return;
    }

    const profile = await getProfileSnapshot(session.user.id);
    const guest = session.user.is_anonymous === true;
    setAuthenticated({
      accessToken: session.access_token,
      user: {
        id: session.user.id,
        email: session.user.email ?? null
      },
      isAnonymousUser: guest,
      subscriptionTier: profile.subscriptionTier,
      subscriptionStatus: profile.subscriptionStatus,
      isAdmin: profile.isAdmin,
      usage: {
        ...profile.usage,
        messageLimit: guest ? GUEST_MESSAGE_LIMIT : profile.usage.messageLimit
      },
      accountDeletedAt: profile.deletedAt
    });
  }

  async function handleRecover(): Promise<void> {
    setRecoverBusy(true);
    try {
      const client = getTrellisApiClient();
      const result = await client.recoverAccount({ password: recoverPassword });
      setRecoverPassword("");

      await refreshAuthFromProfile();

      pushToast({
        title: result.stripe_resumed
          ? "You're back in. Paid Trellis subscriptions are billing again the way your plan normally runs."
          : "You're back in — your Trellis account is fully open.",
        tone: "default"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not recover your account.";
      pushToast({
        title: mapAccountError(message),
        tone: "error"
      });
    } finally {
      setRecoverBusy(false);
    }
  }

  async function handleAbandon(): Promise<void> {
    setAbandonBusy(true);
    try {
      const client = getTrellisApiClient();
      await client.abandonAccountDeletion({
        password: abandonPassword,
        email_confirmation: abandonEmail.trim().toLowerCase(),
        confirm_abandon: true
      });

      await getSupabase().auth.signOut();

      pushToast({
        title:
          "Signed out. Trellis billing is disconnected for this login — we won't charge it again.",
        tone: "default"
      });

      setAbandonPassword("");
      setAbandonEmail("");
      setAbandonConfirmed(false);
      setShowAbandonConfirm(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not complete account deletion.";
      pushToast({
        title: mapAccountError(message),
        tone: "error"
      });
    } finally {
      setAbandonBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-[3px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-deletion-title"
        className="trellis-elevated w-full max-w-lg rounded-panel border border-rose-500/25 bg-trellis-surface px-5 py-6 shadow-[var(--trellis-elevated-shadow)]"
      >
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10">
            <AlertTriangle className="h-5 w-5 text-rose-300" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p id="pending-deletion-title" className="font-display text-xl text-trellis-text">
              Your Trellis login is winding down
            </p>
            <p className="mt-2 text-sm leading-6 text-trellis-muted">
              You&apos;re in a{" "}
              <span className="text-trellis-text font-medium">
                30-day window — nothing closes automatically until then
              </span>
              . We&apos;ve paused Trellis subscription billing so nothing new charges while you decide. Undo
              with your password, or finish closing below if you&apos;re done here.
            </p>
            {deadlineLabel ? (
              <p className="mt-2 text-xs text-trellis-faint">
                If you don&apos;t undo and don&apos;t close out sooner here, Trellis completes this logout on{" "}
                <span className="text-trellis-muted">{deadlineLabel}</span>, your local time.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 space-y-4 border-t border-trellis-border pt-6">
          <div>
            <p className="text-sm font-medium text-trellis-text">Stay with Trellis</p>
            <p className="mt-1 text-xs text-trellis-muted">
              Password only — reopen Trellis here. Paid plans resume billing normally after the pause.
            </p>
            <input
              type="password"
              autoComplete="current-password"
              className="trellis-input mt-3 w-full"
              placeholder="Password"
              value={recoverPassword}
              onChange={(event) => {
                setRecoverPassword(event.target.value);
              }}
            />
            <button
              type="button"
              disabled={recoverBusy || recoverPassword.length === 0}
              className="trellis-accent-button mt-3 w-full rounded-field border px-4 py-2.5 text-sm transition disabled:border-trellis-border disabled:bg-trellis-surface disabled:text-trellis-faint"
              onClick={() => {
                void handleRecover();
              }}
            >
              <span className="flex items-center justify-center gap-2">
                {recoverBusy ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Bringing it back…
                  </>
                ) : (
                  "Undo — keep my account"
                )}
              </span>
            </button>
          </div>

          <div className="rounded-panel border border-trellis-border bg-trellis-surface-2 px-4 py-3">
            <p className="text-sm font-medium text-rose-200/95">Finish closing for good</p>
            <p className="mt-1 text-xs leading-5 text-trellis-muted">
              Skip the clock — signs you out now, drops Trellis billing on this login, and you won&apos;t use this
              account again. App data may be retained internally without this access; your email frees up so you
              can start fresh later.
            </p>
            {!showAbandonConfirm ? (
              <button
                type="button"
                className={cn(
                  "mt-3 w-full rounded-field border px-4 py-2.5 text-sm text-rose-200 transition",
                  "border-rose-500/35 hover:border-rose-400/55"
                )}
                onClick={() => {
                  setShowAbandonConfirm(true);
                  setAbandonConfirmed(false);
                }}
              >
                I&apos;m done — close it now…
              </button>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-xs leading-5 text-trellis-warning">
                  Last check: enter your email and password. After this Trellis billing stops and your session ends.
                </p>
                <input
                  className="trellis-input w-full"
                  type="email"
                  autoComplete="email"
                  placeholder={userEmail ?? "you@example.com"}
                  value={abandonEmail}
                  onChange={(event) => {
                    setAbandonEmail(event.target.value);
                  }}
                />
                <input
                  className="trellis-input w-full"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={abandonPassword}
                  onChange={(event) => {
                    setAbandonPassword(event.target.value);
                  }}
                />
                <label className="flex cursor-pointer items-start gap-2 text-xs text-trellis-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                    checked={abandonConfirmed}
                    onChange={(event) => {
                      setAbandonConfirmed(event.target.checked);
                    }}
                  />
                  I understand Trellis billing ends here for this login and I won&apos;t reopen this session.
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-field border border-trellis-border px-4 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
                    onClick={() => {
                      setShowAbandonConfirm(false);
                      setAbandonConfirmed(false);
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={
                      abandonBusy ||
                      abandonPassword.length === 0 ||
                      abandonEmail.trim().length === 0 ||
                      !abandonConfirmed
                    }
                    className={cn(
                      "flex-1 rounded-field border px-4 py-2 text-sm transition",
                      "border-rose-500/45 text-rose-100 hover:border-rose-400/60 disabled:border-trellis-border disabled:bg-trellis-surface disabled:text-trellis-faint"
                    )}
                    onClick={() => {
                      void handleAbandon();
                    }}
                  >
                    {abandonBusy ? (
                      <span className="flex items-center justify-center gap-2">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Closing…
                      </span>
                    ) : (
                      "Close account & sign out"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
