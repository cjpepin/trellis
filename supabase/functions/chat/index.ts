import { assertEntitlement, incrementUsage, requireUser } from "../_shared/auth.ts";
import {
  assertChatModelAccess,
  normalizeChatModel,
  type ChatModel
} from "../_shared/chat-models.ts";
import { corsHeaders } from "../_shared/http.ts";
import {
  generateChatReply,
  type ChatMessage,
  type ChatReference
} from "../_shared/models.ts";

const encoder = new TextEncoder();

function sseEvent(event: string, data: string): Uint8Array {
  const payload =
    data.length > 0
      ? data.split(/\r?\n/).map((line) => `data: ${line}`).join("\n")
      : "data:";

  return encoder.encode(`event: ${event}\n${payload}\n\n`);
}

function parseBody(body: unknown): {
  messages: ChatMessage[];
  sessionId: string;
  model: ChatModel;
  references: ChatReference[];
} {
  if (!body || typeof body !== "object") {
    throw new Response("Invalid request body", {
      status: 400,
      headers: corsHeaders
    });
  }

  const messages = (body as Record<string, unknown>).messages;
  const sessionId = (body as Record<string, unknown>).sessionId;
  const model = (body as Record<string, unknown>).model;
  const references = (body as Record<string, unknown>).references;
  const normalizedModel = typeof model === "string" ? normalizeChatModel(model) : null;

  if (
    !Array.isArray(messages) ||
    typeof sessionId !== "string" ||
    !Array.isArray(references) ||
    !normalizedModel
  ) {
    throw new Response("Invalid request body", {
      status: 400,
      headers: corsHeaders
    });
  }

  const parsedMessages = messages.filter(
    (message): message is ChatMessage =>
      typeof message === "object" &&
      message !== null &&
      ((message as Record<string, unknown>).role === "user" ||
        (message as Record<string, unknown>).role === "assistant") &&
      typeof (message as Record<string, unknown>).content === "string"
  );

  const parsedReferences = references.filter(
    (reference): reference is ChatReference =>
      typeof reference === "object" &&
      reference !== null &&
      typeof (reference as Record<string, unknown>).slug === "string" &&
      typeof (reference as Record<string, unknown>).title === "string" &&
      typeof (reference as Record<string, unknown>).excerpt === "string" &&
      typeof (reference as Record<string, unknown>).content === "string"
  );

  return {
    messages: parsedMessages,
    sessionId,
    model: normalizedModel,
    references: parsedReferences
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  try {
    const { user, profile, admin } = await requireUser(request);
    assertEntitlement(profile, "message");
    const parsed = parseBody(await request.json());
    assertChatModelAccess(profile, parsed.model);
    const reply = await generateChatReply(parsed.messages, parsed.model, parsed.references);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(sseEvent("status", "Thinking"));
        controller.enqueue(sseEvent("title", reply.sessionTitle));

        for (const token of reply.text.split(/(\s+)/)) {
          if (token.length === 0) {
            continue;
          }

          controller.enqueue(sseEvent("token", token));
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        await incrementUsage(admin, user.id, "message", 1, {
          sessionId: parsed.sessionId,
          tokenCount: reply.tokenCount
        });
        controller.enqueue(sseEvent("done", "ok"));
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
        error: error instanceof Error ? error.message : "Unknown chat failure"
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
