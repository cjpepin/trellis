import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  ensureDefaultWorkspace,
  ensureWorkspaceFolderPath,
  normalizeFolderPath
} from "../_shared/cloud.ts";
import type {
  CloudCreateFolderInput,
  CloudDeleteFolderInput,
  CloudRenameFolderInput
} from "../../../shared/cloud/types.ts";

function parseCreateInput(value: unknown): CloudCreateFolderInput {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid create folder request.");
  }

  const record = value as Record<string, unknown>;

  if (typeof record.workspaceId !== "string" || typeof record.name !== "string") {
    throw new Error("workspaceId and name are required.");
  }

  return {
    workspaceId: record.workspaceId,
    name: record.name,
    parentPath:
      typeof record.parentPath === "string" || record.parentPath === null
        ? record.parentPath
        : undefined
  };
}

function parseRenameInput(value: unknown): CloudRenameFolderInput {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid rename folder request.");
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.workspaceId !== "string" ||
    typeof record.path !== "string" ||
    typeof record.name !== "string"
  ) {
    throw new Error("workspaceId, path, and name are required.");
  }

  return {
    workspaceId: record.workspaceId,
    path: record.path,
    name: record.name,
    parentPath:
      typeof record.parentPath === "string" || record.parentPath === null
        ? record.parentPath
        : undefined
  };
}

function parseDeleteInput(value: unknown): CloudDeleteFolderInput {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid delete folder request.");
  }

  const record = value as Record<string, unknown>;

  if (typeof record.workspaceId !== "string" || typeof record.path !== "string") {
    throw new Error("workspaceId and path are required.");
  }

  return {
    workspaceId: record.workspaceId,
    path: record.path
  };
}

function sanitizeFolderName(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+/g, "-");

  if (trimmed.length === 0) {
    throw new Error("Enter a folder name before saving.");
  }

  if (trimmed === "." || trimmed === ".." || trimmed.includes("..")) {
    throw new Error("Folder names must stay inside the workspace root.");
  }

  return trimmed;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user, admin } = await requireUser(request);
    const workspaces = await ensureDefaultWorkspace(admin, user.id);

    if (request.method === "POST") {
      const parsed = parseCreateInput(await request.json());
      const workspace = assertWorkspaceAccess(workspaces, parsed.workspaceId);
      const parentPath = normalizeFolderPath(parsed.parentPath);
      const folderName = sanitizeFolderName(parsed.name);
      const nextPath = normalizeFolderPath(
        parentPath.length > 0 ? `${parentPath}/${folderName}` : folderName
      );

      await ensureWorkspaceFolderPath(admin, workspace.id, nextPath);

      return new Response(JSON.stringify({ ok: true, path: nextPath }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (request.method === "PATCH") {
      const parsed = parseRenameInput(await request.json());
      const workspace = assertWorkspaceAccess(workspaces, parsed.workspaceId);
      const sourcePath = normalizeFolderPath(parsed.path);
      const parentPath = normalizeFolderPath(parsed.parentPath);
      const targetName = sanitizeFolderName(parsed.name);
      const targetPath = normalizeFolderPath(
        parentPath.length > 0 ? `${parentPath}/${targetName}` : targetName
      );

      if (sourcePath.length === 0 || targetPath.length === 0) {
        throw new Error("A valid folder path is required.");
      }

      const { error } = await admin.rpc("rename_workspace_folder", {
        p_workspace_id: workspace.id,
        p_from_path: sourcePath,
        p_to_path: targetPath
      });

      if (error) {
        throw error;
      }

      return new Response(JSON.stringify({ ok: true, path: targetPath }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (request.method === "DELETE") {
      const parsed = parseDeleteInput(await request.json());
      const workspace = assertWorkspaceAccess(workspaces, parsed.workspaceId);
      const folderPath = normalizeFolderPath(parsed.path);

      if (folderPath.length === 0) {
        throw new Error("A valid folder path is required.");
      }

      const { error } = await admin.rpc("delete_workspace_folder", {
        p_workspace_id: workspace.id,
        p_folder_path: folderPath
      });

      if (error) {
        throw error;
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Could not manage folders."
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
