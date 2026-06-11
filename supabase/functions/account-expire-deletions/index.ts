import { getEnvironment, getAdminClient, auditAccountAction } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/http.ts";
import { finalizeAccountOrphan } from "../_shared/accountClosure.ts";

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
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    let secretEnv: string;

    try {
      secretEnv = getEnvironment("ACCOUNT_EXPIRE_CRON_SECRET");
    } catch {
      secretEnv = getEnvironment("CRON_SECRET");
    }

    const header = request.headers.get("x-cron-secret");
    const auth = request.headers.get("authorization");

    const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    const provided = header ?? bearer;

    if (provided !== secretEnv || secretEnv.trim().length < 16) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const admin = getAdminClient();
    const cutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: candidates, error: selectError } = await admin
      .from("profiles")
      .select("id,stripe_customer_id,email,deleted_at")
      .not("deleted_at", "is", null)
      .lte("deleted_at", cutoffIso)
      .limit(200);

    if (selectError) {
      throw selectError;
    }

    const processed: string[] = [];
    const errors: Record<string, string> = {};

    for (const row of candidates ?? []) {
      const id = typeof row.id === "string" ? row.id : null;
      if (!id) {
        continue;
      }

      const email = typeof row.email === "string" ? row.email : "";
      if (email.startsWith("deleted.") && email.endsWith("@disabled.invalid")) {
        continue;
      }

      try {
        await finalizeAccountOrphan(
          admin,
          id,
          typeof row.stripe_customer_id === "string" ? row.stripe_customer_id : null
        );

        processed.push(id);

        await auditAccountAction(admin, {
          userId: id,
          action: "account_expiry_cron_finalized",
          request,
          metadata: { source: "cron" }
        });
      } catch (error) {
        errors[id] = error instanceof Error ? error.message : String(error);
      }
    }

    return jsonResponse({ ok: true, processed, error_count: Object.keys(errors).length, errors });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : "cron_failed" }, 500);
  }
});
