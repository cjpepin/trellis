import { getAdminClient, getEnvironment } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/http.ts";

const stripeTimestampToleranceSeconds = 300;

function parseStripeSignatureHeader(header: string): { timestamp: string; signatures: string[] } {
  const pairs = header.split(",").map((entry) => entry.trim());
  const timestamp = pairs.find((entry) => entry.startsWith("t="))?.slice(2) ?? "";
  const signatures = pairs
    .filter((entry) => entry.startsWith("v1="))
    .map((entry) => entry.slice(3))
    .filter((entry) => entry.length > 0);

  if (!timestamp || signatures.length === 0) {
    throw new Error("Missing Stripe signature values.");
  }

  return { timestamp, signatures };
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;

  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function computeStripeSignature(payload: string, timestamp: string): Promise<string> {
  const secret = getEnvironment("STRIPE_WEBHOOK_SECRET");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`)
  );

  return toHex(new Uint8Array(signature));
}

async function verifyStripeWebhook(request: Request, rawBody: string): Promise<void> {
  const signatureHeader = request.headers.get("stripe-signature");

  if (!signatureHeader) {
    throw new Response("Missing Stripe signature.", {
      status: 401,
      headers: corsHeaders
    });
  }

  let timestamp = "";
  let signatures: string[] = [];

  try {
    ({ timestamp, signatures } = parseStripeSignatureHeader(signatureHeader));
  } catch {
    throw new Response("Invalid Stripe signature.", {
      status: 401,
      headers: corsHeaders
    });
  }

  const timestampSeconds = Number(timestamp);

  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > stripeTimestampToleranceSeconds
  ) {
    throw new Response("Expired Stripe signature.", {
      status: 401,
      headers: corsHeaders
    });
  }

  const expectedSignature = await computeStripeSignature(rawBody, timestamp);
  const isValid = signatures.some((signature) => timingSafeEqual(signature, expectedSignature));

  if (!isValid) {
    throw new Response("Invalid Stripe signature.", {
      status: 401,
      headers: corsHeaders
    });
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  try {
    const rawBody = await request.text();
    await verifyStripeWebhook(request, rawBody);
    const event = JSON.parse(rawBody) as Record<string, unknown>;
    const data = event.data;
    const object =
      data && typeof data === "object" && "object" in data
        ? (data.object as Record<string, unknown>)
        : null;
    const metadata =
      object?.metadata && typeof object.metadata === "object"
        ? (object.metadata as Record<string, unknown>)
        : null;
    const type = typeof event.type === "string" ? event.type : null;
    const userId = typeof metadata?.user_id === "string" ? metadata.user_id : null;

    if (!type || !userId) {
      return new Response("Ignored", { status: 202 });
    }

    const admin = getAdminClient();

    if (type === "checkout.session.completed" || type === "customer.subscription.updated") {
      const { error } = await admin
        .from("profiles")
        .update({
          subscription_tier: "pro",
          subscription_status: "active",
          stripe_customer_id: object?.customer ?? null,
          updated_at: new Date().toISOString()
        })
        .eq("id", userId);

      if (error) {
        throw error;
      }
    }

    if (type === "customer.subscription.deleted") {
      const { error } = await admin
        .from("profiles")
        .update({
          subscription_tier: "trial",
          subscription_status: "expired",
          updated_at: new Date().toISOString()
        })
        .eq("id", userId);

      if (error) {
        throw error;
      }
    }

    return new Response("ok", {
      headers: corsHeaders
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown Stripe webhook failure"
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
