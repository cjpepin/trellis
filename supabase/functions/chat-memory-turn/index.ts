import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { assertWorkspaceAccess, ensureDefaultWorkspace } from "../_shared/cloud.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";
import {
  buildMemoryTurnCandidate,
  findExistingMemoryMatch,
  type MemoryReferenceLike,
  type MemoryTurnMessage
} from "../../../shared/chat/memoryTurnCandidate.ts";

function parseReferences(raw: unknown): MemoryReferenceLike[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item): MemoryReferenceLike | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const r = item as Record<string, unknown>;
      const type = r.type === "note" || r.type === "memory" ? r.type : null;
      if (!type) {
        return null;
      }
      const slug = typeof r.slug === "string" ? r.slug : undefined;
      const linkedNoteSlug =
        typeof r.linkedNoteSlug === "string"
          ? r.linkedNoteSlug
          : r.linkedNoteSlug === null
            ? null
            : undefined;
      return { type, slug, linkedNoteSlug };
    })
    .filter((x): x is MemoryReferenceLike => x !== null);
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
    const messagesRaw = body.messages;

    if (!workspaceId || !Array.isArray(messagesRaw)) {
      throw new Error("workspaceId and messages are required.");
    }

    const workspace = assertWorkspaceAccess(workspaces, workspaceId);
    const references = parseReferences(body.references);

    const messages: MemoryTurnMessage[] = (messagesRaw as unknown[])
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
      .filter((m): m is MemoryTurnMessage => m !== null);

    const candidate = buildMemoryTurnCandidate(messages, references);

    if (!candidate) {
      return new Response(JSON.stringify({ ok: true, updated: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: existingRows, error: listError } = await admin
      .from("memory_items")
      .select("id, kind, content, linked_note_slug, source_message_ids, confidence")
      .eq("workspace_id", workspace.id)
      .eq("kind", candidate.kind);

    if (listError) {
      throw listError;
    }

    const existing = (existingRows ?? []) as Array<{
      id: string;
      kind: string;
      content: string;
      linked_note_slug: string | null;
      source_message_ids: unknown;
      confidence: number;
    }>;

    const match = findExistingMemoryMatch(
      existing.map((row) => ({
        id: row.id,
        kind: row.kind,
        content: row.content,
        linked_note_slug: row.linked_note_slug
      })),
      candidate
    );

    const nowIso = new Date().toISOString();
    const mergedIds = (rawIds: unknown): string[] => {
      if (!Array.isArray(rawIds)) {
        return [];
      }
      return rawIds.filter((id): id is string => typeof id === "string");
    };

    if (match) {
      const row = existing.find((r) => r.id === match.id);
      const prevIds = row ? mergedIds(row.source_message_ids) : [];
      const nextIds = [...new Set([...prevIds, ...candidate.sourceMessageIds])];
      const nextContent =
        candidate.content.length >= match.content.length ? candidate.content : match.content;
      const nextSlug = candidate.linkedNoteSlug ?? match.linked_note_slug;
      const nextConfidence = Math.max(row?.confidence ?? candidate.confidence, candidate.confidence);

      const { error: upError } = await admin
        .from("memory_items")
        .update({
          content: nextContent,
          source_message_ids: nextIds,
          linked_note_slug: nextSlug,
          confidence: nextConfidence,
          updated_at: nowIso
        })
        .eq("id", match.id)
        .eq("workspace_id", workspace.id);

      if (upError) {
        throw upError;
      }

      return new Response(JSON.stringify({ ok: true, updated: true, id: match.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: inserted, error: insError } = await admin
      .from("memory_items")
      .insert({
        workspace_id: workspace.id,
        kind: candidate.kind,
        content: candidate.content,
        source_message_ids: candidate.sourceMessageIds,
        linked_note_slug: candidate.linkedNoteSlug,
        confidence: candidate.confidence,
        created_at: nowIso,
        updated_at: nowIso
      })
      .select("id")
      .single();

    if (insError) {
      throw insError;
    }

    return new Response(
      JSON.stringify({ ok: true, updated: true, id: (inserted as { id: string }).id }),
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
        error: error instanceof Error ? error.message : "Could not save memory."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
