import { corsHeaders } from "./http.ts";

/** Upper bound for JSON POST bodies to Edge Functions (chat, extract, media). */
const maxJsonBodyBytes = 32 * 1024 * 1024;

/**
 * Rejects oversized requests when Content-Length is present.
 * Does not protect against chunked bodies with omitted length; callers still stream-parse carefully.
 */
export function assertMaxJsonBodyBytes(request: Request): void {
  const raw = request.headers.get("content-length");

  if (!raw) {
    return;
  }

  const size = Number(raw);

  if (!Number.isFinite(size) || size < 0) {
    return;
  }

  if (size > maxJsonBodyBytes) {
    throw new Response(
      JSON.stringify({ error: "request_body_too_large" }),
      {
        status: 413,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }
}
