import type { GraphData } from "@trellis/contracts";
import type { ExtractionIndexEntry } from "@trellis/shared/extraction/contracts";

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
