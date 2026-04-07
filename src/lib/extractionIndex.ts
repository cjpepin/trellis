import type { GraphData } from "@electron/ipc/types";
import type { ExtractionIndexEntry } from "@/lib/api";

export function buildExtractionIndex(graph: GraphData): ExtractionIndexEntry[] {
  const existingEntries = graph.nodes
    .filter((node) => !node.isPlaceholder)
    .map(
      (node) =>
        ({
          slug: node.slug,
          title: node.title,
          tags: node.tags,
          isPlaceholder: false
        }) satisfies ExtractionIndexEntry
    );

  const placeholderEntries = graph.nodes
    .filter((node) => node.isPlaceholder)
    .map(
      (node) =>
        ({
          slug: node.slug,
          title: node.title,
          tags: node.tags,
          isPlaceholder: true
        }) satisfies ExtractionIndexEntry
    );

  return [...existingEntries, ...placeholderEntries];
}
