import type { GraphData, GraphEdge, GraphNode } from "@electron/ipc/types";
import type { ThoughtRecord } from "@electron/ipc/types";

const MAX_THOUGHT_NODES = 28;

function titleFromThought(thought: ThoughtRecord): string {
  const line = thought.content.trim().split(/\n/)[0]?.trim() ?? "";

  if (line.length === 0) {
    return "Thought";
  }

  return line.length > 54 ? `${line.slice(0, 54)}…` : line;
}

/**
 * Merges recent Thoughts into the wiki graph as secondary nodes and lightweight edges to related Strands.
 */
export function mergeThoughtsIntoGraph(base: GraphData, thoughts: ThoughtRecord[]): GraphData {
  const recent = [...thoughts]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_THOUGHT_NODES);

  const strandIds = new Set(base.nodes.map((node) => node.id));

  const thoughtNodes: GraphNode[] = recent.map((thought) => {
    const slug = `thought-${thought.id}`;

    return {
      id: slug,
      slug,
      title: titleFromThought(thought),
      tags: thought.tags.slice(0, 5),
      type: "concept",
      size: 8,
      inboundCount: 0,
      cluster: thought.tags[0],
      graphNodeKind: "thought"
    };
  });

  const extraEdges: GraphEdge[] = [];

  for (const thought of recent) {
    const slug = `thought-${thought.id}`;
    const related = thought.enrichment?.relatedNotes ?? [];

    for (const note of related.slice(0, 3)) {
      if (!strandIds.has(note.slug)) {
        continue;
      }

      extraEdges.push({
        id: `${slug}->${note.slug}`,
        source: slug,
        target: note.slug,
        association: Math.min(1, 0.18 + Math.min(note.score, 24) / 48)
      });
    }
  }

  return {
    nodes: [...base.nodes, ...thoughtNodes],
    edges: [...base.edges, ...extraEdges]
  };
}
