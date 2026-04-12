import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.4";
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

export async function requireUser(
  request: Request
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

  if (existingProfile) {
    return {
      user,
      profile: existingProfile as ProfileRow,
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

  return {
    user,
    profile: createdProfile as ProfileRow,
    admin
  };
}

export function assertEntitlement(
  profile: ProfileRow,
  kind: "message" | "ingest",
  options?: { previewWorkspaceRequest?: boolean }
): void {
  if (options?.previewWorkspaceRequest) {
    return;
  }

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
  const limit = kind === "message" ? profile.message_limit : profile.ingest_limit;

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
