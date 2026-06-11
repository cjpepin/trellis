import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { assertWorkspaceAccess, ensureDefaultWorkspace } from "../_shared/cloud.ts";
import type { CloudNoteRevisionSummary, CloudStrandRevisionActor } from "../../../shared/cloud/types.ts";

const actors: CloudStrandRevisionActor[] = ["user", "trellis", "import", "system"];

function isActor(value: string): value is CloudStrandRevisionActor {
  return actors.includes(value as CloudStrandRevisionActor);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    const { admin } = await requireUser(request);
    const workspaces = await ensureDefaultWorkspace(admin, user.id);
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspace_id");
    const slug = url.searchParams.get("slug");
    const revisionId = url.searchParams.get("revision_id");

    const workspace = assertWorkspaceAccess(workspaces, workspaceId);

    if (revisionId) {
      const { data: rev, error: revError } = await admin
        .from("note_revisions")
        .select("id, body, workspace_id")
        .eq("id", revisionId)
        .maybeSingle();

      if (revError) {
        throw revError;
      }

      const row = rev as { id: string; body: string; workspace_id: string } | null;
      if (!row || row.workspace_id !== workspace.id) {
        return new Response(JSON.stringify({ error: "Revision not found." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ body: row.body }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!slug || slug.trim().length === 0) {
      throw new Error("slug or revision_id is required.");
    }

    const trimmedSlug = slug.trim();

    const { data: note, error: noteError } = await admin
      .from("notes")
      .select("id, folder_path")
      .eq("workspace_id", workspace.id)
      .eq("slug", trimmedSlug)
      .maybeSingle();

    if (noteError) {
      throw noteError;
    }

    if (!note) {
      return new Response(JSON.stringify([] satisfies CloudNoteRevisionSummary[]), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const noteId = (note as { id: string }).id;
    const folderPath = String((note as { folder_path: string | null }).folder_path ?? "").trim();
    const file = folderPath.length > 0 ? `${folderPath}/${trimmedSlug}.md` : `${trimmedSlug}.md`;

    const { data: revRows, error: listError } = await admin
      .from("note_revisions")
      .select("id, created_at, actor, session_id, content_sha256")
      .eq("note_id", noteId)
      .order("created_at", { ascending: false });

    if (listError) {
      throw listError;
    }

    const sessionIds = [
      ...new Set(
        (revRows ?? [])
          .map((r) => (r as { session_id: string | null }).session_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    ];

    const sessionTitles = new Map<string, string>();
    if (sessionIds.length > 0) {
      const { data: sessions, error: sessError } = await admin
        .from("chat_sessions")
        .select("id, title")
        .eq("workspace_id", workspace.id)
        .in("id", sessionIds);

      if (sessError) {
        throw sessError;
      }

      for (const s of sessions ?? []) {
        const row = s as { id: string; title: string };
        sessionTitles.set(row.id, row.title);
      }
    }

    const list: CloudNoteRevisionSummary[] = (revRows ?? []).map((raw) => {
      const r = raw as {
        id: string;
        created_at: string;
        actor: string;
        session_id: string | null;
        content_sha256: string;
      };
      const actor: CloudStrandRevisionActor = isActor(r.actor) ? r.actor : "user";
      const sessionId = r.session_id;
      return {
        id: r.id,
        createdAt: r.created_at,
        actor,
        sessionId,
        sessionTitle: sessionId ? sessionTitles.get(sessionId) ?? null : null,
        contentSha256: r.content_sha256,
        file
      };
    });

    return new Response(JSON.stringify(list), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Could not load note revisions."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
