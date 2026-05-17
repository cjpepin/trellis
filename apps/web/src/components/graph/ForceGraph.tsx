import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { GraphData, GraphEdge } from "@trellis/contracts";

interface Props {
  graph: GraphData;
  focusedNodeId?: string | null;
  onSelectNode: (slug: string) => void;
  onHoverNode: (payload: { title: string; x: number; y: number } | null) => void;
  /** `degree`: emphasize wikilink topology (default). `recency`: emphasize recently updated Strands. */
  visualEmphasis?: "degree" | "recency";
  /** Slug → 0–1 score (newer = higher). Used when `visualEmphasis` is `recency`. */
  recencyBySlug?: Record<string, number>;
}

type SimNode = d3.SimulationNodeDatum & {
  id: string;
  slug: string;
  title: string;
  size: number;
  /** Inbound wiki links; drives size and fill emphasis in the graph view. */
  inboundCount?: number;
  cluster?: string;
  isPlaceholder?: boolean;
  graphNodeKind?: "note" | "thought";
};

type SimLink = d3.SimulationLinkDatum<SimNode> &
  Pick<GraphEdge, "association"> & {
    id: string;
  };

const LABEL_ZOOM_THRESHOLD = 0.42;

function defaultAssociation(edge: GraphEdge): number {
  return typeof edge.association === "number" ? edge.association : 0.35;
}

function linkDistance(association: number): number {
  const minD = 38;
  const maxD = 210;
  const a = Math.max(0, Math.min(1, association));
  return minD + (1 - a) * (maxD - minD);
}

function linkStrength(association: number): number {
  const a = Math.max(0, Math.min(1, association));
  /** Slightly softer links so initial layout spreads without over-tight figure-eight folds on dense graphs. */
  return 0.04 + a * 0.28;
}

const UNCLUSTERED = "__unclustered__";

/** Inclusive cap: degrees above this map to the top of the palette (keeps outliers from flattening the ramp). */
const GRAPH_CONNECTION_COLOR_MAX_DEGREE = 50;

/**
 * Piecewise theme ramp: Trellis tokens only. Stops move from muted surface-bound accent (few links) through
 * core accent, a gentle success-tinted band, then brighter hover tones — so themes like default (amber) and
 * ocean (cyan) shift hue slowly without relying on `--trellis-warning` where it duplicates `--trellis-accent`.
 */
const THEME_GRAPH_FILL_STOPS = [
  "color-mix(in srgb, var(--trellis-accent-surface) 68%, var(--trellis-accent-dim))",
  "color-mix(in srgb, var(--trellis-accent-surface) 36%, var(--trellis-accent-dim))",
  "color-mix(in srgb, var(--trellis-accent-dim) 44%, var(--trellis-accent))",
  "color-mix(in srgb, var(--trellis-accent) 62%, var(--trellis-success))",
  "color-mix(in srgb, var(--trellis-accent) 36%, var(--trellis-success))",
  "color-mix(in srgb, var(--trellis-success) 40%, var(--trellis-accent-hover))",
  "color-mix(in srgb, var(--trellis-node-hover) 52%, color-mix(in srgb, var(--trellis-accent-hover) 55%, var(--trellis-success)))"
] as const;

const THEME_GRAPH_STROKE_STOPS = [
  "color-mix(in srgb, var(--trellis-accent-dim) 58%, var(--trellis-accent-surface))",
  "color-mix(in srgb, var(--trellis-accent-dim) 42%, var(--trellis-accent))",
  "color-mix(in srgb, var(--trellis-accent-dim) 28%, var(--trellis-accent))",
  "color-mix(in srgb, var(--trellis-accent) 55%, var(--trellis-success))",
  "color-mix(in srgb, var(--trellis-success) 48%, var(--trellis-accent))",
  "color-mix(in srgb, var(--trellis-success) 36%, var(--trellis-accent-hover))",
  "color-mix(in srgb, var(--trellis-accent-hover) 44%, color-mix(in srgb, var(--trellis-node-hover) 50%, var(--trellis-success)))"
] as const;

/** Blend adjacent theme stops; nested `color-mix` keeps transitions smooth. */
function themeGraphPiecewiseMix(t: number, stops: readonly string[]): string {
  const n = stops.length;
  if (n === 0) {
    return "var(--trellis-accent)";
  }
  if (n === 1) {
    return stops[0] ?? "var(--trellis-accent)";
  }
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (n - 1);
  const i = Math.min(Math.floor(scaled), n - 2);
  const u = scaled - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return `color-mix(in srgb, ${a} ${(1 - u) * 100}%, ${b})`;
}

function connectionSpectrumFill(t: number): string {
  return themeGraphPiecewiseMix(t, THEME_GRAPH_FILL_STOPS);
}

function connectionSpectrumStroke(t: number): string {
  return themeGraphPiecewiseMix(t, THEME_GRAPH_STROKE_STOPS);
}

function clusterKey(node: Pick<SimNode, "cluster">): string {
  const c = node.cluster?.trim();
  return c && c.length > 0 ? c : UNCLUSTERED;
}

/**
 * When several tag clusters exist, seed nodes on a ring and return targets for cluster forces.
 * Single- or no-cluster graphs keep the legacy spiral so small graphs behave as before.
 */
function seedNodesForLayout(
  nodes: SimNode[],
  width: number,
  height: number
): {
  clusterTarget: Map<string, { x: number; y: number }>;
  useClusterForces: boolean;
} {
  const cx = width / 2;
  const cy = height / 2;
  const keys = [...new Set(nodes.map((n) => clusterKey(n)))].sort((a, b) => a.localeCompare(b));
  const useClusterForces = keys.length >= 2 && keys.length <= 48;

  const clusterTarget = new Map<string, { x: number; y: number }>();
  const k = keys.length;
  const ringR = Math.min(width, height) * (k > 14 ? 0.38 : 0.32);

  keys.forEach((key, i) => {
    const angle = (i / k) * Math.PI * 2 - Math.PI / 2;
    clusterTarget.set(key, {
      x: cx + Math.cos(angle) * ringR,
      y: cy + Math.sin(angle) * ringR
    });
  });

  const spread = Math.min(width, height) * 0.48;

  if (!useClusterForces) {
    nodes.forEach((node, index) => {
      const t = index / Math.max(nodes.length, 1);
      const angle = t * Math.PI * 2 * 11;
      const r = 16 + spread * Math.sqrt(t);
      node.x = cx + Math.cos(angle) * r;
      node.y = cy + Math.sin(angle) * r;
    });
    return { clusterTarget, useClusterForces: false };
  }

  const jitter = Math.min(width, height) * 0.052;
  nodes.forEach((node, index) => {
    const key = clusterKey(node);
    const target = clusterTarget.get(key) ?? { x: cx, y: cy };
    const phase = (index * 12.9898) % (Math.PI * 2);
    const jr = jitter * (0.32 + (index % 7) * 0.1);
    node.x = target.x + Math.cos(phase) * jr;
    node.y = target.y + Math.sin(phase) * jr;
  });

  return { clusterTarget, useClusterForces: true };
}

export function ForceGraph({
  graph,
  focusedNodeId = null,
  onSelectNode,
  onHoverNode,
  visualEmphasis = "degree",
  recencyBySlug = {}
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const onHoverNodeRef = useRef(onHoverNode);
  const focusedNodeIdRef = useRef<string | null>(focusedNodeId);
  const refreshVisualStateRef = useRef<(() => void) | null>(null);
  const focusNodeInViewRef = useRef<((nodeId: string | null) => void) | null>(null);
  const zoomScaleRef = useRef(1);

  onSelectNodeRef.current = onSelectNode;
  onHoverNodeRef.current = onHoverNode;
  focusedNodeIdRef.current = focusedNodeId;

  function getLinkNodeId(node: string | number | SimNode): string {
    if (typeof node === "string") {
      return node;
    }

    if (typeof node === "number") {
      return String(node);
    }

    return node.id;
  }

  useEffect(() => {
    if (!svgRef.current) {
      return;
    }

    const svgElement = svgRef.current;
    const svg = d3.select(svgElement);
    const width = svgRef.current.clientWidth || 960;
    const height = svgRef.current.clientHeight || 640;

    /** Map pointer to graph coordinates (matches node x/y under svg zoom). */
    function graphPointerXY(event: MouseEvent): [number, number] {
      return d3.zoomTransform(svgElement).invert(d3.pointer(event, svgElement));
    }

    svg.selectAll("*").remove();

    if (graph.nodes.length === 0) {
      const group = svg
        .append("g")
        .attr("transform", `translate(${width / 2}, ${height / 2})`);

      group
        .append("circle")
        .attr("r", 42)
        .attr("fill", "rgba(200, 169, 110, 0.14)")
        .attr("stroke", "rgba(200, 169, 110, 0.45)")
        .attr("stroke-width", 1.5);

      group
        .append("text")
        .text("Chat compounds into Strands — links appear as you go")
        .attr("fill", "var(--trellis-text)")
        .attr("text-anchor", "middle")
        .attr("font-size", 14)
        .attr("dy", 72);

      return;
    }

    const nodeCount = graph.nodes.length;
    const largeGraph = nodeCount > 140;
    const nodes: SimNode[] = graph.nodes.map((node) => ({ ...node }));

    const outboundById = new Map<string, number>();
    for (const edge of graph.edges) {
      outboundById.set(edge.source, (outboundById.get(edge.source) ?? 0) + 1);
    }

    const realNodes = nodes.filter((n) => !n.isPlaceholder);

    function totalDegree(n: SimNode): number {
      return (n.inboundCount ?? 0) + (outboundById.get(n.id) ?? 0);
    }

    /** Normalize against this graph's degree range so small graphs still use the full ramp (global /50 was almost flat). */
    let paletteMaxDeg = 1;
    for (const n of realNodes) {
      paletteMaxDeg = Math.max(
        paletteMaxDeg,
        Math.min(GRAPH_CONNECTION_COLOR_MAX_DEGREE, totalDegree(n))
      );
    }

    function connectionToneT(node: SimNode): number {
      if (node.isPlaceholder) {
        return 0;
      }
      const capped = Math.max(0, Math.min(GRAPH_CONNECTION_COLOR_MAX_DEGREE, totalDegree(node)));
      return paletteMaxDeg > 0 ? capped / paletteMaxDeg : 0;
    }

    function recencyToneT(node: SimNode): number {
      if (node.isPlaceholder) {
        return 0;
      }
      const r = recencyBySlug[node.slug];
      return typeof r === "number" && Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0.12;
    }

    function getNodeFill(node: SimNode): string {
      if (node.isPlaceholder) {
        return "color-mix(in srgb, var(--trellis-node) 28%, var(--trellis-surface-2))";
      }
      if (node.graphNodeKind === "thought") {
        return "color-mix(in srgb, var(--trellis-success) 26%, var(--trellis-accent-surface))";
      }
      if (visualEmphasis === "recency") {
        return connectionSpectrumFill(recencyToneT(node));
      }
      return connectionSpectrumFill(connectionToneT(node));
    }

    function getNodeStroke(node: SimNode): string {
      if (node.isPlaceholder) {
        return "color-mix(in srgb, var(--trellis-accent) 50%, var(--trellis-surface-2))";
      }
      if (node.graphNodeKind === "thought") {
        return "color-mix(in srgb, var(--trellis-success) 44%, var(--trellis-accent-dim))";
      }
      if (visualEmphasis === "recency") {
        return connectionSpectrumStroke(recencyToneT(node));
      }
      return connectionSpectrumStroke(connectionToneT(node));
    }

    const { clusterTarget, useClusterForces } = seedNodesForLayout(nodes, width, height);

    const clusterById = new Map(nodes.map((n) => [n.id, clusterKey(n)]));
    const links: SimLink[] = graph.edges.map((edge) => {
      let association = defaultAssociation(edge);
      const ca = clusterById.get(edge.source);
      const cb = clusterById.get(edge.target);
      if (ca !== undefined && cb !== undefined && ca !== cb) {
        /** Weaker association stretches cross-cluster edges so communities stay visually distinct. */
        association = Math.max(0.06, association * 0.58);
      }
      return { ...edge, association };
    });

    const chargeStrength = -Math.min(460, 48 + Math.sqrt(nodeCount) * (useClusterForces ? 17 : 15));
    /** With cluster forces, keep global center very soft so groups stay separated on the ring. */
    const centerStrength = useClusterForces
      ? largeGraph
        ? 0.006
        : 0.022
      : largeGraph
        ? 0.018
        : 0.06;

    const clusterPull = useClusterForces ? (largeGraph ? 0.13 : 0.17) : 0;

    const simulation = d3.forceSimulation(nodes).force(
      "charge",
      d3.forceManyBody().strength(chargeStrength)
    );

    if (useClusterForces) {
      simulation
        .force(
          "clusterX",
          d3
            .forceX<SimNode>((d) => clusterTarget.get(clusterKey(d))?.x ?? width / 2)
            .strength(clusterPull)
        )
        .force(
          "clusterY",
          d3
            .forceY<SimNode>((d) => clusterTarget.get(clusterKey(d))?.y ?? height / 2)
            .strength(clusterPull)
        );
    }

    simulation
      .force("center", d3.forceCenter(width / 2, height / 2).strength(centerStrength))
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((item) => item.id)
          .distance((item) => linkDistance(item.association ?? 0.35))
          .strength((item) => linkStrength(item.association ?? 0.35))
      )
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((item) => item.size + (largeGraph ? 18 : 26))
      )
      .alphaDecay(largeGraph ? 0.28 : 0.06)
      .alphaMin(0.001)
      .velocityDecay(largeGraph ? 0.42 : 0.32);

    let coldTicks = 0;
    const maxColdTicks = largeGraph ? (useClusterForces ? 620 : 520) : 240;
    while (simulation.alpha() > (largeGraph ? 0.035 : 0.02) && coldTicks < maxColdTicks) {
      simulation.tick();
      coldTicks += 1;
    }
    simulation.stop();

    const container = svg.append("g");

    const linkSelection = container
      .append("g")
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "var(--trellis-edge)")
      .attr("stroke-opacity", 1)
      .attr("stroke-width", 1)
      .style("transition", "stroke 0.15s ease, stroke-opacity 0.15s ease, stroke-width 0.15s ease");

    /** True after pointer moved during drag; pure clicks do not run the drag handler. */
    let didDrag = false;
    let hoveredNodeId: string | null = null;

    function getActiveNodeId(): string | null {
      return hoveredNodeId ?? focusedNodeIdRef.current;
    }

    function isConnectedToActiveNode(item: SimLink): boolean {
      const activeNodeId = getActiveNodeId();

      if (activeNodeId == null) {
        return false;
      }

      return (
        getLinkNodeId(item.source) === activeNodeId || getLinkNodeId(item.target) === activeNodeId
      );
    }

    function isFocusedNode(item: SimNode): boolean {
      return focusedNodeIdRef.current === item.id;
    }

    function isHoveredNode(item: SimNode): boolean {
      return hoveredNodeId === item.id;
    }

    function tickPositions(): void {
      linkSelection
        .attr("x1", (item) => (item.source as SimNode).x ?? 0)
        .attr("y1", (item) => (item.source as SimNode).y ?? 0)
        .attr("x2", (item) => (item.target as SimNode).x ?? 0)
        .attr("y2", (item) => (item.target as SimNode).y ?? 0);

      nodeSelection.attr("cx", (item) => item.x ?? 0).attr("cy", (item) => item.y ?? 0);
      labelSelection.attr("x", (item) => item.x ?? 0).attr("y", (item) => item.y ?? 0);
    }

    function refreshVisualState(): void {
      linkSelection
        .attr("stroke", (item) =>
          isConnectedToActiveNode(item) ? "var(--trellis-accent)" : "var(--trellis-edge)"
        )
        .attr("stroke-opacity", (item) => {
          if (getActiveNodeId() == null) {
            return 1;
          }

          return isConnectedToActiveNode(item) ? 0.95 : 0.2;
        })
        .attr("stroke-width", (item) => (isConnectedToActiveNode(item) ? 2.25 : 1));

      nodeSelection
        .attr("fill", (item) =>
          isHoveredNode(item) || isFocusedNode(item) ? "var(--trellis-accent)" : getNodeFill(item)
        )
        .attr("stroke", (item) =>
          isHoveredNode(item) || isFocusedNode(item) ? "var(--trellis-accent)" : getNodeStroke(item)
        )
        .attr("stroke-width", (item) => {
          if (isHoveredNode(item)) {
            return 2.5;
          }

          return isFocusedNode(item) ? 2.25 : 1.5;
        });

      if (getActiveNodeId() != null) {
        linkSelection.filter(isConnectedToActiveNode).raise();
      }

      nodeSelection.filter((item) => isHoveredNode(item) || isFocusedNode(item)).raise();
      labelSelection.filter((item) => isHoveredNode(item) || isFocusedNode(item)).raise();
    }

    function focusNodeInView(nodeId: string | null): void {
      if (nodeId == null) {
        return;
      }

      const target = nodes.find((item) => item.id === nodeId);

      if (!target) {
        return;
      }

      const currentTransform = d3.zoomTransform(svgElement);
      const nextScale = Math.max(currentTransform.k, 1.15);
      const targetX = target.x ?? width / 2;
      const targetY = target.y ?? height / 2;
      const nextTransform = d3.zoomIdentity
        .translate(width / 2 - targetX * nextScale, height / 2 - targetY * nextScale)
        .scale(nextScale);

      svg.transition().duration(220).call(zoom.transform, nextTransform);
    }

    const nodeSelection = container
      .append("g")
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (item) => item.size)
      .attr("cx", (item) => item.x ?? 0)
      .attr("cy", (item) => item.y ?? 0)
      .attr("fill", (item) => getNodeFill(item))
      .attr("stroke", (item) => getNodeStroke(item))
      .attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .style("transition", "fill 0.15s ease, stroke 0.15s ease, stroke-width 0.15s ease")
      .call(
        d3
          .drag<SVGCircleElement, SimNode>()
          .on("start", () => {
            didDrag = false;
          })
          .on("drag", (event, item) => {
            didDrag = true;
            const source = event.sourceEvent as MouseEvent | undefined;
            const [x, y] = graphPointerXY(source ?? (event as unknown as MouseEvent));
            item.x = x;
            item.y = y;
            tickPositions();
          })
          .on("end", (event, item) => {
            const source = event.sourceEvent as MouseEvent | undefined;
            const [x, y] = graphPointerXY(source ?? (event as unknown as MouseEvent));
            item.x = x;
            item.y = y;
            tickPositions();
          })
      );

    const labelSelection = container
      .append("g")
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes)
      .join("text")
      .text((item) => item.title)
      .attr("fill", "var(--trellis-text)")
      .attr("font-size", 11)
      .attr("text-anchor", "middle")
      .attr("dy", (item) => item.size + 14)
      .style("pointer-events", "none")
      .style("opacity", zoomScaleRef.current >= LABEL_ZOOM_THRESHOLD ? 1 : 0);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.03, 5])
      .on("zoom", (event) => {
        container.attr("transform", event.transform.toString());
        const k = event.transform.k;
        zoomScaleRef.current = k;
        labelSelection.style("opacity", k >= LABEL_ZOOM_THRESHOLD ? 1 : 0);
      });

    svg.call(zoom);
    svg.on("dblclick", (event) => {
      event.preventDefault();
      svg.transition().duration(180).call(zoom.transform, d3.zoomIdentity);
      zoomScaleRef.current = 1;
      labelSelection.style("opacity", 1);
    });

    let polishTicks = 0;
    const maxPolishTicks = largeGraph ? 22 : 48;

    function polishTick(): void {
      tickPositions();
      polishTicks += 1;
      if (polishTicks >= maxPolishTicks || simulation.alpha() < 0.006) {
        simulation.stop();
        simulation.on("tick", null);
      }
    }

    simulation.on("tick", polishTick);
    simulation.alpha(largeGraph ? 0.11 : 0.24).restart();

    svg.attr("shape-rendering", largeGraph ? "optimizeSpeed" : "auto");

    nodeSelection
      .on("mouseenter", function (event: MouseEvent, item: SimNode) {
        hoveredNodeId = item.id;
        refreshVisualState();

        onHoverNodeRef.current({
          title: item.title,
          x: event.clientX,
          y: event.clientY
        });
      })
      .on("mousemove", function (event: MouseEvent, item: SimNode) {
        onHoverNodeRef.current({
          title: item.title,
          x: event.clientX,
          y: event.clientY
        });
      })
      .on("mouseleave", function (_event: MouseEvent) {
        hoveredNodeId = null;
        refreshVisualState();

        onHoverNodeRef.current(null);
      })
      .on("dblclick", (event: MouseEvent) => {
        event.stopPropagation();
      })
      .on("click", (_event: MouseEvent, item: SimNode) => {
        if (didDrag) {
          return;
        }
        onSelectNodeRef.current(item.slug);
      });

    refreshVisualStateRef.current = refreshVisualState;
    focusNodeInViewRef.current = focusNodeInView;
    refreshVisualState();

    if (focusedNodeIdRef.current != null) {
      focusNodeInView(focusedNodeIdRef.current);
    }

    return () => {
      simulation.stop();
      simulation.on("tick", null);
      refreshVisualStateRef.current = null;
      focusNodeInViewRef.current = null;
      onHoverNodeRef.current(null);
    };
  }, [graph, visualEmphasis, recencyBySlug]);

  useEffect(() => {
    focusedNodeIdRef.current = focusedNodeId;
    refreshVisualStateRef.current?.();

    if (focusedNodeId != null) {
      focusNodeInViewRef.current?.(focusedNodeId);
    }
  }, [focusedNodeId]);

  return <svg ref={svgRef} className="h-full w-full" data-testid="force-graph" />;
}
