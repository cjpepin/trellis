import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { appShellPath } from "@/lib/appRoutes";
import { getSupabase } from "@/lib/supabase";

type ConfirmState = "verifying" | "ready" | "error" | "password-reset";

export function AuthConfirmPage() {
  usePageMeta({
    title: "Confirm account",
    description: "Complete email confirmation or password recovery for your Trellis account.",
    pathname: "/auth/confirm"
  });

  const [searchParams] = useSearchParams();
  const [state, setState] = useState<ConfirmState>("verifying");
  const [message, setMessage] = useState("Verifying your link…");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const tokenHash = searchParams.get("token_hash");
  const otpType = (searchParams.get("type") ?? "") as
    | "signup"
    | "recovery"
    | "email"
    | "magiclink"
    | "invite"
    | "email_change";

  useEffect(() => {
    if (!tokenHash || !otpType) {
      setState("error");
      setMessage("That confirmation link is missing the expected token.");
      return;
    }

    let cancelled = false;

    void getSupabase()
      .auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType
      })
      .then(({ error }) => {
        if (cancelled) {
          return;
        }

        if (error) {
          setState("error");
          setMessage(error.message);
          return;
        }

        if (otpType === "recovery") {
          setState("password-reset");
          setMessage("Choose a new password to finish account recovery.");
          return;
        }

        setState("ready");
        setMessage("Your link is confirmed. You can open Trellis now.");
      })
      .catch((error) => {
        if (!cancelled) {
          setState("error");
          setMessage(error instanceof Error ? error.message : "Could not verify that link.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [otpType, tokenHash]);

  const passwordValidation = useMemo(() => {
    if (state !== "password-reset") {
      return null;
    }
    if (!password) {
      return "Enter a new password.";
    }
    if (password.length < 8) {
      return "Use at least 8 characters for your password.";
    }
    if (password !== confirmPassword) {
      return "Passwords do not match yet.";
    }
    return null;
  }, [confirmPassword, password, state]);

  async function handleResetPassword(): Promise<void> {
    if (passwordValidation) {
      return;
    }

    const { error } = await getSupabase().auth.updateUser({ password });

    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }

    setState("ready");
    setMessage("Password updated. You can open Trellis now.");
  }

  return (
    <PublicLayout>
      <section className="mx-auto flex min-h-[60vh] w-full max-w-4xl items-center px-6 py-16">
        <div className="trellis-elevated w-full rounded-panel border border-trellis-border bg-trellis-surface/90 px-6 py-8 text-center">
          <h1 className="font-display text-5xl text-trellis-text">Account confirmation</h1>
          <p className="mt-4 text-sm leading-7 text-trellis-muted">{message}</p>

          {state === "password-reset" && (
            <div className="mx-auto mt-8 grid max-w-md gap-3 text-left">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                className="trellis-input"
                placeholder="New password"
              />
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                className="trellis-input"
                placeholder="Confirm new password"
              />
              {passwordValidation && <p className="text-xs text-trellis-warning">{passwordValidation}</p>}
              <button
                type="button"
                className="trellis-accent-button rounded-field border px-4 py-3 text-sm transition"
                onClick={() => {
                  void handleResetPassword();
                }}
              >
                Save new password
              </button>
            </div>
          )}

          {state === "ready" && (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link to={appShellPath("/chat")} className="trellis-accent-button rounded-field border px-5 py-3 text-sm transition">
                Open app
              </Link>
              <Link to="/auth" className="rounded-field border border-trellis-border px-5 py-3 text-sm text-trellis-text transition hover:border-trellis-accent/35">
                Back to sign in
              </Link>
            </div>
          )}

          {state === "error" && (
            <div className="mt-8">
              <Link to="/auth" className="rounded-field border border-trellis-border px-5 py-3 text-sm text-trellis-text transition hover:border-trellis-accent/35">
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
