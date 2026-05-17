import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronRight, Network } from "lucide-react";
import type { AppWorkspaceId, GraphData } from "@trellis/contracts";
import { ForceGraph } from "@/components/graph/ForceGraph";
import { NodeTooltip } from "@/components/graph/NodeTooltip";
import { readWorkspaceLocalStorage, writeWorkspaceLocalStorage } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const CHAT_CONTEXT_GRAPH_WIDTH_KEY = "chat-context-graph-width";
const DEFAULT_CHAT_CONTEXT_GRAPH_WIDTH = 280;
const MIN_CHAT_CONTEXT_GRAPH_WIDTH = 200;
const MAX_CHAT_CONTEXT_GRAPH_WIDTH = 520;
const COLLAPSED_GRAPH_RAIL_WIDTH = 48;

function clampChatContextGraphWidth(value: number): number {
  const maxByViewport =
    typeof window !== "undefined"
      ? Math.min(MAX_CHAT_CONTEXT_GRAPH_WIDTH, Math.floor(window.innerWidth * 0.5))
      : MAX_CHAT_CONTEXT_GRAPH_WIDTH;
  return Math.min(maxByViewport, Math.max(MIN_CHAT_CONTEXT_GRAPH_WIDTH, Math.round(value)));
}

function getStoredChatContextGraphWidth(workspaceId: AppWorkspaceId): number {
  const raw = readWorkspaceLocalStorage(CHAT_CONTEXT_GRAPH_WIDTH_KEY, workspaceId);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampChatContextGraphWidth(parsed) : DEFAULT_CHAT_CONTEXT_GRAPH_WIDTH;
}

function useMinWidthLg(): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setMatches(mq.matches);
    const onChange = () => {
      setMatches(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return matches;
}

interface Props {
  workspaceId: AppWorkspaceId;
  graph: GraphData;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenNote: (slug: string) => void;
}

export function ChatContextGraphPanel({
  workspaceId,
  graph,
  collapsed,
  onToggleCollapsed,
  onOpenNote
}: Props) {
  const isLg = useMinWidthLg();
  const [tooltip, setTooltip] = useState<{ title: string; x: number; y: number } | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => getStoredChatContextGraphWidth(workspaceId));
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const nodeCount = graph.nodes.length;

  useEffect(() => {
    setPanelWidth(getStoredChatContextGraphWidth(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    writeWorkspaceLocalStorage(CHAT_CONTEXT_GRAPH_WIDTH_KEY, String(panelWidth), workspaceId);
  }, [panelWidth, workspaceId]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    function handleMouseMove(event: MouseEvent): void {
      const start = resizeRef.current;
      if (!start) {
        return;
      }
      const dx = start.startX - event.clientX;
      setPanelWidth(clampChatContextGraphWidth(start.startWidth + dx));
    }

    function handleMouseUp(): void {
      resizeRef.current = null;
      setIsResizing(false);
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  function beginResize(clientX: number): void {
    resizeRef.current = {
      startX: clientX,
      startWidth: panelWidth
    };
    setIsResizing(true);
  }

  function handleResizeMouseDown(event: ReactMouseEvent<HTMLButtonElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    beginResize(event.clientX);
  }

  if (nodeCount === 0) {
    return null;
  }

  const lgWidthStyle =
    isLg && !collapsed ? panelWidth : isLg && collapsed ? COLLAPSED_GRAPH_RAIL_WIDTH : undefined;

  return (
    <>
      <aside
        data-testid="chat-context-graph"
        className={cn(
          "relative flex min-h-0 shrink-0 flex-col overflow-hidden border-trellis-border bg-trellis-surface/90 backdrop-blur",
          "order-1 border-b lg:order-2 lg:h-full lg:max-h-full lg:border-b-0 lg:border-l",
          !isLg && "w-full",
          "transition-[width] duration-[320ms] motion-reduce:transition-none motion-reduce:duration-0",
          "ease-[cubic-bezier(0.28,0.85,0.4,1.04)] motion-reduce:ease-linear",
          isResizing && "transition-none"
        )}
        style={lgWidthStyle !== undefined ? { width: lgWidthStyle } : undefined}
      >
        {isLg && !collapsed ? (
          <button
            type="button"
            aria-label="Resize context map"
            title="Drag to resize. Double-click to collapse."
            className="app-region-no-drag group absolute inset-y-0 -left-2 z-20 flex w-4 cursor-col-resize items-center justify-center bg-transparent"
            onMouseDown={handleResizeMouseDown}
            onDoubleClick={(event) => {
              event.preventDefault();
              onToggleCollapsed();
            }}
          >
            <span className="h-20 w-px rounded-full bg-trellis-border transition group-hover:bg-trellis-accent/45" />
          </button>
        ) : null}
        {collapsed ? (
          <button
            type="button"
            title="Show context map — wiki notes linked or used in this chat"
            aria-expanded={false}
            className={cn(
              "flex w-full items-center gap-2 border-b border-trellis-border px-3 py-2.5 text-left transition hover:bg-trellis-surface",
              "lg:h-full lg:min-h-[120px] lg:flex-col lg:justify-center lg:gap-3 lg:border-b-0 lg:px-1 lg:py-4"
            )}
            onClick={onToggleCollapsed}
          >
            <Network className="h-5 w-5 shrink-0 text-trellis-accent" aria-hidden />
            <span className="min-w-0 flex-1 text-xs text-trellis-muted lg:hidden">
              <span className="font-medium text-trellis-text">Context map</span>
              <span className="text-trellis-faint"> · </span>
              {nodeCount} note{nodeCount === 1 ? "" : "s"}
            </span>
            <span className="hidden text-center text-[10px] font-medium leading-snug text-trellis-muted lg:block">
              {nodeCount}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-trellis-muted lg:hidden" aria-hidden />
          </button>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2 border-b border-trellis-border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-trellis-faint">
                  Context map
                </p>
                <p
                  className="mt-0.5 text-xs leading-snug text-trellis-muted"
                  title="Notes linked in messages, pinned in the composer, from the wiki, or included when Trellis replied. Edges follow [[links]] in your vault."
                >
                  {nodeCount} local note{nodeCount === 1 ? "" : "s"} in this chat
                </p>
              </div>
              <button
                type="button"
                title="Hide context map"
                aria-expanded
                aria-label="Collapse context map"
                className="shrink-0 rounded-field border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text"
                onClick={onToggleCollapsed}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="relative min-h-[200px] w-full flex-1 lg:min-h-0">
              <ForceGraph
                graph={graph}
                focusedNodeId={null}
                onHoverNode={setTooltip}
                onSelectNode={(slug) => {
                  onOpenNote(slug);
                }}
              />
            </div>
          </>
        )}
      </aside>
      {tooltip ? <NodeTooltip title={tooltip.title} x={tooltip.x} y={tooltip.y} /> : null}
    </>
  );
}
