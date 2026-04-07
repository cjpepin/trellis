import { useMemo } from "react";
import { useWikiStore } from "@/store/wikiStore";

export function useGraph() {
  const graph = useWikiStore((state) => state.graph);

  return useMemo(() => {
    if (graph.nodes.length <= 500) {
      return {
        mode: "full" as const,
        graph
      };
    }

    const clusters = new Map<
      string,
      {
        id: string;
        count: number;
      }
    >();

    for (const node of graph.nodes) {
      const key = node.cluster || "untagged";
      const existing = clusters.get(key);

      if (existing) {
        existing.count += 1;
      } else {
        clusters.set(key, {
          id: key,
          count: 1
        });
      }
    }

    return {
      mode: "clustered" as const,
      graph: {
        nodes: [...clusters.entries()].map(([cluster, data]) => ({
          id: cluster,
          slug: cluster,
          title: cluster,
          tags: [cluster],
          type: "synthesis" as const,
          size: 18 + Math.min(data.count, 30),
          inboundCount: data.count,
          cluster
        })),
        edges: []
      }
    };
  }, [graph]);
}

