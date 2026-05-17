import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  ensureDefaultWorkspace,
  resolveExtractionProviderApiKey,
  safeJsonObject
} from "../_shared/cloud.ts";
import { extractionRetryThoroughSuffix } from "../_shared/prompts.ts";
import {
  getChatModelProvider,
  normalizeChatModel,
  type ChatModel
} from "../_shared/chat-models.ts";
import { buildExtractionUserMessage } from "../../../shared/extraction/buildPrompt.ts";
import type { ExtractionIndexEntry } from "../../../shared/extraction/contracts.ts";
import { parseExtractionResponseJson } from "../../../shared/extraction/validate.ts";
import type { CloudSessionExtractionResponse } from "../../../shared/cloud/types.ts";
import {
  extractAnthropicJson,
  extractOpenAiJson
} from "../_shared/cloudExtractionLlm.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";

function tagsFromFrontmatter(raw: Record<string, unknown> | null): string[] {
  const tags = raw?.tags;
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags.filter((tag): tag is string => typeof tag === "string");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders
      });
    }

    const { user, admin } = await requireUser(request);
    assertMaxJsonBodyBytes(request);
    const rawBody = await readJsonBodyWithByteLimit(request);
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const retryThorough = body.retryThorough === true;

    if (!workspaceId || !sessionId) {
      throw new Error("workspaceId and sessionId are required.");
    }

    const workspaces = await ensureDefaultWorkspace(admin, user.id);
    assertWorkspaceAccess(workspaces, workspaceId);

    const { data: sessionRow, error: sessionError } = await admin
      .from("chat_sessions")
      .select("id, workspace_id, model")
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (sessionError || !sessionRow) {
      throw sessionError ?? new Error("That chat session could not be found.");
    }

    const { data: messageRows, error: messagesError } = await admin
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      throw messagesError;
    }

    const transcript = (messageRows ?? [])
      .map((row) => {
        const r = row as { role: string; content: string };
        if (r.role !== "user" && r.role !== "assistant") {
          return null;
        }
        return { role: r.role, content: r.content };
      })
      .filter((m): m is { role: "user" | "assistant"; content: string } => m !== null);

    if (transcript.length === 0) {
      throw new Error("No messages in that session yet.");
    }

    const { data: noteRows, error: notesError } = await admin
      .from("notes")
      .select("slug, title, folder_path, frontmatter_json")
      .eq("workspace_id", workspaceId);

    if (notesError) {
      throw notesError;
    }

    const index: ExtractionIndexEntry[] = (noteRows ?? []).map((row) => {
      const r = row as {
        slug: string;
        title: string;
        folder_path: string;
        frontmatter_json: Record<string, unknown> | null;
      };
      return {
        slug: r.slug,
        title: r.title,
        tags: tagsFromFrontmatter(safeJsonObject(r.frontmatter_json)),
        folderPath: r.folder_path ?? "",
        isPlaceholder: false
      };
    });

    const sessionModelRaw = (sessionRow as { model: string }).model;
    const sessionModel: ChatModel = normalizeChatModel(sessionModelRaw) ?? "gpt-4.1-mini";
    const provider = getChatModelProvider(sessionModel);
    const apiKey = await resolveExtractionProviderApiKey(admin, user.id, provider);

    if (!apiKey) {
      throw new Error(
        provider === "openai"
          ? "No OpenAI key for cloud extraction. Add a BYOK key in Settings or set OPENAI_API_KEY on the chat-session-extract function."
          : "No Anthropic key for cloud extraction. Add a BYOK key in Settings or set ANTHROPIC_API_KEY on the chat-session-extract function."
      );
    }

    let userMessage =
      buildExtractionUserMessage(
        {
          transcript,
          index,
          sessionPriorNoteSlugs: [],
          relatedNotes: []
        },
        { maxCorpusChars: 40_000 }
      ) + (retryThorough ? extractionRetryThoroughSuffix : "");

    let rawJson =
      provider === "openai"
        ? await extractOpenAiJson(apiKey, userMessage)
        : await extractAnthropicJson(apiKey, userMessage);

    let parsed = parseExtractionResponseJson(rawJson, { index });

    if (
      retryThorough === false &&
      parsed.value &&
      parsed.value.updates.every((u) => u.operation === "noop")
    ) {
      userMessage =
        buildExtractionUserMessage(
          {
            transcript,
            index,
            sessionPriorNoteSlugs: [],
            relatedNotes: []
          },
          { maxCorpusChars: 40_000 }
        ) + extractionRetryThoroughSuffix;
      rawJson =
        provider === "openai"
          ? await extractOpenAiJson(apiKey, userMessage)
          : await extractAnthropicJson(apiKey, userMessage);
      parsed = parseExtractionResponseJson(rawJson, { index });
    }

    if (!parsed.value) {
      const first = parsed.issues[0]?.message ?? "Cloud extraction returned an invalid payload.";
      throw new Error(first);
    }

    const response: CloudSessionExtractionResponse = {
      sessionTitle: parsed.value.sessionTitle,
      extraction: parsed.value
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Cloud session extraction failed."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
