import {
  auditAccountAction,
  enforceAccountDestructiveRateLimit,
  requireUser
} from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/http.ts";
import { finalizeAccountOrphan } from "../_shared/accountClosure.ts";
import {
  assertMaxJsonBodyBytes,
  readJsonBodyWithByteLimit
} from "../_shared/requestLimits.ts";
import { verifyUserPassword } from "../_shared/passwordVerify.ts";

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

    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    const password = typeof record.password === "string" ? record.password : "";
    const emailConfirmation =
      typeof record.email_confirmation === "string" ? record.email_confirmation.trim().toLowerCase() : "";
    const confirmed = record.confirm_abandon === true;

    if (!password || !emailConfirmation || !confirmed) {
      return jsonResponse({ error: "missing_or_invalid_fields" }, 400);
    }

    const ctx = await requireUser(request, { allowDeleted: true });

    if (!ctx.profile.deleted_at) {
      return jsonResponse({ error: "not_pending_deletion" }, 400);
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

    const passwordOk = await verifyUserPassword(password, ctx.user);
    if (!passwordOk) {
      return jsonResponse({ error: "invalid_password" }, 401);
    }

    await finalizeAccountOrphan(ctx.admin, ctx.user.id, ctx.profile.stripe_customer_id ?? null);

    await auditAccountAction(ctx.admin, {
      userId: ctx.user.id,
      action: "account_abandon_confirmed",
      request,
      metadata: { path: "manual" }
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error(error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "could_not_finalize_account"
      },
      { status: 500 }
    );
  }
});
