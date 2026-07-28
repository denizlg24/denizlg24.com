"use client";

import type { AgentMemoryGraphLink, AgentMemoryGraphNode } from "@repo/schemas";
import { agentMemoryExploreResponseSchema } from "@repo/schemas";
import dynamic from "next/dynamic";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-3d";
import * as THREE from "three";
import { useAdmin } from "../provider";
import {
  accentFor,
  CARD_HEIGHT,
  CARD_WIDTH,
  type CardTheme,
  drawMemoryCard,
  drawOutlineCard,
} from "./memory-card";
import { MemoryTimeline, type TimelineRange } from "./memory-timeline";

type GraphRef = ForceGraphMethods<AgentMemoryGraphNode, AgentMemoryGraphLink>;

/** Most detail cards alive at once. Each is a ~266 KB texture. */
const DETAIL_BUDGET = 220;
/** A card below this on-screen height is an unreadable smear; stay an outline. */
const DETAIL_MIN_PIXELS = 18;
/** Cards built per pass, so approaching a dense cluster never hitches a frame. */
const CARDS_PER_PASS = 6;
const LOD_INTERVAL_MS = 180;

const CARD_ASPECT = CARD_WIDTH / CARD_HEIGHT;

/* -------------------------------------------------------------------------- */
/* Source images                                                              */

type ImageEntry =
  | { status: "loading" }
  | { status: "ready"; bitmap: ImageBitmap }
  | { status: "error" };

/**
 * Attachment bitmaps, cached per URL and shared across nodes. Bytes come
 * through `fetch` rather than an `<img crossOrigin>`: the same attachments are
 * rendered by plain `<img>` in the Explore dock, and reusing that cache entry
 * under a CORS-mode request yields a texture WebGL refuses to upload.
 */
const imageCache = new Map<string, ImageEntry>();

function requestImage(url: string, onReady: () => void): ImageBitmap | null {
  const cached = imageCache.get(url);
  if (cached?.status === "ready") return cached.bitmap;
  if (cached) return null;
  imageCache.set(url, { status: "loading" });
  void (async () => {
    try {
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) throw new Error(`Image request failed`);
      const bitmap = await createImageBitmap(await response.blob());
      imageCache.set(url, { status: "ready", bitmap });
      onReady();
    } catch {
      imageCache.set(url, { status: "error" });
    }
  })();
  return null;
}

/* -------------------------------------------------------------------------- */

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

type Theme = CardTheme;

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

/** World width of a node's card. Importance and entity weight drive the size. */
function cardWidthFor(node: AgentMemoryGraphNode): number {
  if (node.isOwner) return 46;
  if (node.kind === "entity") return 20 + Math.min(node.count ?? 0, 20) * 0.6;
  return 16 + (node.importance ?? 0.5) * 12;
}

// Module-level so settled layouts survive page navigations: remounting the
// graph restores every node's last simulated position instead of re-running
// the whole force layout from a random spread. Single-user app, one graph.
let previousNodes = new Map<string, PositionedNode>();

interface SpriteEntry {
  node: AgentMemoryGraphNode;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  width: number;
  card: THREE.Texture | null;
  /** Emphasis the current card was drawn with, so a probe change redraws it. */
  cardEmphasis: boolean;
  /** Set when the card was drawn before its image arrived, so it can be redrawn. */
  awaitingImage: boolean;
}

export function MemoryGraph({
  nodes,
  links,
  onSelectMemory,
}: {
  nodes: AgentMemoryGraphNode[];
  links: AgentMemoryGraphLink[];
  onSelectMemory: (memoryId: string) => void;
}) {
  const { client } = useAdmin();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphRef | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [theme, setTheme] = useState<Theme | null>(null);
  const [probe, setProbe] = useState("");
  const [probing, setProbing] = useState(false);
  // null means no probe ran; an empty set is a probe that recalled nothing.
  const [probeIds, setProbeIds] = useState<ReadonlySet<string> | null>(null);
  const [range, setRange] = useState<TimelineRange | null>(null);

  const sprites = useRef(new Map<string, SpriteEntry>());
  const outlineTexture = useRef<THREE.Texture | null>(null);

  /** Probe ∩ timeline range. Null when neither filter is active. */
  const highlight = useMemo(() => {
    if (!probeIds && !range) return null;
    const inRange = (node: AgentMemoryGraphNode) => {
      if (!range) return true;
      if (!node.occurredAt) return false;
      const from = new Date(node.occurredAt).getTime();
      const until = node.occurredUntil
        ? new Date(node.occurredUntil).getTime()
        : from;
      // Any overlap with the selected span counts, so a stated range that
      // straddles the boundary still matches.
      return from < range.to && until >= range.from;
    };
    const matched = new Set<string>();
    for (const node of nodes) {
      if (probeIds && !probeIds.has(node.id)) continue;
      if (!inRange(node)) continue;
      matched.add(node.id);
    }
    return matched;
  }, [probeIds, range, nodes]);

  // Read by the LOD loop, which must not restart when these change.
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const themeRef = useRef(theme);
  themeRef.current = theme;

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
    sprites.current.clear();
    return {
      nodes: nextNodes,
      links: links.map((link) => ({ ...link })),
    };
  }, [nodes, links]);

  const applyAppearance = useCallback((entry: SpriteEntry) => {
    const active = highlightRef.current;
    const dimmed = Boolean(active && !active.has(entry.node.id));
    const matched = Boolean(active?.has(entry.node.id));
    const scheme = themeRef.current?.scheme ?? "dark";

    // A drawn card is an opaque panel and must occlude what is behind it.
    // Alpha-blended sprites with depthWrite off let the whole lattice bleed
    // through, which is what made cards look like glass.
    const solid = entry.card !== null && !dimmed;
    entry.material.transparent = !solid;
    entry.material.depthWrite = solid;
    entry.material.opacity = dimmed ? 0.1 : 1;
    // Cards carry their own colour; the shared outline is drawn white so the
    // tint is what encodes the memory type at distance.
    entry.material.color.set(
      dimmed
        ? scheme === "dark"
          ? "#3a3f45"
          : "#c8ccd2"
        : entry.card
          ? "#ffffff"
          : accentFor(entry.node, scheme),
    );
    entry.material.needsUpdate = true;

    const width = entry.width * (matched ? 2.6 : 1);
    entry.sprite.scale.set(width, width / CARD_ASPECT, 1);
    // Probe hits ride above the field so they are never buried in a cluster.
    entry.sprite.renderOrder = matched ? 2 : 0;
  }, []);

  // Repaint tints and sizes in place — cheaper and steadier than letting
  // react-force-graph rebuild every node object when a filter changes.
  useEffect(() => {
    for (const entry of sprites.current.values()) applyAppearance(entry);
  }, [applyAppearance]);
  useEffect(() => {
    for (const entry of sprites.current.values()) applyAppearance(entry);
  }, [highlight, applyAppearance]);

  /**
   * Level of detail: each pass ranks live sprites by projected on-screen size
   * and gives the largest ones a drawn card, reverting the rest to the shared
   * outline. Card construction is spread over passes so approaching a cluster
   * never blocks a frame.
   */
  useEffect(() => {
    if (!theme || size.width === 0) return;
    let frame = 0;
    let last = 0;

    const run = (time: number) => {
      frame = requestAnimationFrame(run);
      if (time - last < LOD_INTERVAL_MS) return;
      last = time;

      const graph = graphRef.current;
      const camera = graph?.camera() as THREE.PerspectiveCamera | undefined;
      if (!camera || !outlineTexture.current) return;

      const halfFovTangent = Math.tan(((camera.fov ?? 50) * Math.PI) / 360);
      const active = highlightRef.current;
      const wanted: SpriteEntry[] = [];
      for (const entry of sprites.current.values()) {
        const distance = camera.position.distanceTo(entry.sprite.position);
        const pixels =
          ((entry.width / CARD_ASPECT) * size.height) /
          (2 * Math.max(distance, 1) * halfFovTangent);
        // A probe hit always gets a card regardless of distance — being able
        // to read the results is the point of searching. Hover does not:
        // hovering a card that is already legible adds nothing.
        if (
          active?.has(entry.node.id) ||
          entry.node.isOwner === true ||
          pixels >= DETAIL_MIN_PIXELS
        ) {
          wanted.push(entry);
        }
      }
      // Hits first, then nearest, so a full budget never starves the results.
      wanted.sort((a, b) => {
        const hitA = active?.has(a.node.id) ? 0 : 1;
        const hitB = active?.has(b.node.id) ? 0 : 1;
        if (hitA !== hitB) return hitA - hitB;
        return (
          camera.position.distanceTo(a.sprite.position) -
          camera.position.distanceTo(b.sprite.position)
        );
      });
      const keep = new Set(wanted.slice(0, DETAIL_BUDGET));

      for (const entry of sprites.current.values()) {
        if (entry.card && !keep.has(entry)) {
          entry.card.dispose();
          entry.card = null;
          entry.awaitingImage = false;
          entry.material.map = outlineTexture.current;
          applyAppearance(entry);
        }
      }

      let built = 0;
      const currentTheme = themeRef.current;
      if (!currentTheme) return;
      for (const entry of keep) {
        const emphasis = Boolean(active?.has(entry.node.id));
        const stale =
          !entry.card || entry.awaitingImage || entry.cardEmphasis !== emphasis;
        if (!stale) continue;
        if (built >= CARDS_PER_PASS) break;
        const url = entry.node.imageUrl;
        const bitmap = url
          ? requestImage(url, () => {
              // Redraw happens on a later pass; awaitingImage keeps it queued.
            })
          : null;
        entry.card?.dispose();
        const texture = new THREE.CanvasTexture(
          drawMemoryCard(entry.node, currentTheme, bitmap, emphasis),
        );
        texture.colorSpace = THREE.SRGBColorSpace;
        entry.card = texture;
        entry.cardEmphasis = emphasis;
        entry.awaitingImage = Boolean(
          url && !bitmap && imageCache.get(url)?.status !== "error",
        );
        entry.material.map = texture;
        applyAppearance(entry);
        built += 1;
      }
    };

    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [theme, size.width, size.height]);

  // Same retrieval path as the Explore dock: the embedding index, no model in
  // between. Only the matched ids are kept — the graph is the result view.
  const runProbe = async () => {
    const query = probe.trim();
    if (query.length < 2) {
      setProbeIds(null);
      return;
    }
    setProbing(true);
    try {
      const raw = await client.post<unknown>("agent-memory/explore", { query });
      const response = agentMemoryExploreResponseSchema.parse(raw);
      setProbeIds(new Set(response.results.map((hit) => hit.memory.id)));
    } catch {
      setProbeIds(null);
    } finally {
      setProbing(false);
    }
  };

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

  // The shared far-field texture is theme-dependent; rebuild it on a swap and
  // drop every card so the next passes redraw against the new palette.
  useEffect(() => {
    if (!theme) return;
    outlineTexture.current?.dispose();
    const texture = new THREE.CanvasTexture(drawOutlineCard(theme));
    texture.colorSpace = THREE.SRGBColorSpace;
    outlineTexture.current = texture;
    for (const entry of sprites.current.values()) {
      entry.card?.dispose();
      entry.card = null;
      entry.material.map = texture;
      entry.material.needsUpdate = true;
    }
  }, [theme]);

  return (
    <div className="relative h-full w-full" ref={containerRef}>
      {size.width > 0 && theme && (
        <ForceGraph3D
          ref={graphRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor={theme.background}
          showNavInfo={false}
          // No `nodeLabel`: the card already shows the type, statement and
          // date, so a hover tooltip would repeat it back.
          // Every node is a billboarded card: an outline at distance, a drawn
          // readout once it is close enough to read. The LOD pass owns the swap.
          nodeThreeObject={(node) => {
            if (!outlineTexture.current) {
              const texture = new THREE.CanvasTexture(drawOutlineCard(theme));
              texture.colorSpace = THREE.SRGBColorSpace;
              outlineTexture.current = texture;
            }
            const material = new THREE.SpriteMaterial({
              map: outlineTexture.current,
              transparent: true,
              depthWrite: false,
            });
            const sprite = new THREE.Sprite(material);
            const entry: SpriteEntry = {
              node,
              sprite,
              material,
              width: cardWidthFor(node),
              card: null,
              cardEmphasis: false,
              awaitingImage: false,
            };
            sprites.current.set(node.id, entry);
            applyAppearance(entry);
            return sprite;
          }}
          // At ~1400 nodes the edges are the visual noise floor, so they sit
          // just above invisible: contradictions stay findable, everything else
          // recedes to a faint structural hint.
          linkColor={(link) => {
            if (link.type === "contradiction") return "#e5484d";
            return theme.mutedForeground;
          }}
          linkOpacity={0.045}
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

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3">
        <div className="pointer-events-auto flex w-full max-w-lg items-center gap-2 rounded-md border bg-background/70 px-3 py-2 font-mono text-xs backdrop-blur-sm">
          <span className="text-muted-foreground/60">❯</span>
          <input
            value={probe}
            onChange={(event) => setProbe(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void runProbe();
              } else if (event.key === "Escape") {
                setProbe("");
                setProbeIds(null);
              }
            }}
            placeholder="probe the memory lattice…"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/40"
            spellCheck={false}
            autoComplete="off"
          />
          {probing ? (
            <span className="animate-pulse text-muted-foreground">▮</span>
          ) : (
            probeIds && (
              <button
                type="button"
                onClick={() => {
                  setProbe("");
                  setProbeIds(null);
                }}
                className="shrink-0 tabular-nums text-muted-foreground hover:text-foreground"
              >
                {probeIds.size} ✕
              </button>
            )
          )}
        </div>

        {theme && (
          <div className="pointer-events-auto w-full rounded-md border bg-background/70 backdrop-blur-sm">
            <MemoryTimeline
              nodes={nodes}
              range={range}
              onChange={setRange}
              theme={theme}
            />
          </div>
        )}
      </div>
    </div>
  );
}
