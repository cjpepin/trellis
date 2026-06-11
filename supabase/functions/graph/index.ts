import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  buildInboundCountBySlug,
  buildWorkspaceGraph,
  ensureDefaultWorkspace,
  mapNoteSummaryRow
} from "../_shared/cloud.ts";
import type { CloudGraphData } from "../../../shared/cloud/types.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user, admin } = await requireUser(request);
    const workspaces = await ensureDefaultWorkspace(admin, user.id);
    const workspaceId = new URL(request.url).searchParams.get("workspace_id");
    const workspace = assertWorkspaceAccess(workspaces, workspaceId);
    const [{ data: noteRows, error: notesError }, { data: noteLinkRows, error: linksError }] =
      await Promise.all([
        admin
          .from("notes")
          .select(
            "id, workspace_id, slug, title, markdown_body, frontmatter_json, excerpt, note_type, folder_path, source_count, url, created_at, updated_at"
          )
          .eq("workspace_id", workspace.id),
        admin
          .from("note_links")
          .select("source_note_id, target_slug, target_title")
          .eq("workspace_id", workspace.id)
      ]);

    if (notesError) {
      throw notesError;
    }

    if (linksError) {
      throw linksError;
    }

    const inboundCountBySlug = buildInboundCountBySlug((noteLinkRows ?? []) as Array<{
      source_note_id: string;
      target_slug: string;
    }>);
    const notes = (noteRows ?? []).map((row) =>
      mapNoteSummaryRow(
        row as {
          id: string;
          workspace_id: string;
          slug: string;
          title: string;
          markdown_body: string;
          frontmatter_json: Record<string, unknown> | null;
          excerpt: string;
          note_type: "concept" | "entity" | "source-summary" | "synthesis";
          folder_path: string;
          source_count: number;
          url: string | null;
          created_at: string;
          updated_at: string;
        },
        inboundCountBySlug
      )
    );
    const graph: CloudGraphData = buildWorkspaceGraph(
      notes,
      ((noteLinkRows ?? []) as Array<{
        source_note_id: string;
        target_slug: string;
        target_title: string;
      }>).map((row) => ({
        sourceNoteId: row.source_note_id,
        targetSlug: row.target_slug,
        targetTitle: row.target_title
      }))
    );

    return new Response(JSON.stringify(graph), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Could not load graph."
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
