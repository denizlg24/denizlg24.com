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
}: Props<TItem, TGroup>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphRef | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [theme, setTheme] = useState<Theme | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

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
        forceManyBody<SimNode>().strength(
          (node) => -30 - Math.sqrt(node.val) * 8,
        ) as never,
      );

      const linkForce = fg.d3Force("link") as ReturnType<
        typeof forceLink<SimNode, SimLink>
      > | null;
      if (!linkForce) return false;

      linkForce
        .distance(
          (link) => nodeRadius(link.source) + nodeRadius(link.target) + 18,
        )
        .strength((link) => (link.type === "membership" ? 0.4 : 0.7));

      return true;
    };

    let raf = 0;
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      attempts += 1;
      const ok = apply();
      if (ok && attempts >= 2) {
        graphRef.current?.d3ReheatSimulation();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [nodes, links]);

  useEffect(() => {
    if (!containerRef.current) return;

    const element = containerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    });

    resizeObserver.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
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
          cooldownTicks={180}
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
