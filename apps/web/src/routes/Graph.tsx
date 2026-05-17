import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ForceGraph } from "@/components/graph/ForceGraph";
import { NodeTooltip } from "@/components/graph/NodeTooltip";
import { appShellPath } from "@/lib/appRoutes";
import { isPaidSubscriptionTier } from "@/lib/chatModels";
import { createVaultStub, listBucketIndex } from "@/lib/cloud/bucket";
import type { AppSettings, GraphData, GraphNode } from "@trellis/contracts";
import { isAppPreviewWorkspace } from "@trellis/contracts";
import { useGraph } from "@/hooks/useGraph";
import { mergeThoughtsIntoGraph } from "@/lib/thoughtGraphOverlay";
import { getActiveBucket } from "@/lib/settings";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { useAuthStore } from "@/store/authStore";
import { useThoughtStore } from "@/store/thoughtStore";
import { useUiStore } from "@/store/uiStore";
import { notesRoutePath } from "@/lib/noteRoutes";
import { useWikiStore } from "@/store/wikiStore";
import { GraphViewportSkeleton } from "@/components/skeletons/WorkspaceDataSkeletons";

function buildPreviewGraph(graph: GraphData) {
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

function getSearchRank(node: GraphNode, query: string): number {
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

interface GraphProps {
  settings: AppSettings;
  workspaceDataPending?: boolean;
}

export function Graph({ settings, workspaceDataPending = false }: GraphProps) {
  const navigate = useNavigate();
  const graph = useGraph();
  const thoughts = useThoughtStore((state) => state.thoughts);
  const hydrateThoughts = useThoughtStore((state) => state.hydrate);
  const vault = getActiveBucket(settings);
  const [tooltip, setTooltip] = useState<{ title: string; x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [visualEmphasis, setVisualEmphasis] = useState<"degree" | "recency">("degree");
  const subscriptionTier = useAuthStore((state) => state.subscriptionTier);
  const notes = useWikiStore((state) => state.notes);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
  const setNote = useWikiStore((state) => state.setNote);
  const replaceIndex = useWikiStore((state) => state.replaceIndex);
  const pushToast = useUiStore((state) => state.pushToast);
  const isPreviewMode =
    !isAppPreviewWorkspace(getActiveWorkspaceId()) && !isPaidSubscriptionTier(subscriptionTier);
  const graphWithThoughts = useMemo(
    () => mergeThoughtsIntoGraph(graph, thoughts),
    [graph, thoughts]
  );

  const visibleGraph = useMemo(
    () => (isPreviewMode ? buildPreviewGraph(graphWithThoughts) : graphWithThoughts),
    [graphWithThoughts, isPreviewMode]
  );

  useEffect(() => {
    void hydrateThoughts(vault.id);
  }, [hydrateThoughts, vault.id]);

  const recencyBySlug = useMemo(() => {
    const now = Date.now();
    const out: Record<string, number> = {};
    for (const note of notes) {
      const t = Date.parse(note.updated);
      if (!Number.isFinite(t)) {
        continue;
      }
      const ageDays = (now - t) / 86_400_000;
      out[note.slug] = Math.max(0, Math.min(1, 1 - Math.min(ageDays, 45) / 45));
    }
    return out;
  }, [notes]);

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
    if (slug.startsWith("thought-")) {
      const thoughtId = slug.slice("thought-".length);

      if (thoughtId.length > 0) {
        navigate(`/thoughts?id=${encodeURIComponent(thoughtId)}`);
      }

      return;
    }

    try {
      if (notes.some((note) => note.slug === slug)) {
        setActiveNote(slug);
        navigate(notesRoutePath(slug));
        return;
      }

      const result = await createVaultStub({
        title: humanizeSlug(slug)
      });
      setNote(result.note);
      setActiveNote(result.note.slug);
      const snapshot = await listBucketIndex();
      replaceIndex({
        notes: snapshot.notes,
        folders: snapshot.folders,
        graph: snapshot.graph
      });
      pushToast({
        title: "Stub Strand created",
        tone: "success",
        noteLinks: [{ label: result.note.title, noteSlug: result.note.slug }]
      });
      navigate(notesRoutePath(result.note.slug));
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not open that Strand.",
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
                ? `Previewing ${visibleGraph.nodes.length} connected Strands from this vault.`
                : "Strands are nodes. [[Links]] shape how ideas connect."}
            </p>
            <p className="mt-2 text-xs text-trellis-faint">
              Click a node to open that Strand. Use the emphasis control to compare link topology with
              recency.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-field border px-3 py-1.5 text-xs transition ${
                  visualEmphasis === "degree"
                    ? "border-trellis-accent/40 bg-trellis-accent/10 text-trellis-text"
                    : "border-trellis-border text-trellis-muted hover:border-trellis-accent/25"
                }`}
                onClick={() => setVisualEmphasis("degree")}
              >
                Links
              </button>
              <button
                type="button"
                className={`rounded-field border px-3 py-1.5 text-xs transition ${
                  visualEmphasis === "recency"
                    ? "border-trellis-accent/40 bg-trellis-accent/10 text-trellis-text"
                    : "border-trellis-border text-trellis-muted hover:border-trellis-accent/25"
                }`}
                onClick={() => setVisualEmphasis("recency")}
              >
                Recency
              </button>
            </div>
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
                onClick={() => navigate(appShellPath("/settings"))}
              >
                Unlock full graph
              </button>
            )}
          </div>
        </div>
        <div className="h-full pt-[148px] md:pt-[88px]">
          {workspaceDataPending ? (
            <GraphViewportSkeleton />
          ) : (
            <ForceGraph
              graph={visibleGraph}
              focusedNodeId={focusedNodeId}
              onHoverNode={setTooltip}
              onSelectNode={(slug) => {
                void handleSelectNode(slug);
              }}
              visualEmphasis={visualEmphasis}
              recencyBySlug={recencyBySlug}
            />
          )}
        </div>
      </section>
      {tooltip && <NodeTooltip title={tooltip.title} x={tooltip.x} y={tooltip.y} />}
    </div>
  );
}
