import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  ensureDefaultWorkspace,
  mapChatMessageRow,
  mapChatSessionRow
} from "../_shared/cloud.ts";
import type {
  CloudChatMessageWriteInput,
  CloudReplaceChatMessagesInput,
  CloudUpsertChatSessionInput
} from "../../../shared/cloud/types.ts";

function parseUpsertSessionInput(value: unknown): CloudUpsertChatSessionInput {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid chat session payload.");
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.workspaceId !== "string" ||
    typeof record.id !== "string" ||
    typeof record.title !== "string" ||
    typeof record.model !== "string"
  ) {
    throw new Error("workspaceId, id, title, and model are required.");
  }

  return {
    workspaceId: record.workspaceId,
    id: record.id,
    title: record.title,
    model: record.model,
    messageCount: typeof record.messageCount === "number" ? record.messageCount : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    legacyId:
      typeof record.legacyId === "string" || record.legacyId === null ? record.legacyId : undefined
  };
}

function parseMessageInput(value: unknown): CloudChatMessageWriteInput {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid chat message payload.");
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.id !== "string" ||
    (record.role !== "user" && record.role !== "assistant") ||
    typeof record.content !== "string" ||
    typeof record.createdAt !== "string"
  ) {
    throw new Error("id, role, content, and createdAt are required.");
  }

  return {
    id: record.id,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt,
    tokens: typeof record.tokens === "number" || record.tokens === null ? record.tokens : undefined,
    attachments: Array.isArray(record.attachments) ? record.attachments : undefined,
    mediaArtifacts: Array.isArray(record.mediaArtifacts) ? record.mediaArtifacts : undefined,
    noteActions: Array.isArray(record.noteActions) ? record.noteActions : undefined,
    replyContext:
      record.replyContext && typeof record.replyContext === "object" && !Array.isArray(record.replyContext)
        ? (record.replyContext as Record<string, unknown>)
        : record.replyContext === null
          ? null
          : undefined,
    composerPins: Array.isArray(record.composerPins) ? record.composerPins : undefined,
    legacyId:
      typeof record.legacyId === "string" || record.legacyId === null ? record.legacyId : undefined
  };
}

function parseReplaceMessagesInput(value: unknown): CloudReplaceChatMessagesInput {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid chat message batch payload.");
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.workspaceId !== "string" ||
    typeof record.sessionId !== "string" ||
    !Array.isArray(record.messages)
  ) {
    throw new Error("workspaceId, sessionId, and messages are required.");
  }

  return {
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    messages: record.messages.map(parseMessageInput)
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user, admin } = await requireUser(request);
    const workspaces = await ensureDefaultWorkspace(admin, user.id);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const workspaceId = url.searchParams.get("workspace_id");
      const sessionId = url.searchParams.get("session_id");
      const workspace = assertWorkspaceAccess(workspaces, workspaceId);

      if (!sessionId) {
        const { data, error } = await admin
          .from("chat_sessions")
          .select("id, workspace_id, legacy_id, title, model, message_count, created_at, updated_at")
          .eq("workspace_id", workspace.id)
          .order("updated_at", { ascending: false });

        if (error) {
          throw error;
        }

        return new Response(JSON.stringify((data ?? []).map((row) => mapChatSessionRow(row))), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      const { data: sessionRow, error: sessionError } = await admin
        .from("chat_sessions")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionError) {
        throw sessionError;
      }

      if (!sessionRow) {
        throw new Error("That chat session could not be found.");
      }

      const { data, error } = await admin
        .from("chat_messages")
        .select(
          "id, session_id, legacy_id, role, content, tokens, attachments_json, media_artifacts_json, note_actions_json, reply_context_json, composer_pins_json, created_at"
        )
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      return new Response(JSON.stringify((data ?? []).map((row) => mapChatMessageRow(row))), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (request.method === "POST") {
      const parsed = parseUpsertSessionInput(await request.json());
      const workspace = assertWorkspaceAccess(workspaces, parsed.workspaceId);
      const nowIso = new Date().toISOString();
      const { data, error } = await admin
        .from("chat_sessions")
        .upsert(
          {
            id: parsed.id,
            workspace_id: workspace.id,
            legacy_id: parsed.legacyId ?? null,
            title: parsed.title,
            model: parsed.model,
            message_count: parsed.messageCount ?? 0,
            created_at: parsed.createdAt ?? nowIso,
            updated_at: parsed.updatedAt ?? nowIso
          },
          { onConflict: "id" }
        )
        .select("id, workspace_id, legacy_id, title, model, message_count, created_at, updated_at")
        .single();

      if (error || !data) {
        throw error ?? new Error("Could not save that chat session.");
      }

      return new Response(JSON.stringify(mapChatSessionRow(data)), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (request.method === "PUT") {
      const parsed = parseReplaceMessagesInput(await request.json());
      const workspace = assertWorkspaceAccess(workspaces, parsed.workspaceId);
      const { data: sessionRow, error: sessionError } = await admin
        .from("chat_sessions")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("id", parsed.sessionId)
        .maybeSingle();

      if (sessionError) {
        throw sessionError;
      }

      if (!sessionRow) {
        throw new Error("That chat session could not be found.");
      }

      const { error: deleteError } = await admin
        .from("chat_messages")
        .delete()
        .eq("session_id", parsed.sessionId);

      if (deleteError) {
        throw deleteError;
      }

      if (parsed.messages.length > 0) {
        const { error: insertError } = await admin.from("chat_messages").insert(
          parsed.messages.map((message) => ({
            id: message.id,
            session_id: parsed.sessionId,
            legacy_id: message.legacyId ?? null,
            role: message.role,
            content: message.content,
            tokens: message.tokens ?? null,
            attachments_json: message.attachments ?? [],
            media_artifacts_json: message.mediaArtifacts ?? [],
            note_actions_json: message.noteActions ?? [],
            reply_context_json: message.replyContext ?? null,
            composer_pins_json: message.composerPins ?? [],
            created_at: message.createdAt
          }))
        );

        if (insertError) {
          throw insertError;
        }
      }

      const { data: sessionData, error: updateError } = await admin
        .from("chat_sessions")
        .update({
          message_count: parsed.messages.length,
          updated_at: new Date().toISOString()
        })
        .eq("workspace_id", workspace.id)
        .eq("id", parsed.sessionId)
        .select("id, workspace_id, legacy_id, title, model, message_count, created_at, updated_at")
        .single();

      if (updateError || !sessionData) {
        throw updateError ?? new Error("Could not update that chat session.");
      }

      return new Response(JSON.stringify(mapChatSessionRow(sessionData)), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (request.method === "DELETE") {
      const workspaceId = url.searchParams.get("workspace_id");
      const sessionId = url.searchParams.get("session_id");
      if (!workspaceId || !sessionId) {
        return new Response(JSON.stringify({ error: "workspace_id and session_id are required." }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      const workspace = assertWorkspaceAccess(workspaces, workspaceId);
      const { data: existing, error: lookupError } = await admin
        .from("chat_sessions")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("id", sessionId)
        .maybeSingle();

      if (lookupError) {
        throw lookupError;
      }

      if (!existing) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      const { error: deleteError } = await admin
        .from("chat_sessions")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("id", sessionId);

      if (deleteError) {
        throw deleteError;
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
        error: error instanceof Error ? error.message : "Could not manage chat data."
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
