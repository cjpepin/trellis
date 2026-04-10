import { corsHeaders } from "../_shared/http.ts";
import { getEnvironment, requireUser } from "../_shared/auth.ts";

function parsePlan(body: unknown): "byok" | "pro" {
  if (!body || typeof body !== "object") {
    throw new Response("Invalid request body", {
      status: 400,
      headers: corsHeaders
    });
  }

  const plan = (body as Record<string, unknown>).plan;

  if (plan === "byok" || plan === "pro") {
    return plan;
  }

  throw new Response("Invalid request body", {
    status: 400,
    headers: corsHeaders
  });
}

function getStripePriceId(plan: "byok" | "pro"): string {
  return getEnvironment(plan === "byok" ? "STRIPE_PRICE_BYOK_ID" : "STRIPE_PRICE_PRO_ID");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  try {
    const plan = parsePlan(await request.json());
    const { user, profile } = await requireUser(request);
    const params = new URLSearchParams();

    params.set("mode", "subscription");
    params.set("success_url", getEnvironment("STRIPE_CHECKOUT_SUCCESS_URL"));
    params.set("cancel_url", getEnvironment("STRIPE_CHECKOUT_CANCEL_URL"));
    params.set("line_items[0][price]", getStripePriceId(plan));
    params.set("line_items[0][quantity]", "1");
    params.set("allow_promotion_codes", "true");
    params.set("metadata[user_id]", user.id);
    params.set("metadata[plan_code]", plan);
    params.set("subscription_data[metadata][user_id]", user.id);
    params.set("subscription_data[metadata][plan_code]", plan);

    if (profile.stripe_customer_id) {
      params.set("customer", profile.stripe_customer_id);
    } else if (user.email) {
      params.set("customer_email", user.email);
    }

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getEnvironment("STRIPE_SECRET_KEY")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    const payload = await response.json();

    if (!response.ok || typeof payload?.url !== "string") {
      const message =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : "Could not create a checkout session.";

      throw new Response(
        JSON.stringify({
          error: message
        }),
        {
          status: response.status || 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        url: payload.url
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown checkout failure"
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }
});
