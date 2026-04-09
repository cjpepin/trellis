import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ForceGraph } from "@/components/graph/ForceGraph";
import { NodeTooltip } from "@/components/graph/NodeTooltip";
import { useGraph } from "@/hooks/useGraph";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";

function buildPreviewGraph(graph: ReturnType<typeof useGraph>["graph"]) {
  const previewNodes = [...graph.nodes]
    .sort((left, right) => right.inboundCount - left.inboundCount || right.size - left.size)
    .slice(0, 18);
  const nodeIds = new Set(previewNodes.map((node) => node.id));

  return {
    nodes: previewNodes,
    edges: graph.edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .slice(0, 36)
  };
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function Graph() {
  const navigate = useNavigate();
  const { mode, graph } = useGraph();
  const [tooltip, setTooltip] = useState<{ title: string; x: number; y: number } | null>(null);
  const subscriptionTier = useAuthStore((state) => state.subscriptionTier);
  const notes = useWikiStore((state) => state.notes);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
  const setNote = useWikiStore((state) => state.setNote);
  const replaceIndex = useWikiStore((state) => state.replaceIndex);
  const pushToast = useUiStore((state) => state.pushToast);
  const isPreviewMode =
    getActiveWorkspaceId() !== "preview" && subscriptionTier !== "pro";
  const visibleGraph = useMemo(
    () => (isPreviewMode ? buildPreviewGraph(graph) : graph),
    [graph, isPreviewMode]
  );

  async function handleSelectNode(slug: string): Promise<void> {
    try {
      if (notes.some((note) => note.slug === slug)) {
        setActiveNote(slug);
        navigate(`/wiki?note=${encodeURIComponent(slug)}`);
        return;
      }

      const result = await window.trellis.vault.createStub({
        title: humanizeSlug(slug)
      });
      setNote(result.note);
      setActiveNote(result.note.slug);
      const snapshot = await window.trellis.vault.listIndex();
      replaceIndex({
        notes: snapshot.notes,
        folders: snapshot.folders,
        graph: snapshot.graph
      });
      pushToast({
        title: "Stub note created",
        tone: "success"
      });
      navigate(`/wiki?note=${encodeURIComponent(result.note.slug)}`);
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not open that note.",
        tone: "warning"
      });
    }
  }

  return (
    <div className="h-full p-6">
      <section className="trellis-panel relative h-full min-h-0 overflow-hidden">
        <div className="trellis-overlay-surface absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-trellis-border px-5 py-4 backdrop-blur">
          <div>
            <p className="font-display text-2xl text-trellis-text">Knowledge Graph</p>
            <p className="mt-1 text-xs text-trellis-muted">
              {isPreviewMode
                ? `Previewing ${visibleGraph.nodes.length} connected notes from this vault.`
                : mode === "clustered"
                ? "Large vault detected. Showing clusters by primary tag."
                : "Notes become nodes. Wiki links become edges."}
            </p>
            <p className="mt-2 text-xs text-trellis-faint">
              Click any node to open that note in the wiki.
            </p>
          </div>
          {isPreviewMode && (
            <button
              type="button"
              className="trellis-accent-button rounded-field border px-4 py-2 text-sm transition"
              onClick={() => navigate("/settings")}
            >
              Unlock full graph
            </button>
          )}
        </div>
        <div className="h-full pt-[72px]">
          <ForceGraph
            graph={visibleGraph}
            onHoverNode={setTooltip}
            onSelectNode={(slug) => {
              void handleSelectNode(slug);
            }}
          />
        </div>
      </section>
      {tooltip && <NodeTooltip title={tooltip.title} x={tooltip.x} y={tooltip.y} />}
    </div>
  );
}
