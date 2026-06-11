import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  ensureDefaultWorkspace,
  safeJsonObject
} from "../_shared/cloud.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";
import { runProposeNoteActionsCore } from "../../../shared/chat/proposeNoteActionsCore.ts";
import type { ExtractionNoteType } from "../../../shared/extraction/contracts.ts";

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
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    const { user, admin } = await requireUser(request);
    const workspaces = await ensureDefaultWorkspace(admin, user.id);
    assertMaxJsonBodyBytes(request);
    const raw = await readJsonBodyWithByteLimit(request);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const mode: "auto" | "off" | "local" | null =
      body.mode === "off" || body.mode === "local" || body.mode === "auto" ? body.mode : null;
    const phase =
      body.phase === "post_response" || body.phase === "pre_response" ? body.phase : "pre_response";
    const activeNoteSlug =
      typeof body.activeNoteSlug === "string"
        ? body.activeNoteSlug
        : body.activeNoteSlug === null
          ? null
          : null;
    const pinnedNoteSlugs = Array.isArray(body.pinnedNoteSlugs)
      ? (body.pinnedNoteSlugs as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    const messagesRaw = body.messages;

    if (!workspaceId || !mode || !Array.isArray(messagesRaw)) {
      throw new Error("workspaceId, mode, and messages are required.");
    }

    const workspace = assertWorkspaceAccess(workspaces, workspaceId);

    if (mode === "off") {
      return new Response(JSON.stringify({ actions: [], clarification: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const messages = (messagesRaw as unknown[])
      .map((m) => {
        if (!m || typeof m !== "object") {
          return null;
        }
        const r = m as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : "";
        const role = r.role === "user" || r.role === "assistant" ? r.role : null;
        const content = typeof r.content === "string" ? r.content : "";
        if (!id || !role) {
          return null;
        }
        return { id, role, content };
      })
      .filter((m): m is { id: string; role: "user" | "assistant"; content: string } => m !== null);

    if (messages.length === 0) {
      throw new Error("messages must include at least one valid entry.");
    }

    const { data: noteRows, error: notesError } = await admin
      .from("notes")
      .select("slug")
      .eq("workspace_id", workspace.id);

    if (notesError) {
      throw notesError;
    }

    const noteIndex = (noteRows ?? []).map((row) => ({ slug: (row as { slug: string }).slug }));

    const core = await runProposeNoteActionsCore({
      phase,
      messages,
      pinnedNoteSlugs,
      activeNoteSlug,
      noteIndex,
      loadNoteBySlug: async (slug) => {
        const { data: row, error } = await admin
          .from("notes")
          .select("slug, title, markdown_body, frontmatter_json, note_type, folder_path, source_count")
          .eq("workspace_id", workspace.id)
          .eq("slug", slug)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (!row) {
          return null;
        }

        const n = row as {
          slug: string;
          title: string;
          markdown_body: string;
          frontmatter_json: Record<string, unknown> | null;
          note_type: ExtractionNoteType;
          folder_path: string | null;
          source_count: number | null;
        };

        const fm = safeJsonObject(n.frontmatter_json);

        return {
          slug: n.slug,
          title: n.title,
          folderPath: String(n.folder_path ?? "").trim(),
          markdownBody: n.markdown_body,
          tags: tagsFromFrontmatter(fm as Record<string, unknown>),
          noteType: n.note_type,
          sourceCount: typeof n.source_count === "number" ? n.source_count : 0
        };
      }
    });

    const now = Date.now();
    const actions = core.actions.map((action) => ({
      id: crypto.randomUUID(),
      kind: action.kind,
      status: "pending" as const,
      createdAt: now,
      targetTitle: action.targetTitle,
      targetSlug: action.targetSlug,
      targetFolderPath: action.targetFolderPath,
      beforeMarkdown: action.beforeMarkdown,
      afterMarkdown: action.afterMarkdown,
      frontmatter: {
        tags: action.frontmatter.tags ?? [],
        type: action.frontmatter.type ?? "concept",
        sources: action.frontmatter.sources ?? 0
      },
      rationale: action.rationale,
      sourceMessageIds: action.sourceMessageIds
    }));

    return new Response(JSON.stringify({ actions, clarification: core.clarification }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Could not propose note actions."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
