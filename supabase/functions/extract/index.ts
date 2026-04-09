import { assertEntitlement, incrementUsage, requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/http.ts";
import { extractKnowledge, type ChatMessage } from "../_shared/models.ts";
import type { ExtractionContextNote } from "../../../shared/extraction/contracts.ts";

const encoder = new TextEncoder();

function sseEvent(event: string, payload: unknown): Uint8Array {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  return encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
}

function parseRequest(body: unknown): {
  stream: boolean;
  transcript: ChatMessage[];
  index: Array<{ slug: string; title: string; tags: string[]; isPlaceholder?: boolean }>;
  relatedNotes: ExtractionContextNote[];
  sessionId?: string;
  sourceType?: "pdf" | "web" | "text";
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
} {
  if (!body || typeof body !== "object") {
    throw new Response("Invalid request body", {
      status: 400,
      headers: corsHeaders
    });
  }

  const input = body as Record<string, unknown>;

  return {
    stream: input.stream === true,
    sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
    transcript: Array.isArray(input.transcript)
      ? input.transcript.filter(
          (message): message is ChatMessage =>
            typeof message === "object" &&
            message !== null &&
            ((message as Record<string, unknown>).role === "user" ||
              (message as Record<string, unknown>).role === "assistant") &&
            typeof (message as Record<string, unknown>).content === "string"
        )
      : [],
    index: Array.isArray(input.index)
      ? input.index.filter(
          (
            note
          ): note is { slug: string; title: string; tags: string[]; isPlaceholder?: boolean } =>
            typeof note === "object" &&
            note !== null &&
            typeof (note as Record<string, unknown>).slug === "string" &&
            typeof (note as Record<string, unknown>).title === "string" &&
            Array.isArray((note as Record<string, unknown>).tags)
        )
          .map((note) => ({
            slug: note.slug,
            title: note.title,
            tags: note.tags,
            isPlaceholder: note.isPlaceholder === true
          }))
      : [],
    relatedNotes: Array.isArray(input.relatedNotes)
      ? input.relatedNotes.filter(
          (note): note is ExtractionContextNote =>
            typeof note === "object" &&
            note !== null &&
            typeof (note as Record<string, unknown>).slug === "string" &&
            typeof (note as Record<string, unknown>).title === "string" &&
            Array.isArray((note as Record<string, unknown>).tags) &&
            typeof (note as Record<string, unknown>).headingPath === "string" &&
            typeof (note as Record<string, unknown>).content === "string" &&
            typeof (note as Record<string, unknown>).score === "number"
        )
      : [],
    sourceType:
      input.sourceType === "pdf" || input.sourceType === "web" || input.sourceType === "text"
        ? input.sourceType
        : undefined,
    sourceTitle: typeof input.sourceTitle === "string" ? input.sourceTitle : undefined,
    sourcePath: typeof input.sourcePath === "string" ? input.sourcePath : undefined,
    sourceContent: typeof input.sourceContent === "string" ? input.sourceContent : undefined
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  try {
    const parsed = parseRequest(await request.json());
    const { user, profile, admin } = await requireUser(request);

    if (parsed.sourceType) {
      assertEntitlement(profile, "ingest");
    }

    const result = await extractKnowledge({
      transcript: parsed.transcript,
      index: parsed.index,
      relatedNotes: parsed.relatedNotes,
      sourceType: parsed.sourceType,
      sourceTitle: parsed.sourceTitle,
      sourcePath: parsed.sourcePath,
      sourceContent: parsed.sourceContent
    });

    if (!parsed.stream) {
      if (parsed.sourceType) {
        await incrementUsage(admin, user.id, "ingest", 1, {
          sourceType: parsed.sourceType,
          sourceTitle: parsed.sourceTitle ?? null
        });
      }

      return new Response(JSON.stringify(result), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          sseEvent("status", {
            step: "reading",
            message: "Reading source…"
          })
        );
        await new Promise((resolve) => setTimeout(resolve, 120));
        controller.enqueue(
          sseEvent("status", {
            step: "extracting",
            message: "Extracting concepts…"
          })
        );
        await new Promise((resolve) => setTimeout(resolve, 120));
        controller.enqueue(
          sseEvent("status", {
            step: "updating",
            message: `Updating ${result.updates.length} notes…`
          })
        );

        if (parsed.sourceType) {
          await incrementUsage(admin, user.id, "ingest", 1, {
            sourceType: parsed.sourceType,
            sourceTitle: parsed.sourceTitle ?? null
          });
        }

        controller.enqueue(sseEvent("done", result));
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown extraction failure"
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
