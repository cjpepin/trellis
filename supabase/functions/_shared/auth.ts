import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  FREE_ACCOUNT_MESSAGE_LIMIT,
  GUEST_MESSAGE_LIMIT
} from "../../../shared/billing/freeTier.ts";
import {
  effectiveTrialMessagesUsed,
  trialMessageWindowResetAtIso
} from "../../../shared/billing/trialMessageWindow.ts";
import { corsHeaders } from "./http.ts";

export interface ProfileRow {
  id: string;
  email: string | null;
  subscription_tier: "trial" | "byok" | "pro";
  subscription_status: "trialing" | "active" | "expired";
  messages_used: number;
  message_limit: number;
  ingests_used: number;
  ingest_limit: number;
  stripe_customer_id: string | null;
  /** Set while the account is in a deletion / recovery window. */
  deleted_at?: string | null;
  /** Start of the current 24h window for trial `messages_used` (trial tier only). */
  trial_message_window_started_at?: string | null;
  /** Set in DB only via service role / SQL; enables preview sandbox entitlements. */
  is_admin: boolean;
}

export function getEnvironment(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getSupabasePublishableKey(): string {
  const value =
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SB_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SB_ANON_KEY");

  if (!value) {
    throw new Error(
      "Missing required environment variable: SUPABASE_PUBLISHABLE_KEY or SB_PUBLISHABLE_KEY"
    );
  }

  return value;
}

function getBearerToken(request: Request): string {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    throw new Response("Unauthorized", {
      status: 401,
      headers: corsHeaders
    });
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new Response("Unauthorized", {
      status: 401,
      headers: corsHeaders
    });
  }

  return token;
}

export function getAdminClient(): SupabaseClient {
  return createClient(
    getEnvironment("SUPABASE_URL"),
    getEnvironment("SUPABASE_SERVICE_ROLE_KEY")
  );
}

async function resolveUserFromToken(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  token: string
): Promise<User> {
  const claimsResult = await supabase.auth.getClaims(token);

  if (!claimsResult.error && claimsResult.data?.claims) {
    const sub = claimsResult.data.claims.sub;

    if (typeof sub === "string" && sub.length > 0) {
      const { data, error } = await admin.auth.admin.getUserById(sub);

      if (!error && data.user) {
        return data.user;
      }
    }
  }

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    console.error("Supabase auth verification failed inside Edge Function.", {
      claimsError: claimsResult.error?.message ?? null,
      authError: authError?.message ?? null
    });

    throw new Response("Unauthorized", {
      status: 401,
      headers: corsHeaders
    });
  }

  return user;
}

export async function auditAccountAction(
  admin: SupabaseClient,
  payload: {
    userId: string;
    action: string;
    request: Request;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const fwd = payload.request.headers.get("x-forwarded-for");
  const rawIp =
    fwd && fwd.length > 0 ? fwd.split(",")[0]?.trim() : payload.request.headers.get("cf-connecting-ip") ?? null;

  await admin.from("account_action_audit").insert({
    user_id: payload.userId,
    action: payload.action,
    ip: rawIp ?? null,
    user_agent: payload.request.headers.get("user-agent") ?? null,
    metadata: payload.metadata ?? {}
  });
}

/** Rate limit destructive account endpoints (~10 calls / rolling hour per user id). */
export async function enforceAccountDestructiveRateLimit(
  admin: SupabaseClient,
  userId: string
): Promise<Response | null> {
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const maxPerHour = 10;

  const { count, error } = await admin
    .from("account_action_audit")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", windowStart)
    .like("action", "account_%");

  if (error) {
    console.warn("account audit rate query failed.", error.message);
    return null;
  }

  if (typeof count === "number" && count >= maxPerHour) {
    return new Response(JSON.stringify({ error: "Too many attempts. Try again later." }), {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }

  return null;
}

export async function requireUser(
  request: Request,
  options: { allowDeleted?: boolean } = {}
): Promise<{ user: User; profile: ProfileRow; admin: SupabaseClient }> {
  const admin = getAdminClient();
  const token = getBearerToken(request);

  const supabase = createClient(
    getEnvironment("SUPABASE_URL"),
    getSupabasePublishableKey()
  );

  const user = await resolveUserFromToken(supabase, admin, token);

  const { data: existingProfile, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  const allowDeleted = options.allowDeleted === true;

  if (existingProfile) {
    const profile = existingProfile as ProfileRow;
    const deletedAt = profile.deleted_at ?? null;
    if (deletedAt && !allowDeleted) {
      throw new Response(
        JSON.stringify({
          error: "account_pending_deletion",
          deleted_at: deletedAt
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
    return {
      user,
      profile,
      admin
    };
  }

  const { data: createdProfile, error: insertError } = await admin
    .from("profiles")
    .insert({
      id: user.id,
      email: user.email ?? null
    })
    .select("*")
    .single();

  if (insertError || !createdProfile) {
    throw insertError ?? new Error("Could not create a profile for the authenticated user.");
  }

  const profile = createdProfile as ProfileRow;

  if (profile.deleted_at && !allowDeleted) {
    throw new Response(
      JSON.stringify({
        error: "account_pending_deletion",
        deleted_at: profile.deleted_at
      }),
      {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }

  return {
    user,
    profile,
    admin
  };
}

export function assertEntitlement(
  profile: ProfileRow,
  kind: "message" | "ingest",
  options?: { isAnonymousUser?: boolean }
): void {
  // `x-trellis-preview-workspace` / body.previewWorkspace do not affect entitlement; only
  // `profile.is_admin` and subscription/BYOK state do (see docs/agents/entitlements.md).

  if (profile.is_admin === true) {
    return;
  }

  if (profile.subscription_status === "expired") {
    throw new Response(JSON.stringify({ error: "subscription_expired" }), {
      status: 402,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }

  if (profile.subscription_tier === "pro") {
    return;
  }

  if (kind === "message" && profile.subscription_tier === "byok") {
    return;
  }

  const used =
    kind === "message"
      ? effectiveTrialMessagesUsed(
          profile.messages_used,
          profile.trial_message_window_started_at ?? null
        )
      : profile.ingests_used;
  const limit =
    kind === "message"
      ? options?.isAnonymousUser
        ? GUEST_MESSAGE_LIMIT
        : profile.message_limit || FREE_ACCOUNT_MESSAGE_LIMIT
      : profile.ingest_limit;

  if (used >= limit) {
    const resetAt =
      kind === "message"
        ? trialMessageWindowResetAtIso(profile.trial_message_window_started_at ?? null)
        : null;
    throw new Response(
      JSON.stringify({
        error: "message_quota_exceeded",
        reset_at: resetAt
      }),
      {
        status: 402,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }
}

export async function incrementUsage(
  admin: SupabaseClient,
  userId: string,
  kind: "message" | "ingest",
  amount: number,
  metadata: Record<string, unknown>,
  options?: { skipCounterUpdate?: boolean }
): Promise<void> {
  const field = kind === "message" ? "messages_used" : "ingests_used";
  if (!options?.skipCounterUpdate) {
    const { error: rpcError } = await admin.rpc("increment_profile_usage_counters", {
      p_user_id: userId,
      p_field: field,
      p_amount: amount
    });

    if (rpcError) {
      throw rpcError;
    }
  }

  const { error: usageError } = await admin.from("usage_events").insert({
    user_id: userId,
    kind,
    amount,
    metadata
  });

  if (usageError) {
    throw usageError;
  }
}
