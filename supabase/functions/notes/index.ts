import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/http.ts";
import {
  assertWorkspaceAccess,
  buildInboundCountBySlug,
  buildNoteExcerpt,
  buildNoteLinkInserts,
  ensureWorkspaceFolderPath,
  ensureDefaultWorkspace,
  mapNoteRow,
  normalizeFolderPath,
  safeJsonObject
} from "../_shared/cloud.ts";
import { slugifyExtractionTitle } from "../../../shared/extraction/wikiLinks.ts";
import type {
  CloudDeleteNoteInput,
  CloudNote,
  CloudStrandRevisionActor,
  CloudUpsertNoteInput
} from "../../../shared/cloud/types.ts";
import type { ExtractionNoteType } from "../../../shared/extraction/contracts.ts";

interface NoteRow {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  markdown_body: string;
  frontmatter_json: Record<string, unknown> | null;
  excerpt: string;
  note_type: ExtractionNoteType;
  folder_path: string;
  source_count: number;
  url: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

const strandActors: CloudStrandRevisionActor[] = ["user", "trellis", "import", "system"];

function sanitizeSessionIdForFk(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    return null;
  }
  return raw;
}

function parseStrandRevision(
  raw: CloudUpsertNoteInput["strandRevision"]
): CloudUpsertNoteInput["strandRevision"] {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const actor = raw.actor;
  const sessionId = sanitizeSessionIdForFk(raw.sessionId ?? null);
  if (actor && strandActors.includes(actor)) {
    return { actor, sessionId };
  }
  return null;
}

async function sha256Hex(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseUpsertInput(body: CloudUpsertNoteInput): CloudUpsertNoteInput {
  if (!body.workspaceId || !body.title || !body.markdownBody) {
    throw new Error("workspaceId, title, and markdownBody are required.");
  }

  return {
    workspaceId: body.workspaceId,
    slug: body.slug?.trim() || slugifyExtractionTitle(body.title),
    title: body.title.trim(),
    markdownBody: body.markdownBody,
    frontmatter: safeJsonObject(body.frontmatter),
    noteType: body.noteType ?? "concept",
    folderPath: normalizeFolderPath(body.folderPath),
    sourceCount: body.sourceCount ?? 0,
    url: body.url ?? null,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
    legacyId: body.legacyId ?? null,
    strandRevision: parseStrandRevision(body.strandRevision)
  };
}

function parseDeleteInput(body: CloudDeleteNoteInput): CloudDeleteNoteInput {
  if (!body.workspaceId || !body.slug) {
    throw new Error("workspaceId and slug are required.");
  }

  return {
    workspaceId: body.workspaceId,
    slug: body.slug.trim()
  };
}

async function loadNote(
  admin: ReturnType<typeof requireUser> extends Promise<{ admin: infer T }> ? T : never,
  workspaceId: string,
  slug: string
): Promise<CloudNote> {
  const [{ data: noteRow, error: noteError }, { data: noteLinkRows, error: noteLinkError }] =
    await Promise.all([
      admin
        .from("notes")
        .select(
          "id, workspace_id, slug, title, markdown_body, frontmatter_json, excerpt, note_type, folder_path, source_count, url, created_at, updated_at"
        )
        .eq("workspace_id", workspaceId)
        .eq("slug", slug)
        .single(),
      admin
        .from("note_links")
        .select("source_note_id, target_slug, target_title")
        .eq("workspace_id", workspaceId)
    ]);

  if (noteError || !noteRow) {
    throw noteError ?? new Error("That note could not be found.");
  }

  if (noteLinkError) {
    throw noteLinkError;
  }

  const inboundCountBySlug = buildInboundCountBySlug((noteLinkRows ?? []) as Array<{
    source_note_id: string;
    target_slug: string;
  }>);

  return mapNoteRow(noteRow as NoteRow, inboundCountBySlug);
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
      const slug = url.searchParams.get("slug");
      const workspace = assertWorkspaceAccess(workspaces, workspaceId);

      if (!slug) {
        const [{ data: noteRows, error: notesError }, { data: noteLinkRows, error: noteLinksError }] =
          await Promise.all([
            admin
              .from("notes")
              .select(
                "id, workspace_id, slug, title, markdown_body, frontmatter_json, excerpt, note_type, folder_path, source_count, url, created_at, updated_at"
              )
              .eq("workspace_id", workspace.id)
              .order("updated_at", { ascending: false }),
            admin
              .from("note_links")
              .select("source_note_id, target_slug, target_title")
              .eq("workspace_id", workspace.id)
          ]);

        if (notesError) {
          throw notesError;
        }

        if (noteLinksError) {
          throw noteLinksError;
        }

        const inboundCountBySlug = buildInboundCountBySlug((noteLinkRows ?? []) as Array<{
          source_note_id: string;
          target_slug: string;
        }>);
        const notes = (noteRows ?? []).map((row) => mapNoteRow(row as NoteRow, inboundCountBySlug));

        return new Response(JSON.stringify(notes), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      const note = await loadNote(admin, workspace.id, slug);
      return new Response(JSON.stringify(note), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (request.method === "POST") {
      const parsed = parseUpsertInput(await parseJson<CloudUpsertNoteInput>(request));
      const workspace = assertWorkspaceAccess(workspaces, parsed.workspaceId);
      const nowIso = new Date().toISOString();
      const { data: existingBefore } = await admin
        .from("notes")
        .select("id, markdown_body")
        .eq("workspace_id", workspace.id)
        .eq("slug", parsed.slug)
        .maybeSingle();
      const previousBody =
        existingBefore && typeof (existingBefore as { markdown_body?: string }).markdown_body === "string"
          ? (existingBefore as { markdown_body: string }).markdown_body
          : null;

      await ensureWorkspaceFolderPath(admin, workspace.id, parsed.folderPath ?? "");
      const upsertPayload = {
        workspace_id: workspace.id,
        slug: parsed.slug,
        title: parsed.title,
        markdown_body: parsed.markdownBody,
        frontmatter_json: parsed.frontmatter,
        excerpt: buildNoteExcerpt(parsed.markdownBody),
        note_type: parsed.noteType,
        folder_path: parsed.folderPath,
        source_count: parsed.sourceCount,
        url: parsed.url,
        created_at: parsed.createdAt ?? nowIso,
        updated_at: parsed.updatedAt ?? nowIso,
        legacy_id: parsed.legacyId
      };

      const { data, error } = await admin
        .from("notes")
        .upsert(upsertPayload, { onConflict: "workspace_id,slug" })
        .select(
          "id, workspace_id, slug, title, markdown_body, frontmatter_json, excerpt, note_type, folder_path, source_count, url, created_at, updated_at"
        )
        .single();

      if (error || !data) {
        throw error ?? new Error("Could not save the note.");
      }

      const noteId = (data as NoteRow).id;
      const { error: deleteLinksError } = await admin
        .from("note_links")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("source_note_id", noteId);

      if (deleteLinksError) {
        throw deleteLinksError;
      }

      const linkInserts = buildNoteLinkInserts(noteId, parsed.markdownBody).map((link) => ({
        workspace_id: workspace.id,
        ...link
      }));

      if (linkInserts.length > 0) {
        const { error: insertLinksError } = await admin
          .from("note_links")
          .insert(linkInserts);

        if (insertLinksError) {
          throw insertLinksError;
        }
      }

      const newBody = parsed.markdownBody;
      if (previousBody !== newBody) {
        const newHash = await sha256Hex(newBody);
        const { data: lastRev } = await admin
          .from("note_revisions")
          .select("content_sha256")
          .eq("note_id", noteId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const lastHash =
          lastRev && typeof (lastRev as { content_sha256?: string }).content_sha256 === "string"
            ? (lastRev as { content_sha256: string }).content_sha256
            : null;
        if (lastHash !== newHash) {
          const sr = parsed.strandRevision ?? { actor: "user" as const, sessionId: null };
          let sessionId: string | null = sr.sessionId ?? null;
          if (sessionId) {
            const { data: sessRow } = await admin
              .from("chat_sessions")
              .select("id")
              .eq("workspace_id", workspace.id)
              .eq("id", sessionId)
              .maybeSingle();
            if (!sessRow) {
              sessionId = null;
            }
          }
          const { error: revError } = await admin.from("note_revisions").insert({
            workspace_id: workspace.id,
            note_id: noteId,
            body: newBody,
            actor: sr.actor,
            session_id: sessionId,
            content_sha256: newHash
          });
          if (revError) {
            throw revError;
          }
        }
      }

      const note = await loadNote(admin, workspace.id, parsed.slug ?? slugifyExtractionTitle(parsed.title));

      return new Response(JSON.stringify(note), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (request.method === "DELETE") {
      const parsed = parseDeleteInput(await parseJson<CloudDeleteNoteInput>(request));
      const workspace = assertWorkspaceAccess(workspaces, parsed.workspaceId);

      const { error } = await admin
        .from("notes")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("slug", parsed.slug);

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
        error: error instanceof Error ? error.message : "Could not handle note request."
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
