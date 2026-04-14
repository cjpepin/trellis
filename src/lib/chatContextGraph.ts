import type { GraphData, GraphEdge, GraphNode, MessageRecord, NoteSummary } from "@electron/ipc/types";
import { extractWikiLinkTitles, resolveReferencedNoteSlug } from "@/lib/noteReferences";

/**
 * Collects wiki note slugs that grounded this chat: composer pins, [[wiki links]] in messages,
 * and grounded strand entries from assistant replyContext (same filter as “What informed this reply”).
 */
export function collectChatContextNoteSlugs(input: {
  messages: MessageRecord[];
  notes: NoteSummary[];
  pinnedWikiNotes: Array<{ slug: string; title: string }>;
}): string[] {
  const slugs = new Set<string>();

  for (const pinned of input.pinnedWikiNotes) {
    slugs.add(pinned.slug);
  }

  for (const message of input.messages) {
    if (message.replyContext) {
      for (const item of message.replyContext.items) {
        if (item.kind === "note" && item.slug) {
          slugs.add(item.slug);
        }
      }
    }

    for (const title of extractWikiLinkTitles(message.content)) {
      const slug = resolveReferencedNoteSlug(title, input.notes);

      if (slug) {
        slugs.add(slug);
      }
    }
  }

  return [...slugs];
}

/** Induced subgraph: only context notes and edges whose endpoints are both in that set. */
export function buildContextSubgraph(full: GraphData, contextSlugs: string[]): GraphData {
  const want = new Set(contextSlugs);
  const nodes: GraphNode[] = full.nodes.filter((node) => want.has(node.slug));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = full.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );

  return { nodes, edges };
}
