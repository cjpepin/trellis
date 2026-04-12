import type { GraphData } from "@electron/ipc/types";
import { useWikiStore } from "@/store/wikiStore";

/**
 * Wiki graph for the active vault: one node per note, edges from [[wiki links]].
 * Large vaults render fully so the graph stays legible; pan/zoom handles density.
 */
export function useGraph(): GraphData {
  return useWikiStore((state) => state.graph);
}
