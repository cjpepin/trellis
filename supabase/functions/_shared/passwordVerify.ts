import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getEnvironment } from "./auth.ts";

/** Verifies password by performing a transient sign-in (session not persisted beyond this helper). */
export async function verifyUserPassword(password: string, user: User): Promise<boolean> {
  const email = typeof user.email === "string" ? user.email.trim() : "";

  if (!email) {
    return false;
  }

  const anon = createClient(getEnvironment("SUPABASE_URL"), getSupabasePublishableKeyCached(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  const { error } = await anon.auth.signInWithPassword({
    email,
    password
  });

  if (error || !anon.auth) {
    return false;
  }

  await anon.auth.signOut({ scope: "local" }).catch(() => {});

  return true;
}

let cachedPublishable: string | null = null;

function getSupabasePublishableKeyCached(): string {
  if (cachedPublishable) {
    return cachedPublishable;
  }

  cachedPublishable =
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SB_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SB_ANON_KEY");

  if (!cachedPublishable) {
    throw new Error(
      "Missing required environment variable: SUPABASE_PUBLISHABLE_KEY or SB_PUBLISHABLE_KEY"
    );
  }

  return cachedPublishable;
}
