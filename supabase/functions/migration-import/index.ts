import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  buildNoteExcerpt,
  buildNoteLinkInserts,
  ensureDefaultWorkspace,
  ensureWorkspaceFolderPath,
  normalizeFolderPath,
  safeJsonObject,
  workspaceNameToSlug
} from "../_shared/cloud.ts";
import type {
  CloudMigrationImportRequest,
  CloudMigrationImportResponse,
  CloudWorkspace
} from "../../../shared/cloud/types.ts";

function normalizeIso(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

async function resolveWorkspace(
  admin: ReturnType<typeof requireUser> extends Promise<{ admin: infer T }> ? T : never,
  userId: string,
  request: CloudMigrationImportRequest
): Promise<CloudWorkspace> {
  const existingWorkspaces = await ensureDefaultWorkspace(admin, userId);

  if (request.workspaceId) {
    const existing = existingWorkspaces.find((workspace) => workspace.id === request.workspaceId);

    if (!existing) {
      throw new Error("That workspace could not be found for import.");
    }

    return existing;
  }

  if (!request.workspaceName) {
    return existingWorkspaces[0]!;
  }

  const slug = request.workspaceSlug?.trim() || workspaceNameToSlug(request.workspaceName);
  const matched = existingWorkspaces.find((workspace) => workspace.slug === slug);

  if (matched) {
    return matched;
  }

  const { data, error } = await admin
    .from("workspaces")
    .insert({
      owner_user_id: userId,
      name: request.workspaceName.trim(),
      slug
    })
    .select("id, name, slug, migration_status, import_summary, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Could not create a workspace for migration import.");
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    migrationStatus: data.migration_status,
    importSummary: (data.import_summary as Record<string, unknown> | null) ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
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
    const body = (await request.json()) as CloudMigrationImportRequest;

    if (!body.importDigest || body.importDigest.trim().length === 0) {
      throw new Error("An importDigest is required.");
    }

    const workspace = await resolveWorkspace(admin, user.id, body);
    const startedAt = new Date().toISOString();
    const {
      data: importRunRow,
      error: importRunError
    } = await admin
      .from("migration_import_runs")
      .upsert(
        {
          workspace_id: workspace.id,
          import_digest: body.importDigest,
          status: "running",
          summary_json: safeJsonObject(body.importSummary),
          started_at: startedAt
        },
        { onConflict: "workspace_id,import_digest" }
      )
      .select("id")
      .single();

    if (importRunError || !importRunRow) {
      throw importRunError ?? new Error("Could not start a migration import run.");
    }

    const importedCounts = {
      notes: 0,
      chatSessions: 0,
      chatMessages: 0,
      memoryItems: 0,
      thoughts: 0,
      sourceDocuments: 0,
      attachments: 0
    };
    const nowIso = new Date().toISOString();
    const noteIdByLegacyId = new Map<string, string>();
    const sessionIdByLegacyId = new Map<string, string>();
    const sourceDocumentIdByLegacyId = new Map<string, string>();

    for (const note of body.notes ?? []) {
      const normalizedFolderPath = normalizeFolderPath(note.folderPath);
      await ensureWorkspaceFolderPath(admin, workspace.id, normalizedFolderPath);
      const { data, error } = await admin
        .from("notes")
        .upsert(
          {
            workspace_id: workspace.id,
            legacy_id: note.legacyId,
            slug: note.slug,
            title: note.title,
            markdown_body: note.markdownBody,
            frontmatter_json: safeJsonObject(note.frontmatter),
            excerpt: buildNoteExcerpt(note.markdownBody),
            note_type: note.noteType ?? "concept",
            folder_path: normalizedFolderPath,
            source_count: note.sourceCount ?? 0,
            url: note.url ?? null,
            created_at: normalizeIso(note.createdAt, nowIso),
            updated_at: normalizeIso(note.updatedAt, nowIso)
          },
          { onConflict: "workspace_id,legacy_id" }
        )
        .select("id")
        .single();

      if (error || !data) {
        throw error ?? new Error(`Could not import note ${note.title}.`);
      }

      noteIdByLegacyId.set(note.legacyId, data.id);
      importedCounts.notes += 1;

      await admin.from("note_links").delete().eq("workspace_id", workspace.id).eq("source_note_id", data.id);
      const linkInserts = buildNoteLinkInserts(data.id, note.markdownBody).map((link) => ({
        workspace_id: workspace.id,
        ...link
      }));

      if (linkInserts.length > 0) {
        const { error: linkInsertError } = await admin.from("note_links").insert(linkInserts);

        if (linkInsertError) {
          throw linkInsertError;
        }
      }
    }

    for (const session of body.chatSessions ?? []) {
      const { data, error } = await admin
        .from("chat_sessions")
        .upsert(
          {
            workspace_id: workspace.id,
            legacy_id: session.legacyId,
            title: session.title,
            model: session.model,
            message_count: session.messages.length,
            created_at: normalizeIso(session.createdAt, nowIso),
            updated_at: normalizeIso(session.updatedAt, nowIso)
          },
          { onConflict: "workspace_id,legacy_id" }
        )
        .select("id")
        .single();

      if (error || !data) {
        throw error ?? new Error(`Could not import chat session ${session.title}.`);
      }

      sessionIdByLegacyId.set(session.legacyId, data.id);
      importedCounts.chatSessions += 1;

      for (const message of session.messages) {
        const { error: messageError } = await admin
          .from("chat_messages")
          .upsert(
            {
              session_id: data.id,
              legacy_id: message.legacyId,
              role: message.role,
              content: message.content,
              tokens: message.tokens ?? null,
              attachments_json: message.attachments ?? [],
              media_artifacts_json: message.mediaArtifacts ?? [],
              note_actions_json: message.noteActions ?? [],
              reply_context_json: message.replyContext ?? null,
              composer_pins_json: message.composerPins ?? [],
              created_at: normalizeIso(message.createdAt, nowIso)
            },
            { onConflict: "session_id,legacy_id" }
          );

        if (messageError) {
          throw messageError;
        }

        importedCounts.chatMessages += 1;
      }
    }

    for (const item of body.memoryItems ?? []) {
      const { error } = await admin.from("memory_items").upsert(
        {
          workspace_id: workspace.id,
          legacy_id: item.legacyId,
          kind: item.kind,
          content: item.content,
          source_message_ids: item.sourceMessageIds ?? [],
          linked_note_slug: item.linkedNoteSlug ?? null,
          confidence: item.confidence ?? 0,
          created_at: normalizeIso(item.createdAt, nowIso),
          updated_at: normalizeIso(item.updatedAt, nowIso)
        },
        { onConflict: "workspace_id,legacy_id" }
      );

      if (error) {
        throw error;
      }

      importedCounts.memoryItems += 1;
    }

    for (const thought of body.thoughts ?? []) {
      const { error } = await admin.from("thoughts").upsert(
        {
          workspace_id: workspace.id,
          legacy_id: thought.legacyId,
          content: thought.content,
          source_type: thought.sourceType,
          status: thought.status,
          backing_note_slug: thought.backingNoteSlug ?? null,
          related_thought_ids: thought.relatedThoughtIds ?? [],
          extracted_entities: thought.extractedEntities ?? [],
          tags: thought.tags ?? [],
          enrichment_json: thought.enrichment ?? null,
          enrichment_error: thought.enrichmentError ?? null,
          created_at: normalizeIso(thought.createdAt, nowIso),
          updated_at: normalizeIso(thought.updatedAt, nowIso)
        },
        { onConflict: "workspace_id,legacy_id" }
      );

      if (error) {
        throw error;
      }

      importedCounts.thoughts += 1;
    }

    for (const sourceDocument of body.sourceDocuments ?? []) {
      const { data, error } = await admin
        .from("source_documents")
        .upsert(
          {
            workspace_id: workspace.id,
            legacy_id: sourceDocument.legacyId,
            source_type: sourceDocument.sourceType,
            title: sourceDocument.title,
            source_path: sourceDocument.sourcePath ?? null,
            storage_path: sourceDocument.storagePath ?? null,
            mime_type: sourceDocument.mimeType ?? null,
            byte_size: sourceDocument.byteSize ?? null,
            sha256: sourceDocument.sha256 ?? null,
            created_at: normalizeIso(sourceDocument.createdAt, nowIso),
            updated_at: normalizeIso(sourceDocument.updatedAt, nowIso)
          },
          { onConflict: "workspace_id,legacy_id" }
        )
        .select("id")
        .single();

      if (error || !data) {
        throw error ?? new Error(`Could not import source document ${sourceDocument.title}.`);
      }

      sourceDocumentIdByLegacyId.set(sourceDocument.legacyId, data.id);
      importedCounts.sourceDocuments += 1;
    }

    for (const attachment of body.attachments ?? []) {
      const { error } = await admin.from("attachments").upsert(
        {
          workspace_id: workspace.id,
          legacy_id: attachment.legacyId,
          chat_session_id:
            attachment.chatSessionLegacyId ? sessionIdByLegacyId.get(attachment.chatSessionLegacyId) ?? null : null,
          note_id: attachment.noteLegacyId ? noteIdByLegacyId.get(attachment.noteLegacyId) ?? null : null,
          source_document_id: attachment.sourceDocumentLegacyId
            ? sourceDocumentIdByLegacyId.get(attachment.sourceDocumentLegacyId) ?? null
            : null,
          bucket: attachment.bucket,
          storage_path: attachment.storagePath,
          mime_type: attachment.mimeType ?? null,
          byte_size: attachment.byteSize ?? null,
          sha256: attachment.sha256 ?? null,
          created_at: normalizeIso(attachment.createdAt, nowIso),
          updated_at: normalizeIso(attachment.updatedAt, nowIso)
        },
        { onConflict: "workspace_id,legacy_id" }
      );

      if (error) {
        throw error;
      }

      importedCounts.attachments += 1;
    }

    const finishedAt = new Date().toISOString();

    await admin
      .from("workspaces")
      .update({
        migration_status: "completed",
        import_summary: safeJsonObject(body.importSummary),
        updated_at: finishedAt
      })
      .eq("id", workspace.id);

    await admin
      .from("migration_import_runs")
      .update({
        status: "completed",
        summary_json: safeJsonObject(body.importSummary),
        finished_at: finishedAt
      })
      .eq("id", importRunRow.id);

    const response: CloudMigrationImportResponse = {
      workspace: {
        ...workspace,
        migrationStatus: "completed",
        importSummary: safeJsonObject(body.importSummary),
        updatedAt: finishedAt
      },
      imported: importedCounts
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
        error: error instanceof Error ? error.message : "Could not import migration snapshot."
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
