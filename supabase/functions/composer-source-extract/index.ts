import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  ensureDefaultWorkspace,
  resolveExtractionProviderApiKey,
  safeJsonObject
} from "../_shared/cloud.ts";
import {
  extractAnthropicJson,
  extractOpenAiJson
} from "../_shared/cloudExtractionLlm.ts";
import {
  getChatModelProvider,
  normalizeChatModel,
  type ChatModel
} from "../_shared/chat-models.ts";
import { buildExtractionUserMessage } from "../../../shared/extraction/buildPrompt.ts";
import type {
  ExtractionContextNote,
  ExtractionIndexEntry,
  ExtractionSourceType
} from "../../../shared/extraction/contracts.ts";
import { parseExtractionResponseJson } from "../../../shared/extraction/validate.ts";
import type { CloudSessionExtractionResponse } from "../../../shared/cloud/types.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";

function tagsFromFrontmatter(raw: Record<string, unknown> | null): string[] {
  const tags = raw?.tags;
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags.filter((tag): tag is string => typeof tag === "string");
}

function parseRelatedNotes(raw: unknown): ExtractionContextNote[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ExtractionContextNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const r = item as Record<string, unknown>;
    const slug = typeof r.slug === "string" ? r.slug : "";
    if (!slug) {
      continue;
    }
    out.push({
      slug,
      title: typeof r.title === "string" ? r.title : slug,
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
      headingPath: typeof r.headingPath === "string" ? r.headingPath : "",
      content: typeof r.content === "string" ? r.content : "",
      score: typeof r.score === "number" && Number.isFinite(r.score) ? r.score : 0,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined,
      isExplicitMatch: r.isExplicitMatch === true
    });
  }
  return out;
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
    const chatModelRaw = typeof body.chatModel === "string" ? body.chatModel : "";
    const sourceTypeRaw = typeof body.sourceType === "string" ? body.sourceType : "";
    const sourceTitle = typeof body.sourceTitle === "string" ? body.sourceTitle : "Source";
    const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
    const sourceContent = typeof body.sourceContent === "string" ? body.sourceContent : "";

    if (!workspaceId || sourceContent.trim().length === 0) {
      throw new Error("workspaceId and sourceContent are required.");
    }

    if (sourceTypeRaw !== "pdf" && sourceTypeRaw !== "web" && sourceTypeRaw !== "text") {
      throw new Error("sourceType must be pdf, web, or text.");
    }

    const sourceType = sourceTypeRaw as ExtractionSourceType;
    const relatedNotes = parseRelatedNotes(body.relatedNotes);

    const workspaces = await ensureDefaultWorkspace(admin, user.id);
    assertWorkspaceAccess(workspaces, workspaceId);

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

    const sessionModel: ChatModel = normalizeChatModel(chatModelRaw) ?? "gpt-4.1-mini";
    const provider = getChatModelProvider(sessionModel);
    const apiKey = await resolveExtractionProviderApiKey(admin, user.id, provider);

    if (!apiKey) {
      throw new Error(
        provider === "openai"
          ? "No OpenAI key for cloud extraction. Add a BYOK key in Settings or set OPENAI_API_KEY on the composer-source-extract function."
          : "No Anthropic key for cloud extraction. Add a BYOK key in Settings or set ANTHROPIC_API_KEY on the composer-source-extract function."
      );
    }

    const userMessage = buildExtractionUserMessage(
      {
        transcript: [{ role: "user", content: sourceContent }],
        index,
        relatedNotes,
        sessionPriorNoteSlugs: [],
        sourceType,
        sourceTitle,
        sourcePath,
        sourceContent
      },
      { maxCorpusChars: 40_000 }
    );

    const rawJson =
      provider === "openai"
        ? await extractOpenAiJson(apiKey, userMessage)
        : await extractAnthropicJson(apiKey, userMessage);

    const parsed = parseExtractionResponseJson(rawJson, { index });

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
        error: error instanceof Error ? error.message : "Composer source extraction failed."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
