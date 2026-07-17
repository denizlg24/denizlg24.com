"use client";

import type { AgentMemoryGraphLink, AgentMemoryGraphNode } from "@repo/schemas";
import dynamic from "next/dynamic";
import {
  type ComponentType,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-3d";

type GraphRef = ForceGraphMethods<AgentMemoryGraphNode, AgentMemoryGraphLink>;

/** The force engine writes position/velocity onto the node objects. */
type PositionedNode = AgentMemoryGraphNode & {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
};

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
}) as ComponentType<
  ForceGraphProps<AgentMemoryGraphNode, AgentMemoryGraphLink> & {
    ref?: React.Ref<GraphRef>;
  }
>;

interface Theme {
  background: string;
  foreground: string;
  mutedForeground: string;
  scheme: "dark" | "light";
}

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

const TYPE_HUES: Record<string, number> = {
  core: 270,
  semantic: 210,
  episodic: 145,
  reflection: 40,
};

function nodeColor(node: AgentMemoryGraphNode, scheme: "dark" | "light") {
  if (node.isOwner) {
    return scheme === "dark" ? "hsl(42, 90%, 62%)" : "hsl(40, 85%, 48%)";
  }
  if (node.kind === "entity") {
    return scheme === "dark" ? "hsl(210, 8%, 55%)" : "hsl(210, 8%, 52%)";
  }
  const hue = TYPE_HUES[node.memoryType ?? "semantic"] ?? 210;
  const active = node.status === "active";
  const saturation = active ? 62 : 18;
  const lightness = scheme === "dark" ? (active ? 64 : 45) : active ? 42 : 60;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function nodeTooltip(node: AgentMemoryGraphNode, theme: Theme): string {
  const meta =
    node.kind === "entity"
      ? `${node.isOwner ? "owner · " : ""}${node.entityType ?? "entity"} · ${node.count ?? 0} memories`
      : [
          node.memoryType,
          node.status,
          node.confidence !== undefined
            ? `${Math.round(node.confidence * 100)}%`
            : null,
          node.hasEmbedding ? "embedded" : "no embedding",
        ]
          .filter(Boolean)
          .join(" · ");
  return `<div style="max-width:22rem;padding:6px 8px;border-radius:6px;background:${theme.background}ee;color:${theme.foreground};font:500 12px ui-sans-serif,system-ui,sans-serif;">
    <div>${escapeHtml(node.label)}</div>
    <div style="margin-top:2px;color:${theme.mutedForeground};font-weight:400;">${escapeHtml(meta)}</div>
  </div>`;
}

// Module-level so settled layouts survive page navigations: remounting the
// graph restores every node's last simulated position instead of re-running
// the whole force layout from a random spread. Single-user app, one graph.
let previousNodes = new Map<string, PositionedNode>();

const LEGEND = [
  ["core", "Core"],
  ["semantic", "Semantic"],
  ["episodic", "Episodic"],
  ["reflection", "Reflection"],
] as const;

export function MemoryGraph({
  nodes,
  links,
  onSelectMemory,
}: {
  nodes: AgentMemoryGraphNode[];
  links: AgentMemoryGraphLink[];
  onSelectMemory: (memoryId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphRef | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [theme, setTheme] = useState<Theme | null>(null);

  // Fresh copies: the force engine mutates node/link objects (x/y/z, source/
  // target become object refs), so never hand it the parsed response objects.
  // Nodes that survive a live refresh or a remount inherit their previous
  // position and velocity so the layout settles in place instead of
  // re-exploding.
  const graphData = useMemo(() => {
    const previous = previousNodes;
    const nextNodes = nodes.map((node) => {
      const copy: PositionedNode = { ...node };
      const existing = previous.get(node.id);
      if (existing) {
        copy.x = existing.x;
        copy.y = existing.y;
        copy.z = existing.z;
        copy.vx = existing.vx;
        copy.vy = existing.vy;
        copy.vz = existing.vz;
      }
      // Pin the owner at the origin: the layout arranges around them and the
      // camera's default look-at point keeps the Admin node centered.
      if (node.isOwner) {
        copy.fx = 0;
        copy.fy = 0;
        copy.fz = 0;
      }
      return copy;
    });
    // The engine keeps mutating these objects, so the map always reads the
    // latest simulated positions on the next refresh.
    previousNodes = new Map(nextNodes.map((node) => [node.id, node]));
    return {
      nodes: nextNodes,
      links: links.map((link) => ({ ...link })),
    };
  }, [nodes, links]);

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
    const mutationObserver = new MutationObserver(() =>
      setTheme(readTheme(element)),
    );
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
    <div className="relative h-full w-full" ref={containerRef}>
      {theme && (
        <div className="pointer-events-none absolute top-2 left-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {LEGEND.map(([type, label]) => (
            <span key={type} className="flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-full"
                style={{
                  background: nodeColor(
                    { id: "", kind: "memory", label: "", memoryType: type },
                    theme.scheme,
                  ),
                }}
              />
              {label}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-full"
              style={{
                background: nodeColor(
                  { id: "", kind: "entity", label: "" },
                  theme.scheme,
                ),
              }}
            />
            Entity
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-full"
              style={{
                background: nodeColor(
                  { id: "", kind: "entity", label: "", isOwner: true },
                  theme.scheme,
                ),
              }}
            />
            You
          </span>
        </div>
      )}
      {size.width > 0 && theme && (
        <ForceGraph3D
          ref={graphRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor={theme.background}
          showNavInfo={false}
          nodeRelSize={3}
          nodeVal={(node) => {
            if (node.isOwner) return 24;
            return node.kind === "entity"
              ? 1.5 + Math.min(node.count ?? 0, 20) * 0.3
              : 1 + (node.importance ?? 0.5) * 2;
          }}
          nodeColor={(node) => nodeColor(node, theme.scheme)}
          nodeOpacity={0.85}
          nodeLabel={(node) => nodeTooltip(node, theme)}
          linkColor={(link) => {
            if (link.type === "contradiction") return "#e5484d";
            if (link.type === "similar") return theme.foreground;
            return theme.mutedForeground;
          }}
          linkOpacity={0.22}
          linkWidth={0}
          // No warmup: warmup ticks run synchronously and block first paint.
          // The graph shows immediately and settles on screen instead.
          warmupTicks={0}
          cooldownTicks={260}
          onNodeClick={(node) => {
            if (node.kind === "memory") onSelectMemory(node.id);
          }}
        />
      )}
    </div>
  );
}
