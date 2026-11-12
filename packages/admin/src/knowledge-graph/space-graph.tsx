"use client";

import type {
  KnowledgeSourceKind,
  KnowledgeSpaceNode,
  KnowledgeSpaceResponse,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { FilterTabs } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { RefreshCcw } from "lucide-react";
import dynamic from "next/dynamic";
import {
  type ComponentType,
  type ReactNode,
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
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { getKnowledgeSpace, recomputeKnowledgeSpace } from "./api";
import {
  drawNodeLabel,
  type GraphTheme,
  truncateLabel,
  useElementSize,
  useGraphTheme,
  withAlpha,
} from "./theme";

export interface KnowledgeSpaceGraphProps {
  notebookId?: string;
  highlightKeys?: string[];
  onSelect?: (key: string) => void;
  height?: number;
  /** Rendered at the start of the overlay toolbar (the notes page puts its mode switch here). */
  toolbarStart?: ReactNode;
}

type ColorBy = "group" | "course" | "kind";

type SpaceNodeData = {
  id: string;
  kind: KnowledgeSourceKind;
  title: string;
  radius: number;
  colorValue: string | null;
  highlighted: boolean;
  x: number;
  y: number;
  fx: number;
  fy: number;
};

type SpaceNode = NodeObject<SpaceNodeData>;
type SpaceGraphRef = ForceGraphMethods<SpaceNodeData, object>;

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as ComponentType<
  ForceGraphProps<SpaceNodeData, object> & { ref?: Ref<SpaceGraphRef> }
>;

const POLL_MS = 5_000;
const CANVAS_PADDING = 36;
const LABEL_ZOOM = 2.6;
const NEIGHBOR_LABEL_ZOOM = 1.4;
const DIMMED_ALPHA = 0.16;

const KIND_LABEL: Record<KnowledgeSourceKind, string> = {
  note: "Note",
  document: "Document",
  "voice-note": "Voice note",
};
const KIND_ORDER: KnowledgeSourceKind[] = ["note", "document", "voice-note"];

type LoadState =
  | { status: "loading"; scope: string }
  | { status: "error"; scope: string }
  | { status: "ready"; scope: string; data: KnowledgeSpaceResponse };

function nodeRadius(chunkCount: number): number {
  return Math.min(2.5 + Math.sqrt(Math.max(chunkCount, 0)) * 1.3, 16);
}

function colorValueOf(node: KnowledgeSpaceNode, by: ColorBy): string | null {
  if (by === "kind") return node.kind;
  if (by === "course") return node.courseIds[0] ?? null;
  return node.groupIds[0] ?? null;
}

/**
 * Six chart colours can't tell dozens of groups apart, so only the most
 * populous values get one; the long tail reads as muted rather than as a
 * colour that collides with a big cluster.
 */
function buildColorScale(
  nodes: KnowledgeSpaceNode[],
  by: ColorBy,
  theme: GraphTheme,
): (value: string | null) => string {
  const fallback = withAlpha(theme.mutedForeground, 0.55);
  if (by === "kind") {
    const byKind = new Map<string, string>(
      KIND_ORDER.map((kind, index) => [
        kind,
        theme.palette[index % theme.palette.length],
      ]),
    );
    return (value) => (value ? (byKind.get(value) ?? fallback) : fallback);
  }
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const value = colorValueOf(node, by);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, theme.palette.length);
  const assigned = new Map(
    ranked.map(([value], index) => [value, theme.palette[index]]),
  );
  return (value) => (value ? (assigned.get(value) ?? fallback) : fallback);
}

function traceGlyph(
  context: CanvasRenderingContext2D,
  kind: KnowledgeSourceKind,
  x: number,
  y: number,
  radius: number,
) {
  context.beginPath();
  if (kind === "document") {
    const half = radius * 0.89;
    context.rect(x - half, y - half, half * 2, half * 2);
  } else if (kind === "voice-note") {
    const reach = radius * 1.25;
    context.moveTo(x, y - reach);
    context.lineTo(x + reach, y);
    context.lineTo(x, y + reach);
    context.lineTo(x - reach, y);
    context.closePath();
  } else {
    context.arc(x, y, radius, 0, 2 * Math.PI);
  }
}

function GlyphIcon({
  kind,
  color,
}: {
  kind: KnowledgeSourceKind;
  color?: string;
}) {
  const fill = color ?? "currentColor";
  return (
    <svg viewBox="0 0 10 10" className="size-2.5 shrink-0" aria-hidden>
      {kind === "document" ? (
        <rect x="1.5" y="1.5" width="7" height="7" fill={fill} />
      ) : kind === "voice-note" ? (
        <path d="M5 0.5 9.5 5 5 9.5 0.5 5Z" fill={fill} />
      ) : (
        <circle cx="5" cy="5" r="4" fill={fill} />
      )}
    </svg>
  );
}

export function KnowledgeSpaceGraph({
  notebookId,
  highlightKeys,
  onSelect,
  height,
  toolbarStart,
}: KnowledgeSpaceGraphProps) {
  const { client } = useAdmin();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(canvasRef);
  const theme = useGraphTheme(containerRef);

  const scope = notebookId ?? "";
  const [state, setState] = useState<LoadState>({ status: "loading", scope });
  const [reloadKey, setReloadKey] = useState(0);
  const [recomputing, setRecomputing] = useState(false);
  const [colorBy, setColorBy] = useState<ColorBy>("group");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const data = await getKnowledgeSpace(client, notebookId, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setState({ status: "ready", scope, data });
        if (data.stale) timer = setTimeout(load, POLL_MS);
      } catch {
        if (controller.signal.aborted) return;
        setState((previous) =>
          previous.status === "ready" && previous.scope === scope
            ? previous
            : { status: "error", scope },
        );
      }
    };
    void load();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [client, notebookId, scope, reloadKey]);

  const data =
    state.status === "ready" && state.scope === scope ? state.data : null;
  const failed = state.status === "error" && state.scope === scope;

  const highlightSignature = (highlightKeys ?? []).join("|");
  const highlightSet = useMemo(
    () => new Set(highlightSignature ? highlightSignature.split("|") : []),
    [highlightSignature],
  );

  const graphData = useMemo(() => {
    if (!data || size.width === 0 || size.height === 0) return null;
    const nodes = data.nodes;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const scale = Math.min(
      Math.max(size.width - CANVAS_PADDING * 2, 1) / spanX,
      Math.max(size.height - CANVAS_PADDING * 2, 1) / spanY,
    );
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const mapped: SpaceNodeData[] = nodes.map((node) => {
      const x = (node.x - midX) * scale;
      const y = (node.y - midY) * scale;
      return {
        id: node.key,
        kind: node.kind,
        title: node.title || "Untitled",
        radius: nodeRadius(node.chunkCount),
        colorValue: colorValueOf(node, colorBy),
        highlighted: highlightSet.has(node.key),
        x,
        y,
        fx: x,
        fy: y,
      };
    });
    // Canvas paints in array order; emphasised nodes go last so they sit on top.
    mapped.sort((a, b) => Number(a.highlighted) - Number(b.highlighted));
    return { nodes: mapped, links: [] };
  }, [data, size.width, size.height, colorBy, highlightSet]);

  const colorOf = useMemo(
    () => (data && theme ? buildColorScale(data.nodes, colorBy, theme) : null),
    [data, colorBy, theme],
  );

  const positions = useMemo(
    () => new Map((graphData?.nodes ?? []).map((node) => [node.id, node])),
    [graphData],
  );

  const similarityFloor = useMemo(() => {
    let min = 1;
    for (const list of Object.values(data?.neighbors ?? {})) {
      for (const neighbor of list) min = Math.min(min, neighbor.similarity);
    }
    return Math.min(min, 0.99);
  }, [data]);

  const activeKey = hoveredKey ?? selectedKey;
  const activeNeighbors = useMemo(() => {
    if (!activeKey || !data) return new Map<string, number>();
    return new Map(
      (data.neighbors[activeKey] ?? []).map((neighbor) => [
        neighbor.key,
        neighbor.similarity,
      ]),
    );
  }, [activeKey, data]);

  const emphasising = highlightSet.size > 0;

  const recompute = async () => {
    setRecomputing(true);
    try {
      await recomputeKnowledgeSpace(client, notebookId);
      setReloadKey((key) => key + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recompute failed");
    } finally {
      setRecomputing(false);
    }
  };

  const coverage = data
    ? `${data.coverage.embedded}/${data.coverage.total}`
    : null;
  const stale = data?.stale ?? false;
  const updatingDot = stale ? (
    <StatusDot
      tone="warning"
      label="Updating"
      className="motion-safe:animate-pulse"
    />
  ) : null;

  const strokeAlpha = (similarity: number) =>
    0.15 +
    0.7 *
      Math.max(
        0,
        Math.min(1, (similarity - similarityFloor) / (1 - similarityFloor)),
      );

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex w-full flex-col bg-background",
        !height && "h-full",
      )}
      style={height ? { height } : undefined}
    >
      <div ref={canvasRef} className="absolute inset-0">
        {failed ? (
          <EmptyState
            label="Failed to load"
            className="h-full"
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Retry
              </Button>
            }
          />
        ) : !data ? (
          <Skeleton className="h-full w-full rounded-none opacity-40" />
        ) : data.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm tabular-nums text-muted-foreground">
            {coverage}
            {updatingDot}
          </div>
        ) : graphData && theme && colorOf ? (
          <div
            className="h-full w-full"
            role="img"
            aria-label={`${data.nodes.length} sources`}
          >
            <ForceGraph2D
              graphData={graphData}
              width={size.width}
              height={size.height}
              backgroundColor={theme.background}
              cooldownTicks={0}
              warmupTicks={0}
              enableNodeDrag={false}
              minZoom={0.5}
              maxZoom={14}
              nodeLabel={() => ""}
              onNodeHover={(node) => {
                setHoveredKey(node ? node.id : null);
                if (canvasRef.current) {
                  canvasRef.current.style.cursor = node ? "pointer" : "default";
                }
              }}
              onNodeClick={(node) => {
                setSelectedKey(node.id);
                onSelect?.(node.id);
              }}
              onBackgroundClick={() => setSelectedKey(null)}
              onRenderFramePre={(context, globalScale) => {
                if (!activeKey) return;
                const from = positions.get(activeKey);
                if (!from) return;
                context.lineWidth = 1 / globalScale;
                for (const [key, similarity] of activeNeighbors) {
                  const to = positions.get(key);
                  if (!to) continue;
                  context.strokeStyle = withAlpha(
                    theme.foreground,
                    strokeAlpha(similarity),
                  );
                  context.beginPath();
                  context.moveTo(from.x, from.y);
                  context.lineTo(to.x, to.y);
                  context.stroke();
                }
              }}
              nodeCanvasObjectMode={() => "replace"}
              nodeCanvasObject={(node: SpaceNode, context, globalScale) => {
                const x = node.fx;
                const y = node.fy;
                const isActive = node.id === activeKey;
                const isNeighbor = activeNeighbors.has(node.id);
                const lit =
                  !emphasising || node.highlighted || isActive || isNeighbor;

                context.globalAlpha = lit ? 1 : DIMMED_ALPHA;
                traceGlyph(context, node.kind, x, y, node.radius);
                context.fillStyle = colorOf(node.colorValue);
                context.fill();

                if (node.highlighted || isActive) {
                  traceGlyph(
                    context,
                    node.kind,
                    x,
                    y,
                    node.radius + 2 / globalScale,
                  );
                  context.strokeStyle = theme.foreground;
                  context.lineWidth = (isActive ? 1.4 : 1) / globalScale;
                  context.stroke();
                }
                context.globalAlpha = 1;

                const showLabel =
                  isActive ||
                  globalScale >= LABEL_ZOOM ||
                  ((isNeighbor || (emphasising && node.highlighted)) &&
                    globalScale >= NEIGHBOR_LABEL_ZOOM);
                if (!showLabel || !lit) return;
                drawNodeLabel(context, {
                  text: truncateLabel(node.title, 40),
                  x,
                  y: y + node.radius * (node.kind === "voice-note" ? 1.25 : 1),
                  globalScale,
                  theme,
                  weight: isActive ? 600 : 500,
                });
              }}
              nodePointerAreaPaint={(node: SpaceNode, color, context) => {
                context.fillStyle = color;
                context.beginPath();
                context.arc(node.fx, node.fy, node.radius + 2, 0, 2 * Math.PI);
                context.fill();
              }}
            />
          </div>
        ) : null}
      </div>

      {toolbarStart || (data && data.nodes.length > 0) ? (
        <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-1">
          {toolbarStart ? (
            <div className="pointer-events-auto rounded-md bg-background/85 px-1 backdrop-blur-sm">
              {toolbarStart}
            </div>
          ) : (
            <span />
          )}
          {data && data.nodes.length > 0 && (
            <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-background/85 px-1 backdrop-blur-sm">
              <FilterTabs
                value={colorBy}
                onChange={setColorBy}
                options={[
                  { value: "group", label: "Group" },
                  { value: "course", label: "Course" },
                  { value: "kind", label: "Kind" },
                ]}
              />
              <span
                className="px-1.5 text-xs tabular-nums text-muted-foreground"
                title="Embedded"
              >
                {coverage}
              </span>
              {updatingDot}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Recompute"
                title="Recompute"
                disabled={recomputing || stale}
                onClick={() => void recompute()}
              >
                <RefreshCcw
                  className={
                    recomputing ? "motion-safe:animate-spin" : undefined
                  }
                />
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {data && data.nodes.length > 0 && (
        <ul className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          {KIND_ORDER.filter((kind) =>
            data.nodes.some((node) => node.kind === kind),
          ).map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <GlyphIcon
                kind={kind}
                color={
                  colorBy === "kind" && colorOf ? colorOf(kind) : undefined
                }
              />
              {KIND_LABEL[kind]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
