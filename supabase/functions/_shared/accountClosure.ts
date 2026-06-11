import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { deleteStripeCustomer, listSubscriptionIdsForCustomer } from "./stripeSubscription.ts";

export function placeholderEmail(userId: string): string {
  return `deleted.${userId.replace(/-/g, "")}@disabled.invalid`;
}

/**
 * Ends the recovery chapter: Stripe billing removed from the user, Auth email released for reuse,
 * user banned so they cannot sign in with the orphaned profile (data rows retained keyed by old id).
 */
export async function finalizeAccountOrphan(
  admin: SupabaseClient,
  userId: string,
  stripeCustomerId: string | null | undefined
): Promise<void> {
  if (stripeCustomerId) {
    await listSubscriptionIdsForCustomer(stripeCustomerId).catch(() => []);

    await deleteStripeCustomer(stripeCustomerId).catch((error) =>
      console.warn("deleteStripeCustomer failed (may already be absent)", error)
    );
  }

  const nextEmail = placeholderEmail(userId);

  const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
    email: nextEmail,
    ban_duration: "876600h"
  });

  if (authUpdateError) {
    throw authUpdateError;
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      email: nextEmail,
      deleted_at: null,
      stripe_customer_id: null,
      subscription_tier: "trial",
      subscription_status: "expired",
      updated_at: new Date().toISOString()
    })
    .eq("id", userId);

  if (profileError) {
    throw profileError;
  }
}
