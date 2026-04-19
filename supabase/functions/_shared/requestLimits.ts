import { corsHeaders } from "./http.ts";

/** Upper bound for JSON POST bodies to Edge Functions (chat, extract, media). */
const maxJsonBodyBytes = 32 * 1024 * 1024;

/**
 * Rejects oversized requests when Content-Length is present.
 * Chunked bodies may omit Content-Length; pair with {@link readJsonBodyWithByteLimit}.
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

function bodyTooLargeResponse(): Response {
  return new Response(
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

/**
 * Reads and parses JSON from the request body while enforcing a max byte size on the wire
 * (including chunked transfer without Content-Length).
 */
export async function readJsonBodyWithByteLimit(request: Request): Promise<unknown> {
  const stream = request.body;
  if (!stream) {
    throw new Response(JSON.stringify({ error: "missing_body" }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value && value.byteLength > 0) {
        total += value.byteLength;
        if (total > maxJsonBodyBytes) {
          throw bodyTooLargeResponse();
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }

  const text = new TextDecoder().decode(buf);
  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
}
