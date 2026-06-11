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
import { listSubscriptionIdsForCustomer, resumeSubscriptionBilling } from "../_shared/stripeSubscription.ts";

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

    const password =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).password === "string"
        ? (body as Record<string, unknown>).password
        : "";

    if (!password) {
      return jsonResponse({ error: "missing_password" }, 400);
    }

    const ctx = await requireUser(request, { allowDeleted: true });

    const deletedAt = ctx.profile.deleted_at ?? null;
    if (!deletedAt) {
      return jsonResponse({ error: "not_pending_deletion" }, 400);
    }

    const deletedTime = Date.parse(deletedAt);
    if (!Number.isFinite(deletedTime)) {
      return jsonResponse({ error: "invalid_deleted_state" }, 500);
    }

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (deletedTime < cutoff) {
      return jsonResponse({ error: "recovery_window_expired" }, 410);
    }

    const rateLimited = await enforceAccountDestructiveRateLimit(ctx.admin, ctx.user.id);
    if (rateLimited) {
      return rateLimited;
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
            resumeSubscriptionBilling(subId).catch((error) =>
              console.warn(`resume subscription failed ${subId}`, error)
            )
          )
        );
      } catch (error) {
        console.warn("stripe resume skipped", error instanceof Error ? error.message : error);
      }
    }

    const iso = new Date().toISOString();

    const { error: profileError } = await ctx.admin
      .from("profiles")
      .update({
        deleted_at: null,
        updated_at: iso
      })
      .eq("id", ctx.user.id);

    if (profileError) {
      throw profileError;
    }

    await auditAccountAction(ctx.admin, {
      userId: ctx.user.id,
      action: "account_recovered",
      request,
      metadata: { stripe_resume_attempted: Boolean(customerId) }
    });

    return jsonResponse({ ok: true, recovered_at: iso, stripe_resumed: Boolean(customerId) });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error(error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "could_not_recover_account"
      },
      { status: 500 }
    );
  }
});
