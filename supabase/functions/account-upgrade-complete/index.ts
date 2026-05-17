import { FREE_ACCOUNT_MESSAGE_LIMIT } from "../../../shared/billing/freeTier.ts";
import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/http.ts";

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
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const { user, profile, admin } = await requireUser(request);

    if (!user.email) {
      return jsonResponse({ ok: true });
    }

    const shouldResetUsage = (profile.email ?? "").trim().length === 0;

    const { error } = await admin
      .from("profiles")
      .update({
        email: user.email,
        ...(shouldResetUsage
          ? {
              messages_used: 0,
              trial_message_window_started_at: null,
              message_limit: FREE_ACCOUNT_MESSAGE_LIMIT
            }
          : {})
      })
      .eq("id", user.id);

    if (error) {
      throw error;
    }

    return jsonResponse({ ok: true, usage_reset: shouldResetUsage });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Could not finalize the account upgrade."
      },
      500
    );
  }
});
