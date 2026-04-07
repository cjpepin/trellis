import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { GraphData } from "@electron/ipc/types";

interface Props {
  graph: GraphData;
  onSelectNode: (slug: string) => void;
  onHoverNode: (payload: { title: string; x: number; y: number } | null) => void;
}

type SimNode = d3.SimulationNodeDatum & {
  id: string;
  slug: string;
  title: string;
  size: number;
  isPlaceholder?: boolean;
};

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  id: string;
};

export function ForceGraph({ graph, onSelectNode, onHoverNode }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const onHoverNodeRef = useRef(onHoverNode);

  onSelectNodeRef.current = onSelectNode;
  onHoverNodeRef.current = onHoverNode;

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

  useEffect(() => {
    if (!svgRef.current) {
      return;
    }

    const svg = d3.select(svgRef.current);
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
      .attr("stroke", "var(--trellis-edge)")
      .attr("stroke-opacity", 1)
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1);

    let simulation: d3.Simulation<SimNode, SimLink>;
    /** True after pointer moved during drag; pure clicks do not run the drag handler. */
    let didDrag = false;

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
            item.fx = null;
            item.fy = null;
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
      .force("charge", d3.forceManyBody().strength(-180))
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((item) => item.id)
          .distance(90)
      )
      .force("collision", d3.forceCollide<SimNode>().radius((item) => item.size + 12))
      .on("tick", () => {
        link
          .attr("x1", (item) => (item.source as SimNode).x ?? 0)
          .attr("y1", (item) => (item.source as SimNode).y ?? 0)
          .attr("x2", (item) => (item.target as SimNode).x ?? 0)
          .attr("y2", (item) => (item.target as SimNode).y ?? 0);

        node.attr("cx", (item) => item.x ?? 0).attr("cy", (item) => item.y ?? 0);
        label.attr("x", (item) => item.x ?? 0).attr("y", (item) => item.y ?? 0);
      });

    node
      .on("mouseenter", function (event: MouseEvent, item: SimNode) {
        d3.select(this)
          .attr("fill", "var(--trellis-accent)")
          .attr("stroke", "var(--trellis-accent)")
          .attr("stroke-width", 2.5);

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
      .on("mouseleave", function (_event: MouseEvent, item: SimNode) {
        d3.select(this)
          .attr("fill", getNodeFill(item))
          .attr("stroke", getNodeStroke(item))
          .attr("stroke-width", 1.5);

        onHoverNodeRef.current(null);
      })
      .on("click", (_event: MouseEvent, item: SimNode) => {
        if (didDrag) {
          return;
        }
        onSelectNodeRef.current(item.slug);
      });

    return () => {
      simulation.stop();
      onHoverNodeRef.current(null);
    };
  }, [graph]);

  return <svg ref={svgRef} className="h-full w-full" />;
}
