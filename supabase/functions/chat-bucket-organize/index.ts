import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  ensureDefaultWorkspace,
  ensureWorkspaceFolderPath
} from "../_shared/cloud.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";
import {
  planBucketOrganize,
  type BucketOrganizeNoteSummary
} from "../../../shared/chat/bucketOrganizePlan.ts";
import { normalizeWikiFolderPath } from "../../../shared/bucket/folderPath.ts";

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
    const userMessage = typeof body.userMessage === "string" ? body.userMessage : "";

    if (!workspaceId || userMessage.trim().length === 0) {
      throw new Error("workspaceId and userMessage are required.");
    }

    const workspace = assertWorkspaceAccess(workspaces, workspaceId);

    const { data: noteRows, error: notesError } = await admin
      .from("notes")
      .select("slug, title, folder_path")
      .eq("workspace_id", workspace.id);

    if (notesError) {
      throw notesError;
    }

    const summaries: BucketOrganizeNoteSummary[] = (noteRows ?? []).map((row) => {
      const r = row as { slug: string; title: string; folder_path: string | null };
      return {
        slug: r.slug,
        title: r.title,
        folderPath: String(r.folder_path ?? "").trim()
      };
    });

    const plan = planBucketOrganize(userMessage, summaries);

    if (!plan || (plan.createFolders.length === 0 && plan.moves.length === 0)) {
      return new Response(
        JSON.stringify({ applied: false, message: null, movedNote: undefined }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    for (const folder of plan.createFolders) {
      const segment = folder.name.trim();
      const folderPath =
        folder.parentPath && folder.parentPath.length > 0
          ? `${folder.parentPath}/${segment}`
          : segment;
      await ensureWorkspaceFolderPath(admin, workspace.id, folderPath);
    }

    let moveCount = 0;
    let movedNote: { slug: string; title: string } | undefined;
    const nowIso = new Date().toISOString();

    for (const move of plan.moves) {
      const { data: noteRow, error: noteErr } = await admin
        .from("notes")
        .select("id, slug, title, folder_path")
        .eq("workspace_id", workspace.id)
        .eq("slug", move.slug)
        .maybeSingle();

      if (noteErr) {
        throw noteErr;
      }

      if (!noteRow) {
        continue;
      }

      const n = noteRow as { id: string; slug: string; title: string; folder_path: string | null };
      const current = normalizeWikiFolderPath(String(n.folder_path ?? ""));
      const next = normalizeWikiFolderPath(move.folderPath);

      if (current === next) {
        continue;
      }

      const { error: upErr } = await admin
        .from("notes")
        .update({
          folder_path: next,
          updated_at: nowIso
        })
        .eq("id", n.id)
        .eq("workspace_id", workspace.id);

      if (upErr) {
        throw upErr;
      }

      moveCount += 1;
      if (!movedNote) {
        movedNote = { slug: n.slug, title: n.title };
      }
    }

    const folderLabel = plan.createFolders[0]?.name ?? "folder";

    if (moveCount > 0) {
      return new Response(
        JSON.stringify({
          applied: true,
          message: `Created wiki folder “${folderLabel}” and moved ${moveCount} note${moveCount === 1 ? "" : "s"}.`,
          movedNote
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify({
        applied: true,
        message: `Created wiki folder “${folderLabel}”.`,
        movedNote: undefined
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Could not organize the vault."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
