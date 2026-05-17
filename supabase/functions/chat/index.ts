import { assertEntitlement, incrementUsage, requireUser } from "../_shared/auth.ts";
import {
  assertChatModelAccess,
  getChatModelProvider,
  normalizeChatModel,
  type ChatModel
} from "../_shared/chat-models.ts";
import { corsHeaders } from "../_shared/http.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";
import { getChatModelMediaCapabilities } from "../../../shared/chat/capabilities.ts";
import {
  streamChatReply,
  type ChatMessage,
  type ChatReference
} from "../_shared/models.ts";
import { deriveSessionTitle } from "../../../shared/chat/deriveSessionTitle.ts";
import { getStoredProviderCredentialSecret } from "../_shared/cloud.ts";

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
  previewWorkspace: boolean;
} {
  if (!body || typeof body !== "object") {
    throw new Response("Invalid request body", {
      status: 400,
      headers: corsHeaders
    });
  }

  const record = body as Record<string, unknown>;
  const messages = record.messages;
  const sessionId = record.sessionId;
  const model = record.model;
  const references = record.references;
  const previewWorkspace = record.previewWorkspace === true;
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
      typeof (reference as Record<string, unknown>).content === "string" &&
      (typeof (reference as Record<string, unknown>).tags === "undefined" ||
        (Array.isArray((reference as Record<string, unknown>).tags) &&
          ((reference as Record<string, unknown>).tags as unknown[]).every(
            (tag) => typeof tag === "string"
          )))
  );

  return {
    messages: parsedMessages,
    sessionId,
    model: normalizedModel,
    references: parsedReferences,
    previewWorkspace
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

async function resolveByokProviderApiKey(input: {
  admin: Awaited<ReturnType<typeof requireUser>>["admin"];
  request: Request;
  userId: string;
  modelProvider: "openai" | "anthropic";
}): Promise<{
  billingMode: "hosted" | "byok";
  provider: "openai" | "anthropic" | null;
  providerApiKey: string | null;
}> {
  const byok = getByokHeaders(input.request);

  if (byok.billingMode !== "byok") {
    return byok;
  }

  if (byok.provider && byok.provider !== input.modelProvider) {
    return byok;
  }

  if (byok.providerApiKey) {
    return byok;
  }

  return {
    billingMode: "byok",
    provider: input.modelProvider,
    providerApiKey: await getStoredProviderCredentialSecret(
      input.admin,
      input.userId,
      input.modelProvider
    )
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
    const parsed = parseBody(await readJsonBodyWithByteLimit(request));
    const previewWorkspaceRequest =
      request.headers.get("x-trellis-preview-workspace") === "1" || parsed.previewWorkspace;
    assertEntitlement(profile, "message", {
      isAnonymousUser: user.is_anonymous === true
    });
    assertChatModelAccess(profile, parsed.model);

    const mediaCaps = getChatModelMediaCapabilities(parsed.model);
    const hasVisionImages = parsed.messages.some(
      (message) => (message.imageParts?.length ?? 0) > 0
    );

    if (hasVisionImages && !mediaCaps.visionInput) {
      throw new Response(
        JSON.stringify({
          error:
            "This model does not accept images. Switch to a vision-capable model (for example GPT-4o Mini, GPT-5.4 Mini, GPT-5.4, or a recent Claude model)."
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

    const modelProvider = getChatModelProvider(parsed.model);
    const byok = await resolveByokProviderApiKey({
      admin,
      request,
      userId: user.id,
      modelProvider
    });

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

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(sseEvent("status", "Thinking"));
        let fullText = "";

        try {
          for await (const piece of streamChatReply(parsed.messages, parsed.model, parsed.references, {
            providerApiKey: byok.providerApiKey ?? undefined
          })) {
            fullText += piece;
            controller.enqueue(sseEvent("token", piece));
          }
        } catch (streamError) {
          controller.error(streamError);
          return;
        }

        if (fullText.trim().length === 0) {
          controller.error(new Error("The model returned an empty response."));
          return;
        }

        const sessionTitle = deriveSessionTitle(parsed.messages, { assistantReply: fullText });
        const tokenCount = Math.ceil(fullText.length / 4);
        controller.enqueue(sseEvent("title", sessionTitle));

        await incrementUsage(admin, user.id, "message", 1, {
          sessionId: parsed.sessionId,
          tokenCount,
          billing_mode: byok.billingMode,
          provider: modelProvider,
          model: parsed.model,
          ...(previewWorkspaceRequest && profile.is_admin === true ? { preview_workspace: true } : {})
        }, {
          skipCounterUpdate:
            byok.billingMode === "byok" ||
            (previewWorkspaceRequest && profile.is_admin === true)
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
