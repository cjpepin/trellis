import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  ensureDefaultWorkspace,
  safeJsonObject
} from "../_shared/cloud.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";
import { lexicalNoteScore, type LexicalNoteRow } from "../_shared/retrievalLexical.ts";
import type { ThoughtEnrichment } from "../../../shared/thoughts/types.ts";
import {
  buildThoughtTemporalSignals,
  scoreRelatedThoughtsLexical,
  tokenizeThoughtContent
} from "../../../shared/thoughts/enrichShared.ts";

function tagsFromFrontmatter(raw: unknown): string[] {
  const fm = safeJsonObject(raw);
  const t = fm.tags;
  if (!Array.isArray(t)) {
    return [];
  }
  return t.filter((x): x is string => typeof x === "string");
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
    const thoughtId = typeof body.thoughtId === "string" ? body.thoughtId : "";

    if (!workspaceId || !thoughtId) {
      return new Response(JSON.stringify({ error: "workspaceId and thoughtId are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const workspace = assertWorkspaceAccess(workspaces, workspaceId);

    const { data: thoughtRow, error: thoughtError } = await admin
      .from("thoughts")
      .select(
        "id, workspace_id, content, created_at, status"
      )
      .eq("id", thoughtId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();

    if (thoughtError) {
      throw thoughtError;
    }

    if (!thoughtRow || typeof thoughtRow.content !== "string") {
      return new Response(JSON.stringify({ error: "Thought not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const thoughtContent = thoughtRow.content;
    const thoughtCreatedAt = new Date(
      typeof thoughtRow.created_at === "string" ? thoughtRow.created_at : ""
    ).getTime();

    const { error: markErr } = await admin
      .from("thoughts")
      .update({
        status: "processing",
        enrichment_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", thoughtId)
      .eq("workspace_id", workspace.id);

    if (markErr) {
      throw markErr;
    }

    try {
      const querySlice = thoughtContent.trim().slice(0, 2_000);

      const { data: noteRows, error: notesError } = await admin
        .from("notes")
        .select("slug, title, markdown_body, frontmatter_json, updated_at")
        .eq("workspace_id", workspace.id);

      if (notesError) {
        throw notesError;
      }

      const lexicalRows: LexicalNoteRow[] = (noteRows ?? [])
        .map((row) => {
          const r = row as Record<string, unknown>;
          return {
            slug: typeof r.slug === "string" ? r.slug : "",
            title: typeof r.title === "string" ? r.title : "",
            markdown_body: typeof r.markdown_body === "string" ? r.markdown_body : "",
            tags: tagsFromFrontmatter(r.frontmatter_json)
          };
        })
        .filter((row) => row.slug.length > 0);

      const scored = lexicalRows
        .map((row) => ({
          row,
          score: lexicalNoteScore(querySlice, row)
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      const relatedNotes = scored.slice(0, 5).map((hit) => ({
        slug: hit.row.slug,
        title: hit.row.title,
        score: hit.score,
        reason:
          hit.score >= 12 ? "Strong match" : hit.score >= 6 ? "Shared topic" : "Possibly related"
      }));

      const notesBySlug = new Map(
        (noteRows ?? []).map((row) => {
          const r = row as Record<string, unknown>;
          const slug = typeof r.slug === "string" ? r.slug : "";
          const title = typeof r.title === "string" ? r.title : "";
          const updatedAt = typeof r.updated_at === "string" ? r.updated_at : new Date().toISOString();
          return [slug, { title, updated: updatedAt }] as const;
        })
      );

      const { data: allThoughtRows, error: listThoughtErr } = await admin
        .from("thoughts")
        .select("id, content, created_at")
        .eq("workspace_id", workspace.id)
        .order("updated_at", { ascending: false })
        .limit(400);

      if (listThoughtErr) {
        throw listThoughtErr;
      }

      const others = (allThoughtRows ?? [])
        .map((row) => {
          const r = row as Record<string, unknown>;
          const id = typeof r.id === "string" ? r.id : "";
          const content = typeof r.content === "string" ? r.content : "";
          const createdRaw = typeof r.created_at === "string" ? r.created_at : "";
          return {
            id,
            content,
            createdAt: new Date(createdRaw).getTime()
          };
        })
        .filter((row) => row.id.length > 0);

      const otherRowsForTemporal = others.filter((o) => o.id !== thoughtId);

      const relatedThoughts = scoreRelatedThoughtsLexical({
        selfContent: thoughtContent,
        selfId: thoughtId,
        others: otherRowsForTemporal.map((o) => ({ id: o.id, content: o.content }))
      });

      const keywords = tokenizeThoughtContent(thoughtContent).slice(0, 12);

      const temporalSignals = buildThoughtTemporalSignals({
        thoughtCreatedAt: Number.isFinite(thoughtCreatedAt) ? thoughtCreatedAt : Date.now(),
        keywords,
        relatedNotes,
        otherThoughts: otherRowsForTemporal.map((row) => ({
          id: row.id,
          content: row.content,
          createdAt: row.createdAt
        })),
        notesBySlug
      });

      const enrichment: ThoughtEnrichment = {
        keywords,
        relatedNotes: relatedNotes.slice(0, 4),
        relatedThoughts,
        temporalSignals
      };

      const relatedThoughtIds = relatedThoughts.map((t) => t.id);
      const extractedEntities = keywords.slice(0, 8);
      const tags = keywords.slice(0, 6);

      const { error: finErr } = await admin
        .from("thoughts")
        .update({
          status: "enriched",
          enrichment_json: enrichment,
          related_thought_ids: relatedThoughtIds,
          extracted_entities: extractedEntities,
          tags,
          enrichment_error: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", thoughtId)
        .eq("workspace_id", workspace.id);

      if (finErr) {
        throw finErr;
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      await admin
        .from("thoughts")
        .update({
          status: "failed",
          enrichment_error: message,
          updated_at: new Date().toISOString()
        })
        .eq("id", thoughtId)
        .eq("workspace_id", workspace.id);

      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Thought enrichment failed."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
