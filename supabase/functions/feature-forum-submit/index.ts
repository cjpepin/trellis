import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/http.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";

const TITLE_MAX = 140;
const BODY_MAX = 4_000;
const COOLDOWN_MS = 10 * 60 * 1000;
const DAILY_LIMIT = 3;

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
    assertMaxJsonBodyBytes(request);
    const { user, admin } = await requireUser(request);

    if (user.is_anonymous === true) {
      return jsonResponse(
        {
          error: "Create a full account before submitting feature requests."
        },
        403
      );
    }

    const body = (await readJsonBodyWithByteLimit(request)) as Record<string, unknown> | null;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const postBody = typeof body?.body === "string" ? body.body.trim() : "";

    if (title.length < 4 || postBody.length < 12) {
      return jsonResponse(
        { error: "Add a clear title and a short explanation before submitting." },
        400
      );
    }

    if (title.length > TITLE_MAX || postBody.length > BODY_MAX) {
      return jsonResponse(
        { error: "Feature posts are too long for this first version." },
        400
      );
    }

    const { data: recentPosts, error: recentError } = await admin
      .from("feature_posts")
      .select("created_at")
      .eq("author_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(DAILY_LIMIT);

    if (recentError) {
      throw recentError;
    }

    const nowMs = Date.now();
    const posts = recentPosts ?? [];
    const mostRecent = posts[0]?.created_at ? Date.parse(posts[0].created_at as string) : null;
    if (mostRecent !== null && Number.isFinite(mostRecent) && nowMs - mostRecent < COOLDOWN_MS) {
      return jsonResponse(
        { error: "Please wait a few minutes before posting another feature idea." },
        429
      );
    }

    const recentCount = posts.filter((row) => {
      const createdAt = typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
      return Number.isFinite(createdAt) && nowMs - createdAt < 24 * 60 * 60 * 1000;
    }).length;

    if (recentCount >= DAILY_LIMIT) {
      return jsonResponse(
        { error: "You have reached the daily feature-post limit. Try again tomorrow." },
        429
      );
    }

    const { data: inserted, error: insertError } = await admin
      .from("feature_posts")
      .insert({
        author_user_id: user.id,
        title,
        body: postBody,
        status: "pending"
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      throw insertError ?? new Error("Could not submit that feature post.");
    }

    return jsonResponse({ post: inserted });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown forum submission failure." },
      500
    );
  }
});
