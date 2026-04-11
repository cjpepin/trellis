import { assertEntitlement, incrementUsage, requireUser } from "../_shared/auth.ts";
import {
  assertChatModelAccess,
  getChatModelProvider,
  normalizeChatModel,
  type ChatModel
} from "../_shared/chat-models.ts";
import { corsHeaders } from "../_shared/http.ts";
import { assertMaxJsonBodyBytes } from "../_shared/requestLimits.ts";
import { getChatModelMediaCapabilities } from "../../../shared/chat/capabilities.ts";
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

  const parsedMessages: ChatMessage[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const record = message as Record<string, unknown>;
    const role = record.role;
    const content = record.content;

    if (role !== "user" && role !== "assistant") {
      continue;
    }

    if (typeof content !== "string") {
      continue;
    }

    let imageParts: ChatMessage["imageParts"];

    const rawParts = record.imageParts;
    if (Array.isArray(rawParts) && rawParts.length > 0) {
      const parts: NonNullable<ChatMessage["imageParts"]> = [];

      for (const part of rawParts.slice(0, 4)) {
        if (!part || typeof part !== "object") {
          continue;
        }

        const p = part as Record<string, unknown>;
        const mimeType = p.mimeType;
        const dataBase64 = p.dataBase64;

        if (typeof mimeType !== "string" || typeof dataBase64 !== "string") {
          continue;
        }

        if (mimeType.length > 120 || dataBase64.length > 25_000_000) {
          continue;
        }

        parts.push({ mimeType, dataBase64 });
      }

      if (parts.length > 0) {
        imageParts = parts;
      }
    }

    parsedMessages.push(
      imageParts?.length ? { role, content, imageParts } : { role, content }
    );
  }

  if (parsedMessages.length === 0) {
    throw new Response("Invalid request body", {
      status: 400,
      headers: corsHeaders
    });
  }

  const parsedReferences = references.filter(
    (reference): reference is ChatReference =>
      typeof reference === "object" &&
      reference !== null &&
      (((reference as Record<string, unknown>).type === "note" &&
        typeof (reference as Record<string, unknown>).title === "string" &&
        typeof (reference as Record<string, unknown>).content === "string") ||
        ((reference as Record<string, unknown>).type === "memory" &&
          typeof (reference as Record<string, unknown>).title === "string" &&
          typeof (reference as Record<string, unknown>).content === "string")) &&
      (typeof (reference as Record<string, unknown>).slug === "string" ||
        typeof (reference as Record<string, unknown>).slug === "undefined") &&
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

function getByokHeaders(request: Request): {
  billingMode: "hosted" | "byok";
  provider: "openai" | "anthropic" | null;
  providerApiKey: string | null;
} {
  const billingMode = request.headers.get("x-trellis-billing-mode");
  const provider = request.headers.get("x-trellis-provider");
  const providerApiKey = request.headers.get("x-trellis-provider-key");

  if (billingMode !== "byok") {
    return {
      billingMode: "hosted",
      provider: null,
      providerApiKey: null
    };
  }

  return {
    billingMode: "byok",
    provider: provider === "openai" || provider === "anthropic" ? provider : null,
    providerApiKey: providerApiKey?.trim() ?? null
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  try {
    assertMaxJsonBodyBytes(request);
    const { user, profile, admin } = await requireUser(request);
    assertEntitlement(profile, "message");
    const parsed = parseBody(await request.json());
    const previewWorkspaceRequest = request.headers.get("x-trellis-preview-workspace") === "1";
    assertChatModelAccess(profile, parsed.model, { previewWorkspaceRequest });

    const mediaCaps = getChatModelMediaCapabilities(parsed.model);
    const hasVisionImages = parsed.messages.some(
      (message) => (message.imageParts?.length ?? 0) > 0
    );

    if (hasVisionImages && !mediaCaps.visionInput) {
      throw new Response(
        JSON.stringify({
          error:
            "This model does not accept images. Switch to GPT-4o Mini, GPT-4o, or a Claude model with vision."
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    const byok = getByokHeaders(request);
    const modelProvider = getChatModelProvider(parsed.model);

    if (profile.subscription_tier === "byok" && byok.billingMode !== "byok") {
      throw new Response(
        JSON.stringify({
          error: `Add your ${modelProvider === "openai" ? "OpenAI" : "Anthropic"} API key in Settings before using ${modelProvider === "openai" ? "OpenAI" : "Anthropic"} models on the BYOK plan.`
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (byok.billingMode === "byok" && profile.subscription_tier !== "byok") {
      throw new Response(
        JSON.stringify({
          error: "This account is not on the BYOK plan."
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (byok.billingMode === "byok") {
      if (!byok.provider || !byok.providerApiKey) {
        throw new Response(
          JSON.stringify({
            error: `Add your ${modelProvider === "openai" ? "OpenAI" : "Anthropic"} API key in Settings before using ${modelProvider === "openai" ? "OpenAI" : "Anthropic"} models on the BYOK plan.`
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }

      if (byok.provider !== modelProvider) {
        throw new Response(
          JSON.stringify({
            error: "The selected model does not match the configured BYOK provider."
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }
    }

    const reply = await generateChatReply(parsed.messages, parsed.model, parsed.references, {
      providerApiKey: byok.providerApiKey ?? undefined
    });

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
          tokenCount: reply.tokenCount,
          billing_mode: byok.billingMode,
          provider: modelProvider,
          model: parsed.model
        }, {
          skipCounterUpdate: byok.billingMode === "byok"
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
