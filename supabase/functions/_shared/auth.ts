import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.4";
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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  const payloadSegment = segments[1];

  if (segments.length !== 3 || !payloadSegment) {
    return null;
  }

  try {
    const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
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
  token: string,
  supabaseUrl: string
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
    const payload = decodeJwtPayload(token);
    console.error("Supabase auth verification failed inside Edge Function.", {
      claimsError: claimsResult.error?.message ?? null,
      authError: authError?.message ?? null,
      expectedIssuer: `${supabaseUrl}/auth/v1`,
      tokenIssuer: typeof payload?.iss === "string" ? payload.iss : null,
      tokenRole: typeof payload?.role === "string" ? payload.role : null,
      tokenSubject: typeof payload?.sub === "string" ? payload.sub : null,
      tokenSessionId: typeof payload?.session_id === "string" ? payload.session_id : null
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
  const supabaseUrl = getEnvironment("SUPABASE_URL");

  const supabase = createClient(
    supabaseUrl,
    getSupabasePublishableKey()
  );

  const user = await resolveUserFromToken(supabase, admin, token, supabaseUrl);

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

export function assertEntitlement(profile: ProfileRow, kind: "message" | "ingest"): void {
  if (profile.subscription_status === "expired") {
    throw new Response(JSON.stringify({ error: "trial_expired" }), {
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

  const used = kind === "message" ? profile.messages_used : profile.ingests_used;
  const limit = kind === "message" ? profile.message_limit : profile.ingest_limit;

  if (used >= limit) {
    throw new Response(JSON.stringify({ error: "trial_expired" }), {
      status: 402,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
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
    const profile = await admin
      .from("profiles")
      .select(field)
      .eq("id", userId)
      .single();

    if (profile.error || !profile.data) {
      throw profile.error ?? new Error("Could not fetch usage counters.");
    }

    const currentValue = profile.data[field] ?? 0;
    const { error: updateError } = await admin
      .from("profiles")
      .update({
        [field]: currentValue + amount,
        updated_at: new Date().toISOString()
      })
      .eq("id", userId);

    if (updateError) {
      throw updateError;
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
