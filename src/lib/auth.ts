import type { SubscriptionTier } from "@electron/ipc/types";
import type { Session } from "@supabase/supabase-js";
import {
  effectiveTrialMessagesUsed,
  trialMessageWindowResetAtIso
} from "@shared/billing/trialMessageWindow";
import { getSupabase, hasSupabaseConfig } from "./supabase";

/** Visible in DevTools; filter with `[trellis:auth]`. */
export function authLog(message: string, detail?: Record<string, unknown>): void {
  if (detail !== undefined) {
    console.info("[trellis:auth]", message, detail);
  } else {
    console.info("[trellis:auth]", message);
  }
}

const PROFILE_FETCH_TIMEOUT_MS = 12_000;
const HYDRATE_SESSION_TIMEOUT_MS = 20_000;

/** Sign-in / sign-up against Supabase Auth (renderer). */
export const CLOUD_AUTH_SIGN_IN_TIMEOUT_MS = 35_000;

async function withTimeout<T>(
  label: string,
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  const safe = promise.catch((error: unknown) => {
    authLog(`${label}: rejected`, {
      message: error instanceof Error ? error.message : String(error)
    });
    return fallback;
  });
  const timeout = new Promise<T>((resolve) => {
    setTimeout(() => {
      authLog(`${label}: timed out`, { timeoutMs: ms });
      resolve(fallback);
    }, ms);
  });
  return Promise.race([safe, timeout]);
}

export interface ProfileSnapshot {
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: "trialing" | "active" | "expired";
  /** From `profiles.is_admin`; enables preview-workspace model sandbox when true. */
  isAdmin: boolean;
  usage: {
    messagesUsed: number;
    messageLimit: number;
    /** ISO timestamp when the current trial 24h window ends; null when not on trial metering. */
    trialMessageWindowResetsAt: string | null;
    ingestsUsed: number;
    ingestLimit: number;
  };
}

function mapProfileRow(row: Record<string, unknown> | null): ProfileSnapshot {
  const subscriptionTier: SubscriptionTier =
    row?.subscription_tier === "pro"
      ? "pro"
      : row?.subscription_tier === "byok"
        ? "byok"
        : "trial";

  return {
    subscriptionTier,
    subscriptionStatus:
      row?.subscription_status === "active"
        ? "active"
        : row?.subscription_status === "expired"
          ? "expired"
          : "trialing",
    isAdmin: row?.is_admin === true,
    usage: (() => {
      const rawUsed = typeof row?.messages_used === "number" ? row.messages_used : 0;
      const limit = typeof row?.message_limit === "number" ? row.message_limit : 8;
      const windowStart =
        typeof row?.trial_message_window_started_at === "string"
          ? row.trial_message_window_started_at
          : null;

      if (subscriptionTier !== "trial") {
        return {
          messagesUsed: rawUsed,
          messageLimit: limit,
          trialMessageWindowResetsAt: null,
          ingestsUsed: typeof row?.ingests_used === "number" ? row.ingests_used : 0,
          ingestLimit: typeof row?.ingest_limit === "number" ? row.ingest_limit : 5
        };
      }

      return {
        messagesUsed: effectiveTrialMessagesUsed(rawUsed, windowStart),
        messageLimit: limit,
        trialMessageWindowResetsAt: trialMessageWindowResetAtIso(windowStart),
        ingestsUsed: typeof row?.ingests_used === "number" ? row.ingests_used : 0,
        ingestLimit: typeof row?.ingest_limit === "number" ? row.ingest_limit : 5
      };
    })()
  };
}

async function hydrateStoredSessionUnchecked(): Promise<Session | null> {
  const secureSession = await window.trellis.auth.getSession();

  if (secureSession) {
    const {
      data,
      error
    } = await getSupabase().auth.setSession({
      access_token: secureSession.accessToken,
      refresh_token: secureSession.refreshToken
    });

    if (error) {
      authLog("hydrateStoredSession: setSession from secure storage failed", {
        message: error.message
      });
      await window.trellis.auth.clearSession();
    } else {
      const resolvedSession = data.session ?? null;

      if (resolvedSession) {
        const profile = await getProfileSnapshot(resolvedSession.user.id);
        await persistSession(resolvedSession, { subscriptionTier: profile.subscriptionTier });
        return resolvedSession;
      }
    }
  }

  const {
    data: { session }
  } = await getSupabase().auth.getSession();
  if (!session) {
    return null;
  }

  const profile = await getProfileSnapshot(session.user.id);
  await persistSession(session, { subscriptionTier: profile.subscriptionTier });
  return session;
}

export async function hydrateStoredSession(): Promise<Session | null> {
  if (!hasSupabaseConfig()) {
    return null;
  }

  authLog("hydrateStoredSession: start");
  const result = await withTimeout(
    "hydrateStoredSession",
    hydrateStoredSessionUnchecked(),
    HYDRATE_SESSION_TIMEOUT_MS,
    null
  );
  authLog("hydrateStoredSession: done", { hasSession: result !== null });
  return result;
}

export async function persistSession(
  session: Session | null,
  options?: { subscriptionTier?: SubscriptionTier }
): Promise<void> {
  if (!session) {
    await window.trellis.auth.clearSession();
    return;
  }

  await window.trellis.auth.setSession({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    user: {
      id: session.user.id,
      email: session.user.email ?? null
    },
    ...(options?.subscriptionTier !== undefined ? { subscriptionTier: options.subscriptionTier } : {})
  });
}

export async function getProfileSnapshot(userId: string): Promise<ProfileSnapshot> {
  if (!hasSupabaseConfig()) {
    return mapProfileRow(null);
  }

  authLog("getProfileSnapshot: start");
  const snapshot = await withTimeout(
    "getProfileSnapshot",
    (async (): Promise<ProfileSnapshot> => {
      const { data, error } = await getSupabase()
        .from("profiles")
        .select(
          "subscription_tier, subscription_status, is_admin, messages_used, message_limit, trial_message_window_started_at, ingests_used, ingest_limit"
        )
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.warn(
          "Could not load profile snapshot from Supabase, falling back to trial defaults.",
          error
        );
        return mapProfileRow(null);
      }

      return mapProfileRow(data);
    })(),
    PROFILE_FETCH_TIMEOUT_MS,
    mapProfileRow(null)
  );
  authLog("getProfileSnapshot: done", { tier: snapshot.subscriptionTier });
  return snapshot;
}
