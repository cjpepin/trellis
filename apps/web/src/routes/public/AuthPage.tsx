import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useSupabaseSessionState } from "@/hooks/useSupabaseSessionState";
import {
  authLog,
  CLOUD_AUTH_SIGN_IN_TIMEOUT_MS,
  suppressNextAnonymousSignIn
} from "@/lib/auth";
import { appShellPath } from "@/lib/appRoutes";
import { completeAnonymousUpgrade } from "@/lib/publicContent";
import { getSupabase, getSupabaseConfigError } from "@/lib/supabase";
import { buildAbsoluteSiteUrl } from "@/lib/siteConfig";

type AuthMode = "sign-in" | "create-account" | "forgot-password";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

export function AuthPage() {
  usePageMeta({
    title: "Sign in",
    description: "Create a Trellis account, sign in, or reset your password for the hosted app.",
    pathname: "/auth"
  });

  const navigate = useNavigate();
  const { session, isAnonymousUser } = useSupabaseSessionState();
  const configError = getSupabaseConfigError();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();
  const validationError = useMemo(() => {
    if (mode === "forgot-password") {
      if (!normalizedEmail) {
        return "Enter your email to request a reset link.";
      }
      return null;
    }

    if (!normalizedEmail) {
      return "Enter your email address.";
    }
    if (!password) {
      return "Enter your password.";
    }
    if (mode === "create-account") {
      if (password.length < 8) {
        return "Use at least 8 characters for your password.";
      }
      if (password !== confirmPassword) {
        return "Passwords do not match yet.";
      }
    }
    return null;
  }, [confirmPassword, mode, normalizedEmail, password]);

  async function handleSignIn(): Promise<void> {
    if (isAnonymousUser) {
      suppressNextAnonymousSignIn();
      const { error: signOutError } = await getSupabase().auth.signOut();
      if (signOutError) {
        throw signOutError;
      }
    }

    authLog("publicSignIn: request");
    const { error } = await withTimeout(
      getSupabase().auth.signInWithPassword({
        email: normalizedEmail,
        password
      }),
      CLOUD_AUTH_SIGN_IN_TIMEOUT_MS,
      "Sign-in timed out. Check your network and try again."
    );

    if (error) {
      throw error;
    }

    authLog("publicSignIn: success");
    navigate(appShellPath("/chat"));
  }

  async function handleCreateAccount(): Promise<void> {
    if (isAnonymousUser) {
      authLog("publicUpgradeAnonymous: request");
      const { error } = await withTimeout(
        getSupabase().auth.updateUser({
          email: normalizedEmail,
          password
        }),
        CLOUD_AUTH_SIGN_IN_TIMEOUT_MS,
        "Account creation timed out. Check your network and try again."
      );

      if (error) {
        throw error;
      }

      await completeAnonymousUpgrade().catch((upgradeError) => {
        console.warn("Could not finalize the guest account upgrade.", upgradeError);
      });
      authLog("publicUpgradeAnonymous: success");
      setStatusMessage(
        "Account linked. Check your email if confirmation is required, then continue in the app."
      );
      navigate(appShellPath("/chat"));
      return;
    }

    authLog("publicSignUp: request");
    const { error } = await withTimeout(
      getSupabase().auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: buildAbsoluteSiteUrl("/auth/confirm")
        }
      }),
      CLOUD_AUTH_SIGN_IN_TIMEOUT_MS,
      "Account creation timed out. Check your network and try again."
    );

    if (error) {
      throw error;
    }

    authLog("publicSignUp: success");
    setStatusMessage("Account created. Check your email if confirmation is enabled.");
  }

  async function handleForgotPassword(): Promise<void> {
    const { error } = await getSupabase().auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: buildAbsoluteSiteUrl("/auth/confirm")
    });

    if (error) {
      throw error;
    }

    setStatusMessage("Password reset email sent. Open the link in your inbox to continue.");
  }

  async function handleSubmit(): Promise<void> {
    if (configError || validationError) {
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      if (mode === "sign-in") {
        await handleSignIn();
      } else if (mode === "create-account") {
        await handleCreateAccount();
      } else {
        await handleForgotPassword();
      }

      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      authLog("publicAuth: failed", {
        message: error instanceof Error ? error.message : String(error)
      });
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PublicLayout>
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-16 md:flex-row md:items-start">
        <div className="max-w-xl flex-1">
          <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Account access</p>
          <h1 className="mt-4 font-display text-5xl text-trellis-text">Sign in, create an account, or continue from guest mode.</h1>
          <p className="mt-4 text-base leading-8 text-trellis-muted">
            The hosted app keeps a small guest allowance so people can try Trellis. Create a free
            account when you want the full `25 messages / 24 hours` window and a path to sync across devices.
          </p>
          <div className="mt-6 rounded-panel border border-trellis-border bg-trellis-surface/80 px-4 py-4 text-sm leading-7 text-trellis-muted">
            Guest web sessions get `5 messages / 24 hours`. Registered free accounts get `25 messages / 24 hours`.
          </div>
        </div>

        <div className="trellis-elevated w-full max-w-lg rounded-panel border border-trellis-border bg-trellis-surface/90 px-6 py-6">
          <div className="inline-flex rounded-full border border-trellis-border bg-trellis-surface-2 p-1">
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-sm transition ${mode === "sign-in" ? "trellis-selected-surface text-trellis-text" : "text-trellis-muted"}`}
              onClick={() => setMode("sign-in")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-sm transition ${mode === "create-account" ? "trellis-selected-surface text-trellis-text" : "text-trellis-muted"}`}
              onClick={() => setMode("create-account")}
            >
              Create account
            </button>
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-sm transition ${mode === "forgot-password" ? "trellis-selected-surface text-trellis-text" : "text-trellis-muted"}`}
              onClick={() => setMode("forgot-password")}
            >
              Reset password
            </button>
          </div>

          <div className="mt-5 grid gap-3">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              className="trellis-input"
              placeholder="you@example.com"
            />
            {mode !== "forgot-password" && (
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                className="trellis-input"
                placeholder="Password"
              />
            )}
            {mode === "create-account" && (
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                className="trellis-input"
                placeholder="Confirm password"
              />
            )}
          </div>

          <button
            type="button"
            disabled={Boolean(configError) || Boolean(validationError) || submitting}
            className="trellis-accent-button mt-5 w-full rounded-field border px-4 py-3 text-sm transition disabled:border-trellis-border disabled:bg-trellis-surface disabled:text-trellis-faint"
            onClick={() => {
              void handleSubmit();
            }}
          >
            {submitting
              ? "Working…"
              : mode === "sign-in"
                ? "Sign in"
                : mode === "create-account"
                  ? "Create account"
                  : "Send reset link"}
          </button>

          {validationError && !configError && <p className="mt-3 text-xs text-trellis-warning">{validationError}</p>}
          {configError && <p className="mt-3 text-xs text-trellis-warning">{configError}</p>}
          {errorMessage && <p className="mt-3 text-xs text-trellis-error">{errorMessage}</p>}
          {statusMessage && <p className="mt-3 text-xs text-trellis-success">{statusMessage}</p>}

          <p className="mt-5 text-xs leading-6 text-trellis-muted">
            Need the product story first? <Link to="/" className="text-trellis-text underline underline-offset-2">Go back to the landing page</Link>.
          </p>
          {session && !isAnonymousUser && (
            <p className="mt-2 text-xs leading-6 text-trellis-muted">
              You already have a signed-in session. <Link to={appShellPath("/chat")} className="text-trellis-text underline underline-offset-2">Open the app</Link>.
            </p>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
