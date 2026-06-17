"use client";

import {
  forceCollide,
  type forceLink,
  forceManyBody,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import dynamic from "next/dynamic";
import {
  type ComponentType,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ForceGraphMethods,
  ForceGraphProps,
  NodeObject,
} from "react-force-graph-2d";

export type KnowledgeGraphNodeData<TItem = unknown, TGroup = unknown> = {
  id: string;
  label: string;
  type: "item" | "group";
  val: number;
  color: string;
  item?: TItem;
  group?: TGroup;
};

export type KnowledgeGraphLinkData = {
  source: string;
  target: string;
  type: "membership" | "relation";
  strength: number;
};

type GraphNode<TItem, TGroup> = NodeObject<
  KnowledgeGraphNodeData<TItem, TGroup>
>;
type ForceGraphRef = ForceGraphMethods<
  KnowledgeGraphNodeData,
  KnowledgeGraphLinkData
>;

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as ComponentType<
  ForceGraphProps<KnowledgeGraphNodeData, KnowledgeGraphLinkData> & {
    ref?: React.Ref<ForceGraphRef>;
  }
>;

interface Theme {
  background: string;
  foreground: string;
  mutedForeground: string;
  scheme: "dark" | "light";
}

interface Props<TItem, TGroup> {
  nodes: KnowledgeGraphNodeData<TItem, TGroup>[];
  links: KnowledgeGraphLinkData[];
  onSelectItem: (item: TItem) => void;
  onSelectGroup: (group: TGroup) => void;
  onRelationClick?: (sourceId: string) => void;
  onItemContextMenu?: (item: TItem, event: MouseEvent) => void;
  onGroupContextMenu?: (group: TGroup, event: MouseEvent) => void;
  onBackgroundContextMenu?: (event: MouseEvent) => void;
}

const NODE_REL_SIZE = 3;
const LABEL_ZOOM_THRESHOLD = 2.8;

function readTheme(element: HTMLElement): Theme {
  const styles = getComputedStyle(element);
  const get = (value: string, fallback: string) =>
    styles.getPropertyValue(value).trim() || fallback;
  const isDark = document.documentElement.classList.contains("dark");

  return {
    background: get("--background", isDark ? "#0b0d10" : "#f9f8f6"),
    foreground: get("--foreground", isDark ? "#e6e7ea" : "#2a2b2c"),
    mutedForeground: get("--muted-foreground", isDark ? "#8a8d93" : "#4f5a4a"),
    scheme: isDark ? "dark" : "light",
  };
}

function resolveNodeId(
  value: string | number | GraphNode<unknown, unknown> | null | undefined,
) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return typeof value.id === "string" ? value.id : null;
}

export function KnowledgeGraph<TItem, TGroup>({
  nodes,
  links,
  onSelectItem,
  onSelectGroup,
  onRelationClick,
  onItemContextMenu,
  onGroupContextMenu,
  onBackgroundContextMenu,
}: Props<TItem, TGroup>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphRef | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [theme, setTheme] = useState<Theme | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // The engine starts with default forces before the ref is available to
  // install the custom ones; cooldownTicks stays 0 (engine paused) until they
  // are applied, so the layout visibly settles exactly once.
  const [forcesReady, setForcesReady] = useState(false);
  const forcesAppliedRef = useRef(false);

  // A content signature keyed on node ids + edge count. The simulation re-settles
  // ("collapses to center then explodes") on every distinct graphData object it
  // ingests, so we must hand it a *stable* reference whenever the graph content
  // is unchanged — otherwise an identity-only re-render triggers a second settle.
  const signature = useMemo(
    () =>
      `${nodes.length}:${links.length}:${nodes.map((node) => node.id).join(",")}`,
    [nodes, links],
  );

  const graphData = useMemo(() => {
    // Seed unpositioned nodes on a golden-angle spiral so the layout starts
    // pre-spread instead of stacked at the origin. d3-force keeps any existing
    // x/y, so a settled graph that re-ingests barely moves rather than imploding
    // to the center and flinging back out.
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    nodes.forEach((node, index) => {
      const positioned = node as { x?: number; y?: number };
      if (positioned.x == null || positioned.y == null) {
        const radius = Math.sqrt(index + 0.5) * 16;
        positioned.x = Math.cos(index * goldenAngle) * radius;
        positioned.y = Math.sin(index * goldenAngle) * radius;
      }
    });
    return { nodes, links };
  }, [signature]);

  useEffect(() => {
    type SimNode = SimulationNodeDatum & { val: number };
    type SimLink = SimulationLinkDatum<SimNode> & {
      type: "membership" | "relation";
    };

    const nodeRadius = (node: SimNode | string | number) => {
      if (typeof node !== "object" || node === null) return NODE_REL_SIZE;
      return Math.sqrt(node.val ?? 1) * NODE_REL_SIZE;
    };

    const apply = () => {
      const fg = graphRef.current;
      if (!fg) return false;

      fg.d3Force(
        "collide",
        forceCollide<SimNode>()
          .radius((node) => Math.sqrt(node.val) * NODE_REL_SIZE + 4)
          .strength(0.9) as never,
      );

      fg.d3Force(
        "charge",
        forceManyBody<SimNode>()
          .strength((node) => -34 - Math.sqrt(node.val) * 7)
          // Cap the repulsion range so a transiently clustered layout can't
          // fling nodes off-screen before collide/link forces settle it.
          .distanceMax(320) as never,
      );

      const linkForce = fg.d3Force("link") as ReturnType<
        typeof forceLink<SimNode, SimLink>
      > | null;
      if (!linkForce) return false;

      linkForce
        .distance(
          (link) => nodeRadius(link.source) + nodeRadius(link.target) + 26,
        )
        .strength((link) => (link.type === "membership" ? 0.4 : 0.7));

      return true;
    };

    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (!apply()) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (forcesAppliedRef.current) {
        // Already running with custom forces: this is a data change, restart
        // the settle now. First time: the forcesReady effect restarts it
        // after cooldownTicks has flipped to its running value.
        graphRef.current?.d3ReheatSimulation();
      } else {
        forcesAppliedRef.current = true;
        setForcesReady(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [signature]);

  useEffect(() => {
    if (forcesReady) graphRef.current?.d3ReheatSimulation();
  }, [forcesReady]);

  useEffect(() => {
    if (!containerRef.current) return;

    const element = containerRef.current;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };
    const resizeObserver = new ResizeObserver(measure);

    resizeObserver.observe(element);
    measure();
    setTheme(readTheme(element));

    const mutationObserver = new MutationObserver(() => {
      setTheme(readTheme(element));
    });

    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full bg-background">
      {size.width > 0 && theme && (
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor={theme.background}
          nodeRelSize={NODE_REL_SIZE}
          nodeLabel={() => ""}
          nodeVal={(node) => node.val}
          linkColor={(link) =>
            link.type === "membership"
              ? `${theme.mutedForeground}44`
              : `${theme.mutedForeground}22`
          }
          linkWidth={(link) => (link.type === "membership" ? 0.5 : 0.3)}
          cooldownTicks={forcesReady ? 180 : 0}
          d3VelocityDecay={0.45}
          onNodeHover={(node) => {
            setHoveredId(node ? node.id : null);
            if (containerRef.current) {
              containerRef.current.style.cursor = node ? "pointer" : "default";
            }
          }}
          onNodeClick={(node) => {
            if (node.type === "item" && node.item)
              onSelectItem(node.item as TItem);
            if (node.type === "group" && node.group) {
              onSelectGroup(node.group as TGroup);
            }
          }}
          onLinkClick={(link) => {
            if (link.type !== "relation") return;
            const sourceId = resolveNodeId(link.source);
            if (sourceId) onRelationClick?.(sourceId);
          }}
          onNodeRightClick={(node, event) => {
            if (node.type === "item" && node.item) {
              onItemContextMenu?.(node.item as TItem, event);
            } else if (node.type === "group" && node.group) {
              onGroupContextMenu?.(node.group as TGroup, event);
            }
          }}
          onBackgroundRightClick={(event) => onBackgroundContextMenu?.(event)}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(node, context, globalScale) => {
            if (node.x == null || node.y == null) return;

            const radius = Math.sqrt(node.val) * NODE_REL_SIZE;
            const isHovered = hoveredId === node.id;

            context.beginPath();
            context.arc(node.x, node.y, radius, 0, 2 * Math.PI);
            context.fillStyle = node.color;
            context.fill();

            const showLabel = isHovered || globalScale >= LABEL_ZOOM_THRESHOLD;
            if (!showLabel) return;

            const isGroup = node.type === "group";
            const fontSize = (isGroup ? 11 : 9) / globalScale;
            context.font = `${isGroup ? 600 : 500} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
            context.textAlign = "center";
            context.textBaseline = "middle";

            const maxChars = isGroup ? 28 : 36;
            const label =
              node.label.length > maxChars
                ? `${node.label.slice(0, maxChars)}…`
                : node.label;

            const metrics = context.measureText(label);
            const padX = 4 / globalScale;
            const padY = 2 / globalScale;
            const boxWidth = metrics.width + padX * 2;
            const boxHeight = fontSize + padY * 2;
            const centerY = node.y + radius + boxHeight / 2 + 3 / globalScale;
            const centerX = node.x;
            const x = centerX - boxWidth / 2;
            const y = centerY - boxHeight / 2;
            const cornerRadius = 3 / globalScale;

            context.fillStyle = `${theme.background}ee`;
            context.beginPath();
            context.moveTo(x + cornerRadius, y);
            context.lineTo(x + boxWidth - cornerRadius, y);
            context.quadraticCurveTo(
              x + boxWidth,
              y,
              x + boxWidth,
              y + cornerRadius,
            );
            context.lineTo(x + boxWidth, y + boxHeight - cornerRadius);
            context.quadraticCurveTo(
              x + boxWidth,
              y + boxHeight,
              x + boxWidth - cornerRadius,
              y + boxHeight,
            );
            context.lineTo(x + cornerRadius, y + boxHeight);
            context.quadraticCurveTo(
              x,
              y + boxHeight,
              x,
              y + boxHeight - cornerRadius,
            );
            context.lineTo(x, y + cornerRadius);
            context.quadraticCurveTo(x, y, x + cornerRadius, y);
            context.closePath();
            context.fill();

            context.fillStyle = theme.foreground;
            context.fillText(label, centerX, centerY);
          }}
          nodePointerAreaPaint={(node, color, context) => {
            if (node.x == null || node.y == null) return;

            const radius = Math.sqrt(node.val) * NODE_REL_SIZE;
            context.fillStyle = color;
            context.beginPath();
            context.arc(node.x, node.y, radius + 2, 0, 2 * Math.PI);
            context.fill();
          }}
        />
      )}
    </div>
  );
}
