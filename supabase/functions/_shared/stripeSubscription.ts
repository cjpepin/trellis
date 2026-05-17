import { getEnvironment } from "./auth.ts";

async function stripeFormRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: URLSearchParams
): Promise<Response> {
  const key = getEnvironment("STRIPE_SECRET_KEY");
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method !== "GET" && body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {})
    }
  };

  if (body && (method === "POST" || method === "DELETE")) {
    init.body = body.toString();
  }

  const normalized = path.startsWith("/") ? path.slice(1) : path;
  const url = `https://api.stripe.com/v1/${normalized}`;

  return fetch(url, init);
}

export async function listSubscriptionIdsForCustomer(customerId: string): Promise<string[]> {
  const qs = new URLSearchParams({
    customer: customerId,
    status: "all",
    limit: "100"
  });

  const response = await stripeFormRequest("GET", `subscriptions?${qs.toString()}`);

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      typeof payload?.error === "object" &&
      payload.error !== null &&
      typeof (payload.error as Record<string, unknown>).message === "string"
        ? ((payload.error as Record<string, unknown>).message as string)
        : "Stripe list subscriptions failed.";
    throw new Error(message);
  }

  const raw = payload?.data;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((subscription) =>
      subscription && typeof subscription === "object" && typeof subscription.id === "string"
        ? subscription.id
        : null
    )
    .filter((id): id is string => id !== null && id.length > 0);
}

/**
 * Pause collection so the customer is not charged while pending deletion/recovery.
 * https://stripe.com/docs/billing/subscriptions/pause-payment
 */
export async function pauseSubscriptionBilling(subscriptionId: string): Promise<void> {
  const body = new URLSearchParams({
    "pause_collection[behavior]": "void"
  });

  const response = await stripeFormRequest("POST", `subscriptions/${subscriptionId}`, body);

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      typeof payload?.error === "object" &&
      payload.error !== null &&
      typeof (payload.error as Record<string, unknown>).message === "string"
        ? ((payload.error as Record<string, unknown>).message as string)
        : "Could not pause subscription.";
    throw new Error(message);
  }
}

export async function resumeSubscriptionBilling(subscriptionId: string): Promise<void> {
  const body = new URLSearchParams({
    pause_collection: ""
  });

  const response = await stripeFormRequest("POST", `subscriptions/${subscriptionId}`, body);

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      typeof payload?.error === "object" &&
      payload.error !== null &&
      typeof (payload.error as Record<string, unknown>).message === "string"
        ? ((payload.error as Record<string, unknown>).message as string)
        : "Could not resume subscription.";
    throw new Error(message);
  }
}

/** Cancel subscription immediately (used after recovery window expires or user abandons forever). */
export async function cancelSubscriptionNow(subscriptionId: string): Promise<void> {
  const response = await stripeFormRequest("DELETE", `subscriptions/${subscriptionId}`);

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      typeof payload?.error === "object" &&
      payload.error !== null &&
      typeof (payload.error as Record<string, unknown>).message === "string"
        ? ((payload.error as Record<string, unknown>).message as string)
        : "Could not cancel subscription.";
    throw new Error(message);
  }

  void payload;
}

/** Remove Stripe customer and payment methods tied to billing. Retained analytics rows unaffected. */
export async function deleteStripeCustomer(customerId: string): Promise<void> {
  const response = await stripeFormRequest("DELETE", `customers/${customerId}`);

  if (response.ok) {
    return;
  }

  const payload = (await response.json()) as Record<string, unknown>;

  const message =
    typeof payload?.error === "object" &&
    payload.error !== null &&
    typeof (payload.error as Record<string, unknown>).message === "string"
      ? ((payload.error as Record<string, unknown>).message as string)
      : "Could not delete Stripe customer.";

  throw new Error(message);
}
