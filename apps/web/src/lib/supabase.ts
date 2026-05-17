import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

let client: SupabaseClient | null = null;

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

function isRendererSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) {
    return true;
  }

  const payload = decodeJwtPayload(key);
  return payload?.role === "service_role";
}

export function getSupabaseConfigError(): string | null {
  if (supabaseUrl.length === 0 || supabasePublishableKey.length === 0) {
    return "Cloud features are not configured for this build yet.";
  }

  if (isRendererSecretKey(supabasePublishableKey)) {
    return "This build is using an unsafe cloud key. Use a publishable client key instead.";
  }

  return null;
}

export function hasSupabaseConfig(): boolean {
  return getSupabaseConfigError() === null;
}

export function getSupabase(): SupabaseClient {
  const configError = getSupabaseConfigError();

  if (configError) {
    throw new Error(configError);
  }

  if (!client) {
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }

  return client;
}

export async function restoreSupabaseSession(session: Session | null): Promise<void> {
  if (!session || !hasSupabaseConfig()) {
    return;
  }

  await getSupabase().auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  });
}
