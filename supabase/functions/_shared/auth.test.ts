import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertEntitlement, type ProfileRow } from "./auth.ts";

function baseProfile(over: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "user-test",
    email: null,
    subscription_tier: "trial",
    subscription_status: "trialing",
    messages_used: 0,
    message_limit: 10,
    ingests_used: 0,
    ingest_limit: 5,
    stripe_customer_id: null,
    trial_message_window_started_at: null,
    is_admin: false,
    ...over
  };
}

Deno.test("assertEntitlement: trial at message limit throws 402", () => {
  let caught: Response | null = null;
  try {
    assertEntitlement(
      baseProfile({
        messages_used: 10,
        message_limit: 10
      }),
      "message"
    );
  } catch (error) {
    if (error instanceof Response) {
      caught = error;
    } else {
      throw error;
    }
  }
  assertEquals(caught?.status, 402);
});

Deno.test("assertEntitlement: admin bypasses quota", () => {
  assertEntitlement(
    baseProfile({
      is_admin: true,
      messages_used: 999,
      message_limit: 10
    }),
    "message"
  );
});

Deno.test("assertEntitlement: pro bypasses quota", () => {
  assertEntitlement(
    baseProfile({
      subscription_tier: "pro",
      messages_used: 999,
      message_limit: 10
    }),
    "message"
  );
});
