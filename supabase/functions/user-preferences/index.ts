import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { getUserPreferences, upsertUserPreferences } from "../_shared/cloud.ts";
import type { CloudPatchUserPreferencesInput } from "../../../shared/cloud/types.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user, admin } = await requireUser(request);

    if (request.method === "GET") {
      const prefs = await getUserPreferences(admin, user.id);
      return new Response(JSON.stringify(prefs), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (request.method !== "PATCH" && request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders
      });
    }

    const body = (await request.json()) as CloudPatchUserPreferencesInput;
    const prefs = await upsertUserPreferences(admin, user.id, {
      ...(body.theme !== undefined ? { theme: body.theme } : {}),
      ...(body.activeWorkspaceId !== undefined
        ? { activeWorkspaceId: body.activeWorkspaceId }
        : {}),
      ...(body.chat !== undefined ? { chat: body.chat } : {}),
      ...(body.platform !== undefined ? { platform: body.platform } : {})
    });

    return new Response(JSON.stringify(prefs), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Could not update preferences."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
