import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  assertWorkspaceAccess,
  buildInboundCountBySlug,
  ensureDefaultWorkspace,
  safeJsonObject
} from "../_shared/cloud.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";
import {
  buildWikiNoteIndexContent,
  WIKI_NOTE_INDEX_MEMORY_TITLE
} from "../../../shared/chat/bucketIndex.ts";
import {
  extractWikiLinkTitles,
  normalizeTitleKey,
  slugifyExtractionTitle
} from "../../../shared/extraction/wikiLinks.ts";
import {
  lexicalNoteScore,
  relatedNotesRetrievalDefaultLimit,
  takeFirstSentence,
  tokenizeRetrieval,
  truncateForContext,
  type LexicalNoteRow
} from "../_shared/retrievalLexical.ts";
import {
  CHAT_GRAPH_NEIGHBOR_LIMIT,
  CHAT_GRAPH_SEED_LIMIT,
  CHAT_VAULT_RECENT_SLUGS_LIMIT
} from "../../../shared/chat/vaultContextLimits.ts";
import { oneHopWikiNeighborSlugs, pickSeedsForGraphExpansion } from "../../../shared/chat/wikiGraph.ts";

const maxContextRefs = 8;
const maxContextChars = 18_000;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatContextReference {
  type: "note" | "memory";
  title: string;
  excerpt: string;
  content: string;
  tags?: string[];
  slug?: string;
  linkedNoteSlug?: string | null;
  isExplicitMatch?: boolean;
}

interface ChatRetrievalRequest {
  workspaceId: string;
  mode: "auto" | "off" | "local";
  messages: ChatMessage[];
  sessionTitle?: string | null;
  activeNoteSlug?: string | null;
  currentSessionId?: string | null;
  pinnedNoteSlugs?: string[];
}

interface NoteListRow {
  id: string;
  slug: string;
  title: string;
  markdown_body: string;
  frontmatter_json: Record<string, unknown> | null;
  excerpt: string;
  note_type: string;
  folder_path: string;
  updated_at: string;
}

function tagsFromFrontmatter(raw: Record<string, unknown> | null): string[] {
  const tags = raw?.tags;
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags.filter((tag): tag is string => typeof tag === "string");
}

function noteAllowedForMode(tags: string[], mode: ChatRetrievalRequest["mode"]): boolean {
  if (mode === "local") {
    return true;
  }
  return !tags.some((tag) => tag.trim().toLowerCase() === "local-only");
}

function buildQuery(
  input: ChatRetrievalRequest,
  explicitSlugs: string[],
  activeNoteTitle?: string | null
): string {
  const messageCorpus = input.messages.slice(-4).map((message) => message.content).join("\n\n");
  const explicitCorpus = explicitSlugs.join(" ");

  return [input.sessionTitle ?? "", activeNoteTitle ?? "", explicitCorpus, messageCorpus]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function resolveExplicitSlugs(messages: ChatMessage[], notes: Array<{ slug: string; title: string }>): string[] {
  const byTitle = new Map(notes.map((note) => [normalizeTitleKey(note.title), note.slug]));
  const bySlug = new Map(notes.map((note) => [note.slug, note.slug]));

  return [
    ...new Set(
      messages.flatMap((message) =>
        extractWikiLinkTitles(message.content)
          .map(
            (title) =>
              byTitle.get(normalizeTitleKey(title)) ?? bySlug.get(slugifyExtractionTitle(title))
          )
          .filter((slug): slug is string => Boolean(slug))
      )
    )
  ];
}

function hasBucketOrganizeIntent(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }
  return (
    /\b(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?folder\b/i.test(trimmed) ||
    /\borganize\s+(?:my\s+)?(?:notes?|vault|wiki)\b/i.test(trimmed) ||
    /\b(?:move|put)\s+.+\s+(?:into|in|to|under)\s+(?:a\s+)?(?:new\s+)?folder\b/i.test(trimmed)
  );
}

function buildNoteReference(input: {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  isExplicitMatch?: boolean;
}): ChatContextReference {
  return {
    type: "note",
    slug: input.slug,
    title: input.title,
    excerpt: takeFirstSentence(input.content, 160),
    content: truncateForContext(input.content, 1_400),
    tags: input.tags,
    isExplicitMatch: input.isExplicitMatch
  };
}

function buildMemoryReference(input: {
  title: string;
  content: string;
  linkedNoteSlug: string | null;
  contentMaxChars?: number;
}): ChatContextReference {
  const contentMaxChars = input.contentMaxChars ?? 750;
  return {
    type: "memory",
    title: input.title,
    excerpt: takeFirstSentence(input.content, 140),
    content: truncateForContext(input.content, contentMaxChars),
    linkedNoteSlug: input.linkedNoteSlug
  };
}

function referenceWeight(reference: ChatContextReference): number {
  if (reference.type === "note" && reference.isExplicitMatch) {
    return 100;
  }
  if (reference.type === "note" && reference.slug) {
    return 40;
  }
  return 20;
}

function referenceCharBudget(reference: ChatContextReference): number {
  return reference.title.length + reference.excerpt.length + reference.content.length;
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
    assertMaxJsonBodyBytes(request);
    const raw = await readJsonBodyWithByteLimit(request);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const mode = body.mode === "off" || body.mode === "local" || body.mode === "auto" ? body.mode : null;
    const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];

    if (!workspaceId || !mode || messages.length === 0) {
      throw new Error("workspaceId, mode, and messages are required.");
    }

    if (mode === "off") {
      return new Response(JSON.stringify({ mode, references: [], sourceLabels: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const workspaces = await ensureDefaultWorkspace(admin, user.id);
    const workspace = assertWorkspaceAccess(workspaces, workspaceId);

    const [{ data: noteRows, error: notesError }, { data: linkRows, error: linksError }] =
      await Promise.all([
        admin
          .from("notes")
          .select("id, slug, title, markdown_body, frontmatter_json, excerpt, note_type, folder_path, updated_at")
          .eq("workspace_id", workspace.id),
        admin
          .from("note_links")
          .select("source_note_id, target_slug")
          .eq("workspace_id", workspace.id)
      ]);

    if (notesError) {
      throw notesError;
    }
    if (linksError) {
      throw linksError;
    }

    const inboundCountBySlug = buildInboundCountBySlug((linkRows ?? []) as Array<{
      source_note_id: string;
      target_slug: string;
    }>);

    const notesList = (noteRows ?? []).map((row) => {
      const r = row as NoteListRow;
      const tags = tagsFromFrontmatter(safeJsonObject(r.frontmatter_json));
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        markdown_body: r.markdown_body,
        excerpt: r.excerpt,
        folder_path: r.folder_path,
        tags,
        inboundCount: inboundCountBySlug.get(r.slug) ?? 0,
        updatedAt: (() => {
          const t = new Date(r.updated_at).getTime();
          return Number.isFinite(t) ? t : 0;
        })()
      };
    });

    const activeNoteTitle =
      typeof body.activeNoteSlug === "string" && body.activeNoteSlug.length > 0
        ? notesList.find((n) => n.slug === body.activeNoteSlug)?.title ?? null
        : null;

    const wikiLinkSlugs = resolveExplicitSlugs(messages, notesList);
    const pinnedSlugs = Array.isArray(body.pinnedNoteSlugs)
      ? (body.pinnedNoteSlugs as string[]).filter((s) => typeof s === "string" && s.length > 0)
      : [];
    const recentVaultTouchedSlugs = [...notesList]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, CHAT_VAULT_RECENT_SLUGS_LIMIT)
      .map((n) => n.slug);
    const explicitSlugs = [...new Set([...wikiLinkSlugs, ...pinnedSlugs, ...recentVaultTouchedSlugs])];
    const idToSlug = new Map(notesList.map((n) => [n.id, n.slug] as const));
    const validSlugSet = new Set(notesList.map((n) => n.slug));

    const sessionTitle = typeof body.sessionTitle === "string" ? body.sessionTitle : null;
    const query = buildQuery(
      {
        workspaceId,
        mode,
        messages,
        sessionTitle,
        activeNoteSlug: typeof body.activeNoteSlug === "string" ? body.activeNoteSlug : null,
        currentSessionId: typeof body.currentSessionId === "string" ? body.currentSessionId : null,
        pinnedNoteSlugs: pinnedSlugs
      },
      explicitSlugs,
      activeNoteTitle
    );

    const notesEligibleForCloud = notesList.filter((note) => noteAllowedForMode(note.tags, mode));

    const lexicalRows: LexicalNoteRow[] = notesEligibleForCloud.map((n) => ({
      slug: n.slug,
      title: n.title,
      markdown_body: n.markdown_body,
      tags: n.tags
    }));

    const scored = lexicalRows
      .map((row) => ({ row, score: lexicalNoteScore(query, row) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, relatedNotesRetrievalDefaultLimit);

    const explicitSet = new Set(explicitSlugs);
    const references: ChatContextReference[] = [];

    for (const { row } of scored) {
      if (!noteAllowedForMode(row.tags, mode)) {
        continue;
      }
      references.push(
        buildNoteReference({
          slug: row.slug,
          title: row.title,
          content: row.markdown_body,
          tags: row.tags,
          isExplicitMatch: explicitSet.has(row.slug)
        })
      );
    }

    const slugsFromLex = new Set(scored.map((s) => s.row.slug));
    const pinnedSlugSet = new Set(pinnedSlugs);

    for (const slug of pinnedSlugSet) {
      if (slugsFromLex.has(slug)) {
        continue;
      }
      const meta = notesList.find((n) => n.slug === slug);
      if (!meta || !noteAllowedForMode(meta.tags, mode)) {
        continue;
      }
      references.push(
        buildNoteReference({
          slug: meta.slug,
          title: meta.title,
          content: meta.markdown_body,
          tags: meta.tags,
          isExplicitMatch: true
        })
      );
    }

    const linkEdges = (linkRows ?? [])
      .map((row) => {
        const r = row as { source_note_id: string; target_slug: string };
        const source = idToSlug.get(r.source_note_id);
        if (!source) {
          return null;
        }
        return { source, target: r.target_slug };
      })
      .filter((e): e is { source: string; target: string } => e !== null);

    const graphSeeds = pickSeedsForGraphExpansion({
      explicitSlugs: [...new Set([...wikiLinkSlugs, ...pinnedSlugs])],
      recentSlugs: recentVaultTouchedSlugs,
      topRetrievalSlugs: scored.map((s) => s.row.slug),
      maxSeeds: CHAT_GRAPH_SEED_LIMIT
    });
    const graphNeighborSlugs = oneHopWikiNeighborSlugs(graphSeeds, linkEdges, {
      validSlugs: validSlugSet,
      maxResults: CHAT_GRAPH_NEIGHBOR_LIMIT
    });
    const preferredSlugs = [
      ...new Set(
        [
          ...pinnedSlugs,
          typeof body.activeNoteSlug === "string" ? body.activeNoteSlug : "",
          ...explicitSlugs,
          ...graphNeighborSlugs
        ].filter(Boolean) as string[]
      )
    ];

    for (const slug of new Set(graphNeighborSlugs)) {
      if (slugsFromLex.has(slug) || pinnedSlugSet.has(slug)) {
        continue;
      }
      const meta = notesList.find((n) => n.slug === slug);
      if (!meta || !noteAllowedForMode(meta.tags, mode)) {
        continue;
      }
      references.push(
        buildNoteReference({
          slug: meta.slug,
          title: meta.title,
          content: meta.markdown_body,
          tags: meta.tags,
          isExplicitMatch: false
        })
      );
    }

    const { data: memoryRows, error: memoryError } = await admin
      .from("memory_items")
      .select("kind, content, linked_note_slug")
      .eq("workspace_id", workspace.id)
      .limit(80);

    if (memoryError) {
      throw memoryError;
    }

    const queryTokens = new Set(tokenizeRetrieval(query));
    for (const rawMem of memoryRows ?? []) {
      const mem = rawMem as { kind: string; content: string; linked_note_slug: string | null };
      const memTokens = tokenizeRetrieval(mem.content);
      const overlap = memTokens.filter((t) => queryTokens.has(t)).length;
      if (overlap === 0 && queryTokens.size > 0) {
        continue;
      }
      if (
        mode !== "local" &&
        mem.linked_note_slug &&
        !noteAllowedForMode(
          notesList.find((n) => n.slug === mem.linked_note_slug)?.tags ?? [],
          mode
        )
      ) {
        continue;
      }
      references.push(
        buildMemoryReference({
          title: mem.kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          content: mem.content,
          linkedNoteSlug: mem.linked_note_slug
        })
      );
    }

    const wikiIndexReference: ChatContextReference | null =
      notesEligibleForCloud.length === 0
        ? null
        : buildMemoryReference({
            title: WIKI_NOTE_INDEX_MEMORY_TITLE,
            content: buildWikiNoteIndexContent(
              notesEligibleForCloud.map((note) => ({
                slug: note.slug,
                title: note.title,
                tags: note.tags,
                folderPath: note.folder_path,
                inboundCount: note.inboundCount,
                excerpt: note.excerpt
              })),
              { maxChars: 10_500 }
            ),
            linkedNoteSlug: null,
            contentMaxChars: 12_000
          });

    const latestUser = [...messages].reverse().find((m) => m.role === "user" && m.content.trim().length > 0);
    const bucketOrganizeHint =
      latestUser && hasBucketOrganizeIntent(latestUser.content)
        ? buildMemoryReference({
            title: "Trellis wiki actions",
            content: [
              "The user asked to organize notes or folders in Trellis.",
              "On cloud workspaces, folder and note moves are supported from the Wiki UI; confirm what they want and keep answers consistent with Trellis."
            ].join("\n"),
            linkedNoteSlug: null
          })
        : null;

    const ranked = references
      .map((reference) => ({
        reference,
        score:
          referenceWeight(reference) +
          (reference.type === "note" && reference.slug && preferredSlugs.includes(reference.slug) ? 30 : 0)
      }))
      .sort((left, right) => {
        const leftPin =
          left.reference.type === "note" && left.reference.slug && pinnedSlugSet.has(left.reference.slug);
        const rightPin =
          right.reference.type === "note" && right.reference.slug && pinnedSlugSet.has(right.reference.slug);
        if (leftPin !== rightPin) {
          return leftPin ? -1 : 1;
        }
        return right.score - left.score;
      });

    const selected: ChatContextReference[] = [];
    let charCount = 0;

    if (wikiIndexReference) {
      selected.push(wikiIndexReference);
      charCount += referenceCharBudget(wikiIndexReference);
    }

    if (bucketOrganizeHint) {
      selected.push(bucketOrganizeHint);
      charCount += referenceCharBudget(bucketOrganizeHint);
    }

    for (const candidate of ranked) {
      if (selected.length >= maxContextRefs) {
        break;
      }
      const referenceChars = referenceCharBudget(candidate.reference);
      if (selected.length > 0 && charCount + referenceChars > maxContextChars) {
        continue;
      }
      if (
        candidate.reference.type === "note" &&
        selected.some(
          (reference) =>
            reference.type === "note" && reference.slug && reference.slug === candidate.reference.slug
        )
      ) {
        continue;
      }
      selected.push(candidate.reference);
      charCount += referenceChars;
    }

    const sourceLabels = [
      wikiIndexReference ? "Wiki index" : null,
      selected.some((reference) => reference.type === "note") ? "Saved notes" : null,
      selected.some(
        (reference) => reference.type === "memory" && reference.title !== WIKI_NOTE_INDEX_MEMORY_TITLE
      )
        ? "Private memory"
        : null
    ].filter((value): value is string => Boolean(value));

    return new Response(JSON.stringify({ mode, references: selected, sourceLabels }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Chat retrieval failed."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
