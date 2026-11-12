"use client";

import dynamic from "next/dynamic";
import {
  type ComponentType,
  type Ref,
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
import {
  drawNodeLabel,
  truncateLabel,
  useElementSize,
  useGraphTheme,
  withAlpha,
} from "./theme";

export type KnowledgeGraphNodeData<TItem = unknown, TGroup = unknown> = {
  id: string;
  label: string;
  type: "item" | "group";
  val: number;
  color: string;
  image?: string;
  item?: TItem;
  group?: TGroup;
  x?: number;
  y?: number;
};

export type KnowledgeGraphLinkData = {
  source: string;
  target: string;
  type: "membership" | "relation";
  strength: number;
};

type GraphNode = NodeObject<KnowledgeGraphNodeData>;
type LinkEndpoint = string | number | GraphNode | undefined;
/** d3's link force swaps the id endpoints for the node objects on ingest. */
type SimLink = Omit<KnowledgeGraphLinkData, "source" | "target"> & {
  source: LinkEndpoint;
  target: LinkEndpoint;
};
type ForceGraphRef = ForceGraphMethods<
  KnowledgeGraphNodeData,
  KnowledgeGraphLinkData
>;

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as ComponentType<
  ForceGraphProps<KnowledgeGraphNodeData, KnowledgeGraphLinkData> & {
    ref?: Ref<ForceGraphRef>;
  }
>;

const NODE_REL_SIZE = 3;
const LABEL_ZOOM_THRESHOLD = 2.8;

const nodeRadius = (val: number | undefined) =>
  Math.sqrt(val ?? 1) * NODE_REL_SIZE;

function endpointVal(endpoint: LinkEndpoint): number | undefined {
  return typeof endpoint === "object" && endpoint !== null
    ? endpoint.val
    : undefined;
}

function endpointId(endpoint: LinkEndpoint): string | null {
  if (endpoint == null) return null;
  if (typeof endpoint === "string") return endpoint;
  if (typeof endpoint === "number") return String(endpoint);
  return typeof endpoint.id === "string" ? endpoint.id : null;
}

/**
 * d3's forceCollide, reduced to what this graph needs, so packages/admin
 * doesn't pull d3-force in beside force-graph's own d3-force-3d. Nodes are
 * bucketed on a grid the size of the largest diameter, so each node only
 * tests its 3×3 neighbourhood.
 */
function collideForce(padding: number, strength: number) {
  let nodes: GraphNode[] = [];
  const force = (_alpha: number) => {
    if (nodes.length < 2) return;
    const radii = nodes.map((node) => nodeRadius(node.val) + padding);
    const cell = Math.max(...radii) * 2;
    const grid = new Map<string, number[]>();
    const cellOf = (node: GraphNode) =>
      [
        Math.floor(((node.x ?? 0) + (node.vx ?? 0)) / cell),
        Math.floor(((node.y ?? 0) + (node.vy ?? 0)) / cell),
      ] as const;

    nodes.forEach((node, index) => {
      const [cx, cy] = cellOf(node);
      const key = `${cx}:${cy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    });

    nodes.forEach((a, i) => {
      const [cx, cy] = cellOf(a);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
            if (j <= i) continue;
            const b = nodes[j];
            let x = (b.x ?? 0) + (b.vx ?? 0) - ((a.x ?? 0) + (a.vx ?? 0));
            let y = (b.y ?? 0) + (b.vy ?? 0) - ((a.y ?? 0) + (a.vy ?? 0));
            const reach = radii[i] + radii[j];
            let distSq = x * x + y * y;
            if (distSq >= reach * reach) continue;
            if (distSq === 0) {
              x = (Math.random() - 0.5) * 1e-6;
              y = (Math.random() - 0.5) * 1e-6;
              distSq = x * x + y * y;
            }
            const dist = Math.sqrt(distSq);
            const push = ((reach - dist) / dist) * strength;
            const ra = radii[i] * radii[i];
            const rb = radii[j] * radii[j];
            const share = rb / (ra + rb);
            a.vx = (a.vx ?? 0) - x * push * share;
            a.vy = (a.vy ?? 0) - y * push * share;
            b.vx = (b.vx ?? 0) + x * push * (1 - share);
            b.vy = (b.vy ?? 0) + y * push * (1 - share);
          }
        }
      }
    });
  };
  force.initialize = (next: GraphNode[]) => {
    nodes = next;
  };
  return force;
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
  const size = useElementSize(containerRef);
  const theme = useGraphTheme(containerRef);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // A load bumps the counter so the canvas repaints with the bitmap; failed
  // loads fall back to the colour dot.
  const imageCacheRef = useRef(new Map<string, HTMLImageElement | "error">());
  const [, setLoadedImageCount] = useState(0);
  // The engine starts with default forces before the ref exists; it stays
  // paused (cooldownTicks 0) until the custom ones are in, so the layout
  // settles exactly once.
  const [forcesReady, setForcesReady] = useState(false);
  const forcesAppliedRef = useRef(false);

  // The simulation re-settles on every distinct graphData object it ingests,
  // so identity-only re-renders must hand it the same reference.
  const signature = `${nodes.length}:${links.length}:${nodes.map((node) => node.id).join(",")}`;

  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const graphData = useMemo(() => {
    // Unpositioned nodes start on a golden-angle spiral; d3 keeps existing
    // x/y, so a settled graph that re-ingests barely moves.
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    nodes.forEach((node, index) => {
      if (node.x == null || node.y == null) {
        const radius = Math.sqrt(index + 0.5) * 16;
        node.x = Math.cos(index * goldenAngle) * radius;
        node.y = Math.sin(index * goldenAngle) * radius;
      }
    });
    return { nodes, links };
  }, [signature]);

  useEffect(() => {
    const apply = () => {
      const fg = graphRef.current;
      if (!fg) return false;
      const link = fg.d3Force("link");
      const charge = fg.d3Force("charge");
      if (!link || !charge) return false;

      fg.d3Force("collide", collideForce(4, 0.9));
      // Capped range so a transiently clustered layout can't fling nodes
      // off-screen before collide and link forces settle it.
      charge
        .strength((node: GraphNode) => -34 - Math.sqrt(node.val ?? 1) * 7)
        .distanceMax(320);
      link
        .distance(
          (edge: SimLink) =>
            nodeRadius(endpointVal(edge.source)) +
            nodeRadius(endpointVal(edge.target)) +
            26,
        )
        .strength((edge: SimLink) => (edge.type === "membership" ? 0.4 : 0.7));
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

  const resolve = (node: GraphNode) =>
    typeof node.id === "string" ? byId.get(node.id) : undefined;

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
            withAlpha(
              theme.mutedForeground,
              link.type === "membership" ? 0.27 : 0.13,
            )
          }
          linkWidth={(link) => (link.type === "membership" ? 0.5 : 0.3)}
          cooldownTicks={forcesReady ? 180 : 0}
          d3VelocityDecay={0.45}
          onNodeHover={(node) => {
            setHoveredId(node && typeof node.id === "string" ? node.id : null);
            if (containerRef.current) {
              containerRef.current.style.cursor = node ? "pointer" : "default";
            }
          }}
          onNodeClick={(node) => {
            const data = resolve(node);
            if (data?.type === "item" && data.item !== undefined)
              onSelectItem(data.item);
            if (data?.type === "group" && data.group !== undefined)
              onSelectGroup(data.group);
          }}
          onLinkClick={(link) => {
            if (link.type !== "relation") return;
            const sourceId = endpointId(link.source);
            if (sourceId) onRelationClick?.(sourceId);
          }}
          onNodeRightClick={(node, event) => {
            const data = resolve(node);
            if (data?.type === "item" && data.item !== undefined) {
              onItemContextMenu?.(data.item, event);
            } else if (data?.type === "group" && data.group !== undefined) {
              onGroupContextMenu?.(data.group, event);
            }
          }}
          onBackgroundRightClick={(event) => onBackgroundContextMenu?.(event)}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(node, context, globalScale) => {
            if (node.x == null || node.y == null) return;
            // The simulation keeps the objects it first ingested; colour and
            // label come from the current props so a theme switch repaints.
            const current = resolve(node) ?? node;

            const radius = nodeRadius(node.val);
            const isHovered = hoveredId === node.id;

            let image: HTMLImageElement | null = null;
            const src = current.image;
            if (src) {
              const cached = imageCacheRef.current.get(src);
              if (cached === undefined) {
                // No crossOrigin: the Tauri webview origin fails CORS against
                // the photo host. Drawing taints the canvas, but nothing
                // reads pixels back.
                const element = new window.Image();
                element.onload = () => setLoadedImageCount((n) => n + 1);
                element.onerror = () => imageCacheRef.current.set(src, "error");
                element.src = src;
                imageCacheRef.current.set(src, element);
              } else if (cached !== "error" && cached.complete) {
                image = cached;
              }
            }

            context.beginPath();
            context.arc(node.x, node.y, radius, 0, 2 * Math.PI);
            context.fillStyle = current.color;
            context.fill();

            if (image) {
              context.save();
              context.beginPath();
              context.arc(node.x, node.y, radius, 0, 2 * Math.PI);
              context.clip();
              context.drawImage(
                image,
                node.x - radius,
                node.y - radius,
                radius * 2,
                radius * 2,
              );
              context.restore();
              context.beginPath();
              context.arc(node.x, node.y, radius, 0, 2 * Math.PI);
              context.strokeStyle = current.color;
              context.lineWidth = Math.max(radius * 0.12, 0.4 / globalScale);
              context.stroke();
            }

            if (!isHovered && globalScale < LABEL_ZOOM_THRESHOLD) return;

            const isGroup = node.type === "group";
            drawNodeLabel(context, {
              text: truncateLabel(current.label, isGroup ? 28 : 36),
              x: node.x,
              y: node.y + radius,
              globalScale,
              theme,
              weight: isGroup ? 600 : 500,
              size: isGroup ? 11 : 9,
            });
          }}
          nodePointerAreaPaint={(node, color, context) => {
            if (node.x == null || node.y == null) return;
            context.fillStyle = color;
            context.beginPath();
            context.arc(
              node.x,
              node.y,
              nodeRadius(node.val) + 2,
              0,
              2 * Math.PI,
            );
            context.fill();
          }}
        />
      )}
    </div>
  );
}
