import {
  auditAccountAction,
  enforceAccountDestructiveRateLimit,
  requireUser
} from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/http.ts";
import {
  assertMaxJsonBodyBytes,
  readJsonBodyWithByteLimit
} from "../_shared/requestLimits.ts";
import { verifyUserPassword } from "../_shared/passwordVerify.ts";
import { listSubscriptionIdsForCustomer, pauseSubscriptionBilling } from "../_shared/stripeSubscription.ts";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    assertMaxJsonBodyBytes(request);
    const body = await readJsonBodyWithByteLimit(request);

    const emailConfirmation =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).email_confirmation === "string"
        ? (body as Record<string, unknown>).email_confirmation.trim().toLowerCase()
        : null;

    const password =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).password === "string"
        ? (body as Record<string, unknown>).password
        : "";

    if (!password || typeof emailConfirmation !== "string" || emailConfirmation.length === 0) {
      return jsonResponse({ error: "missing_fields" }, 400);
    }

    const ctx = await requireUser(request);

    if (ctx.user.is_anonymous === true) {
      return jsonResponse({ error: "guest_accounts_cannot_delete" }, 403);
    }

    if (!ctx.user.email) {
      return jsonResponse({ error: "verified_email_required" }, 403);
    }

    if (emailConfirmation !== ctx.user.email.trim().toLowerCase()) {
      return jsonResponse({ error: "email_mismatch" }, 400);
    }

    const rateLimited = await enforceAccountDestructiveRateLimit(ctx.admin, ctx.user.id);
    if (rateLimited) {
      return rateLimited;
    }

    if (ctx.profile.deleted_at) {
      return jsonResponse({ error: "already_pending_deletion" }, 409);
    }

    const passwordOk = await verifyUserPassword(password, ctx.user);
    if (!passwordOk) {
      return jsonResponse({ error: "invalid_password" }, 401);
    }

    const customerId =
      typeof ctx.profile.stripe_customer_id === "string" ? ctx.profile.stripe_customer_id : null;

    if (customerId) {
      try {
        const subs = await listSubscriptionIdsForCustomer(customerId);

        await Promise.all(
          subs.map((subId) =>
            pauseSubscriptionBilling(subId).catch((error) =>
              console.warn(`pause subscription failed for ${subId}`, error)
            )
          )
        );
      } catch (error) {
        console.warn("Stripe pause skipped or failed:", error instanceof Error ? error.message : error);
      }
    }

    const deletedAtIso = new Date().toISOString();

    const { error: updateError } = await ctx.admin
      .from("profiles")
      .update({
        deleted_at: deletedAtIso,
        updated_at: deletedAtIso
      })
      .eq("id", ctx.user.id);

    if (updateError) {
      throw updateError;
    }

    await auditAccountAction(ctx.admin, {
      userId: ctx.user.id,
      action: "account_soft_delete_requested",
      request,
      metadata: { stripe_pause_attempted: Boolean(customerId) }
    });

    return jsonResponse({ ok: true, deleted_at: deletedAtIso });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error(error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "could_not_schedule_deletion"
      },
      { status: 500 }
    );
  }
});
