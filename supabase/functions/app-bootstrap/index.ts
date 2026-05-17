import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  buildInboundCountBySlug,
  buildWorkspaceGraph,
  collectWorkspaceFolderPaths,
  ensureDefaultWorkspace,
  getUserPreferences,
  listProviderCredentialStatuses,
  mapChatSessionRow,
  mapNoteSummaryRow,
  upsertUserPreferences
} from "../_shared/cloud.ts";
import type { CloudBootstrapResponse } from "../../../shared/cloud/types.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user, profile, admin } = await requireUser(request, { allowDeleted: true });

    if (profile.deleted_at) {
      return new Response(
        JSON.stringify({
          accountPendingDeletion: true,
          deletedAt: profile.deleted_at,
          workspaces: [],
          activeWorkspaceId: "",
          preferences: {
            theme: null,
            activeWorkspaceId: null,
            chat: {},
            platform: {}
          },
          providerCredentialStatuses: [],
          chatSessions: [],
          folderPaths: [],
          notes: [],
          graph: {
            nodes: [],
            edges: []
          }
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
    const workspaces = await ensureDefaultWorkspace(admin, user.id);
    const preferences = await getUserPreferences(admin, user.id);
    const requestedWorkspaceId = new URL(request.url).searchParams.get("workspace_id");
    const activeWorkspace = requestedWorkspaceId
      ? assertWorkspaceAccess(workspaces, requestedWorkspaceId)
      : assertWorkspaceAccess(
          workspaces,
          preferences.activeWorkspaceId ?? workspaces[0]?.id ?? null
        );

    if (preferences.activeWorkspaceId !== activeWorkspace.id) {
      await upsertUserPreferences(admin, user.id, {
        activeWorkspaceId: activeWorkspace.id
      });
    }

    const [
      { data: noteRows, error: notesError },
      { data: noteLinkRows, error: noteLinksError },
      { data: folderRows, error: foldersError },
      { data: sessionRows, error: sessionsError },
      providerCredentialStatuses
    ] =
      await Promise.all([
        admin
          .from("notes")
          .select(
            "id, workspace_id, slug, title, markdown_body, frontmatter_json, excerpt, note_type, folder_path, source_count, url, created_at, updated_at"
          )
          .eq("workspace_id", activeWorkspace.id)
          .order("updated_at", { ascending: false }),
        admin
          .from("note_links")
          .select("source_note_id, target_slug, target_title")
          .eq("workspace_id", activeWorkspace.id),
        admin
          .from("workspace_folders")
          .select("path")
          .eq("workspace_id", activeWorkspace.id),
        admin
          .from("chat_sessions")
          .select("id, workspace_id, legacy_id, title, model, message_count, created_at, updated_at")
          .eq("workspace_id", activeWorkspace.id)
          .order("updated_at", { ascending: false }),
        listProviderCredentialStatuses(admin, user.id)
      ]);

    if (notesError) {
      throw notesError;
    }

    if (noteLinksError) {
      throw noteLinksError;
    }

    if (foldersError) {
      throw foldersError;
    }

    if (sessionsError) {
      throw sessionsError;
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
    const graph = buildWorkspaceGraph(
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

    const response: CloudBootstrapResponse = {
      workspaces,
      activeWorkspaceId: activeWorkspace.id,
      preferences: {
        ...preferences,
        activeWorkspaceId: activeWorkspace.id
      },
      providerCredentialStatuses,
      chatSessions: (sessionRows ?? []).map((row) =>
        mapChatSessionRow(
          row as {
            id: string;
            workspace_id: string;
            legacy_id: string | null;
            title: string;
            model: string;
            message_count: number;
            created_at: string;
            updated_at: string;
          }
        )
      ),
      folderPaths: collectWorkspaceFolderPaths(
        (noteRows ?? []) as Array<{ folder_path: string }>,
        (folderRows ?? []) as Array<{ path: string }>
      ),
      notes,
      graph
    };

    return new Response(JSON.stringify(response), {
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
        error: error instanceof Error ? error.message : "Could not bootstrap cloud workspace state."
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
