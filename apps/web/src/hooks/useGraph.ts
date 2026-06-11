import type { GraphData } from "@trellis/contracts";
import { useWikiStore } from "@/store/wikiStore";

/**
 * Wiki graph for the active vault: one node per note, edges from [[wiki links]].
 * Large note sets render fully so the graph stays legible; pan/zoom handles density.
 */
export function useGraph(): GraphData {
  return useWikiStore((state) => state.graph);
}
