import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  encryptProviderCredentialSecret,
  listProviderCredentialStatuses
} from "../_shared/cloud.ts";
import type { CloudProviderCredentialWriteInput } from "../../../shared/cloud/types.ts";

function parseBody(value: unknown): CloudProviderCredentialWriteInput {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid request body.");
  }

  const record = value as Record<string, unknown>;
  const provider = record.provider;
  const apiKey = record.apiKey;

  if ((provider !== "openai" && provider !== "anthropic") || typeof apiKey !== "string") {
    throw new Error("provider and apiKey are required.");
  }

  const normalizedApiKey = apiKey.trim();

  if (normalizedApiKey.length === 0) {
    throw new Error("Enter an API key before saving.");
  }

  return {
    provider,
    apiKey: normalizedApiKey
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user, admin } = await requireUser(request);

    if (request.method === "GET") {
      const statuses = await listProviderCredentialStatuses(admin, user.id);
      return new Response(JSON.stringify(statuses), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (request.method === "POST") {
      const parsed = parseBody(await request.json());
      const encrypted = await encryptProviderCredentialSecret(parsed.apiKey);
      const { error } = await admin.from("provider_credentials").upsert(
        {
          user_id: user.id,
          provider: parsed.provider,
          encrypted_secret: encrypted.encryptedSecret,
          secret_nonce: encrypted.secretNonce,
          key_version: encrypted.keyVersion,
          last_four: encrypted.lastFour
        },
        {
          onConflict: "user_id,provider"
        }
      );

      if (error) {
        throw error;
      }

      const statuses = await listProviderCredentialStatuses(admin, user.id);
      return new Response(JSON.stringify(statuses), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (request.method === "DELETE") {
      const provider = new URL(request.url).searchParams.get("provider");

      if (provider !== "openai" && provider !== "anthropic") {
        throw new Error("A valid provider query parameter is required.");
      }

      const { error } = await admin
        .from("provider_credentials")
        .delete()
        .eq("user_id", user.id)
        .eq("provider", provider);

      if (error) {
        throw error;
      }

      const statuses = await listProviderCredentialStatuses(admin, user.id);
      return new Response(JSON.stringify(statuses), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Could not manage provider credentials."
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
