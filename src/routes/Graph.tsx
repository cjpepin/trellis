import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ForceGraph } from "@/components/graph/ForceGraph";
import { NodeTooltip } from "@/components/graph/NodeTooltip";
import { isPaidSubscriptionTier } from "@/lib/chatModels";
import { useGraph } from "@/hooks/useGraph";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import { notesRoutePath } from "@/lib/noteRoutes";
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

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function getSearchRank(
  node: ReturnType<typeof useGraph>["graph"]["nodes"][number],
  query: string
): number {
  const title = node.title.toLowerCase();
  const tags = node.tags.map((tag) => tag.toLowerCase());

  if (title === query) {
    return 0;
  }

  if (tags.some((tag) => tag === query)) {
    return 1;
  }

  if (title.startsWith(query)) {
    return 2;
  }

  if (tags.some((tag) => tag.startsWith(query))) {
    return 3;
  }

  if (title.includes(query)) {
    return 4;
  }

  return 5;
}

export function Graph() {
  const navigate = useNavigate();
  const { mode, graph } = useGraph();
  const [tooltip, setTooltip] = useState<{ title: string; x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const subscriptionTier = useAuthStore((state) => state.subscriptionTier);
  const notes = useWikiStore((state) => state.notes);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
  const setNote = useWikiStore((state) => state.setNote);
  const replaceIndex = useWikiStore((state) => state.replaceIndex);
  const pushToast = useUiStore((state) => state.pushToast);
  const isPreviewMode =
    getActiveWorkspaceId() !== "preview" && !isPaidSubscriptionTier(subscriptionTier);
  const visibleGraph = useMemo(
    () => (isPreviewMode ? buildPreviewGraph(graph) : graph),
    [graph, isPreviewMode]
  );
  const searchResults = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(query);

    if (!normalizedQuery) {
      return [];
    }

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);

    return visibleGraph.nodes
      .filter((node) => {
        const searchableFields = [node.title, ...node.tags].map((value) => value.toLowerCase());
        return terms.every((term) => searchableFields.some((value) => value.includes(term)));
      })
      .sort((left, right) => {
        const rankDifference =
          getSearchRank(left, normalizedQuery) - getSearchRank(right, normalizedQuery);

        if (rankDifference !== 0) {
          return rankDifference;
        }

        return right.inboundCount - left.inboundCount || left.title.localeCompare(right.title);
      })
      .slice(0, 8);
  }, [query, visibleGraph.nodes]);

  useEffect(() => {
    if (focusedNodeId == null) {
      return;
    }

    if (!visibleGraph.nodes.some((node) => node.id === focusedNodeId)) {
      setFocusedNodeId(null);
    }
  }, [focusedNodeId, visibleGraph.nodes]);

  function focusSearchResult(nodeId: string): void {
    setFocusedNodeId(nodeId);
    setQuery("");
  }

  async function handleSelectNode(slug: string): Promise<void> {
    try {
      if (notes.some((note) => note.slug === slug)) {
        setActiveNote(slug);
        navigate(notesRoutePath(slug));
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
        tone: "success",
        noteLinks: [{ label: result.note.title, noteSlug: result.note.slug }]
      });
      navigate(notesRoutePath(result.note.slug));
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not open that note.",
        tone: "warning"
      });
    }
  }

  return (
    <div className="h-full p-6" data-testid="route-graph">
      <section className="trellis-panel relative h-full min-h-0 overflow-hidden">
        <div className="trellis-overlay-surface absolute inset-x-0 top-0 z-10 flex flex-col gap-4 border-b border-trellis-border px-5 py-4 backdrop-blur md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-display text-2xl text-trellis-text">Knowledge Graph</p>
            <p className="mt-1 text-xs text-trellis-muted">
              {isPreviewMode
                ? `Previewing ${visibleGraph.nodes.length} connected notes from this vault.`
                : mode === "clustered"
                ? "Large vault detected. Showing clusters by primary tag."
                : "Notes become nodes. [[Links]] between notes become edges."}
            </p>
            <p className="mt-2 text-xs text-trellis-faint">
              Click any node to open that note in Notes.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-[320px] md:items-end">
            <div className="relative w-full">
              <div className="flex items-center gap-2 rounded-field border border-trellis-border bg-trellis-surface/85 px-3 py-2">
                <Search className="h-4 w-4 text-trellis-faint" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && searchResults[0]) {
                      event.preventDefault();
                      focusSearchResult(searchResults[0].id);
                    }

                    if (event.key === "Escape") {
                      setQuery("");
                    }
                  }}
                  className="w-full bg-transparent text-sm text-trellis-text outline-none placeholder:text-trellis-faint"
                  placeholder="Search graph titles or tags…"
                  aria-label="Search graph nodes"
                />
                {query && (
                  <button
                    type="button"
                    className="rounded-full p-1 text-trellis-faint transition hover:bg-trellis-surface-2 hover:text-trellis-text"
                    aria-label="Clear graph search"
                    onClick={() => setQuery("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {query && (
                <div className="absolute right-0 top-full z-20 mt-2 w-full overflow-hidden rounded-panel border border-trellis-border bg-trellis-surface shadow-[var(--trellis-elevated-shadow)]">
                  {searchResults.length > 0 ? (
                    searchResults.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        className="flex w-full items-start justify-between gap-3 border-b border-trellis-border/70 px-3 py-2 text-left transition last:border-b-0 hover:bg-trellis-surface-2"
                        onClick={() => focusSearchResult(node.id)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-trellis-text">
                            {node.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-trellis-muted">
                            {node.tags.length > 0 ? node.tags.join(" · ") : "No tags"}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-trellis-faint">
                          node
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-sm text-trellis-muted">
                      No nodes match that title or tag.
                    </div>
                  )}
                </div>
              )}
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
        </div>
        <div className="h-full pt-[148px] md:pt-[88px]">
          <ForceGraph
            graph={visibleGraph}
            focusedNodeId={focusedNodeId}
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
