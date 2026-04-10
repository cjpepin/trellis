import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { GraphData } from "@electron/ipc/types";

interface Props {
  graph: GraphData;
  focusedNodeId?: string | null;
  onSelectNode: (slug: string) => void;
  onHoverNode: (payload: { title: string; x: number; y: number } | null) => void;
}

type SimNode = d3.SimulationNodeDatum & {
  id: string;
  slug: string;
  title: string;
  size: number;
  cluster?: string;
  isPlaceholder?: boolean;
};

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  id: string;
};

export function ForceGraph({ graph, focusedNodeId = null, onSelectNode, onHoverNode }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const onHoverNodeRef = useRef(onHoverNode);
  const focusedNodeIdRef = useRef<string | null>(focusedNodeId);
  const refreshVisualStateRef = useRef<(() => void) | null>(null);
  const focusNodeInViewRef = useRef<((nodeId: string | null) => void) | null>(null);

  onSelectNodeRef.current = onSelectNode;
  onHoverNodeRef.current = onHoverNode;
  focusedNodeIdRef.current = focusedNodeId;

  function getNodeFill(node: SimNode): string {
    return node.isPlaceholder
      ? "color-mix(in srgb, var(--trellis-node) 28%, var(--trellis-surface-2))"
      : "var(--trellis-node)";
  }

  function getNodeStroke(node: SimNode): string {
    return node.isPlaceholder
      ? "color-mix(in srgb, var(--trellis-accent) 50%, var(--trellis-surface-2))"
      : "var(--trellis-surface-2)";
  }

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
        .text("Start chatting to grow your graph")
        .attr("fill", "var(--trellis-text)")
        .attr("text-anchor", "middle")
        .attr("font-size", 14)
        .attr("dy", 72);

      return;
    }

    const nodes: SimNode[] = graph.nodes.map((node) => ({ ...node }));
    const links: SimLink[] = graph.edges.map((edge) => ({ ...edge }));
    const clusterKeys = [...new Set(nodes.map((node) => node.cluster || "untagged"))];
    const clusterCenters = new Map<string, { x: number; y: number }>();
    const ringRadius = Math.min(width, height) * 0.6;

    clusterKeys.forEach((clusterKey, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(clusterKeys.length, 1);
      clusterCenters.set(clusterKey, {
        x: width / 2 + Math.cos(angle) * ringRadius,
        y: height / 2 + Math.sin(angle) * ringRadius
      });
    });

    nodes.forEach((node, index) => {
      const center = clusterCenters.get(node.cluster || "untagged") ?? {
        x: width / 2,
        y: height / 2
      };

      if (typeof node.x !== "number" || typeof node.y !== "number") {
        const spread = 60 + (index % 7) * 20;
        const angle = ((index % 17) / 17) * Math.PI * 2;
        node.x = center.x + Math.cos(angle) * spread;
        node.y = center.y + Math.sin(angle) * spread;
      }
    });

    const container = svg.append("g");
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 2.2])
      .on("zoom", (event) => {
        container.attr("transform", event.transform.toString());
      });

    svg.call(zoom);
    svg.on("dblclick", () => {
      svg.transition().duration(160).call(zoom.transform, d3.zoomIdentity);
    });

    const link = container
      .append("g")
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "var(--trellis-edge)")
      .attr("stroke-opacity", 1)
      .attr("stroke-width", 1)
      .style("transition", "stroke 0.15s ease, stroke-opacity 0.15s ease, stroke-width 0.15s ease");

    let simulation: d3.Simulation<SimNode, SimLink>;
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

    function refreshVisualState(): void {
      link
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

      node
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
        link.filter(isConnectedToActiveNode).raise();
      }

      node.filter((item) => isHoveredNode(item) || isFocusedNode(item)).raise();
      label.filter((item) => isHoveredNode(item) || isFocusedNode(item)).raise();
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

    const node = container
      .append("g")
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (item) => item.size)
      .attr("fill", (item) => getNodeFill(item))
      .attr("stroke", (item) => getNodeStroke(item))
      .attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .style("transition", "fill 0.15s ease, stroke 0.15s ease, stroke-width 0.15s ease")
      .call(
        d3
          .drag<SVGCircleElement, SimNode>()
          .on("start", (event, item) => {
            didDrag = false;
            if (!event.active) {
              simulation.alphaTarget(0.2).restart();
            }
            item.fx = item.x;
            item.fy = item.y;
          })
          .on("drag", (_event, item) => {
            didDrag = true;
            item.fx = _event.x;
            item.fy = _event.y;
          })
          .on("end", (event, item) => {
            if (!event.active) {
              simulation.alphaTarget(0);
            }
            item.fx = event.x;
            item.fy = event.y;
          })
      );

    const label = container
      .append("g")
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes)
      .join("text")
      .text((item) => item.title)
      .attr("fill", "var(--trellis-text)")
      .attr("font-size", 11)
      .attr("text-anchor", "middle")
      .attr("dy", (item) => item.size + 14)
      .style("pointer-events", "none");

    simulation = d3
      .forceSimulation(nodes)
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("charge", d3.forceManyBody().strength(-165))
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((item) => item.id)
          .distance((item) => {
            const source = item.source as SimNode;
            const target = item.target as SimNode;
            return source.cluster && source.cluster === target.cluster ? 118 : 188;
          })
          .strength((item) => {
            const source = item.source as SimNode;
            const target = item.target as SimNode;
            return source.cluster && source.cluster === target.cluster ? 0.2 : 0.08;
          })
      )
      .force(
        "cluster-x",
        d3
          .forceX<SimNode>((item) => clusterCenters.get(item.cluster || "untagged")?.x ?? width / 2)
          .strength((item) => (item.fx == null ? 0.11 : 0))
      )
      .force(
        "cluster-y",
        d3
          .forceY<SimNode>((item) => clusterCenters.get(item.cluster || "untagged")?.y ?? height / 2)
          .strength((item) => (item.fy == null ? 0.12 : 0))
      )
      .force("collision", d3.forceCollide<SimNode>().radius((item) => item.size + 26))
      .alphaDecay(0.05)
      .velocityDecay(0.32)
      .on("tick", () => {
        link
          .attr("x1", (item) => (item.source as SimNode).x ?? 0)
          .attr("y1", (item) => (item.source as SimNode).y ?? 0)
          .attr("x2", (item) => (item.target as SimNode).x ?? 0)
          .attr("y2", (item) => (item.target as SimNode).y ?? 0);

        node.attr("cx", (item) => item.x ?? 0).attr("cy", (item) => item.y ?? 0);
        label.attr("x", (item) => item.x ?? 0).attr("y", (item) => item.y ?? 0);
      });

    refreshVisualStateRef.current = refreshVisualState;
    focusNodeInViewRef.current = focusNodeInView;
    refreshVisualState();

    if (focusedNodeIdRef.current != null) {
      focusNodeInView(focusedNodeIdRef.current);
    }

    node
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
      .on("dblclick", (event: MouseEvent, item: SimNode) => {
        event.stopPropagation();
        item.fx = null;
        item.fy = null;
        simulation.alpha(0.2).restart();
      })
      .on("click", (_event: MouseEvent, item: SimNode) => {
        if (didDrag) {
          return;
        }
        onSelectNodeRef.current(item.slug);
      });

    return () => {
      simulation.stop();
      refreshVisualStateRef.current = null;
      focusNodeInViewRef.current = null;
      onHoverNodeRef.current(null);
    };
  }, [graph]);

  useEffect(() => {
    focusedNodeIdRef.current = focusedNodeId;
    refreshVisualStateRef.current?.();

    if (focusedNodeId != null) {
      focusNodeInViewRef.current?.(focusedNodeId);
    }
  }, [focusedNodeId]);

  return <svg ref={svgRef} className="h-full w-full" />;
}
