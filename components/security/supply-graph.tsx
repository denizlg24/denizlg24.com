"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DropdownMenu } from "radix-ui";
import {
  Download,
  ExternalLink,
  Maximize2,
  Minus,
  Plus,
  Share2,
} from "lucide-react";
import { api } from "@/components/shared";
import { useQuotes } from "@/components/market-widgets";
import type { Link, OwnDisclosure } from "@/lib/supply-chain-types";
import {
  buildGraph,
  concentration,
  filterGraph,
  layoutGraph,
  neighbours,
  nodeId,
  relationLabel,
  type EdgeKind,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Layout,
  type Point,
} from "@/lib/supply-graph";
import { downloadCsv, downloadPng, downloadSvg } from "@/lib/export";
import type { SecurityFunction } from "@/lib/terminal";
import { amount, compact, percent, tone } from "@/lib/utils";

type Expansion =
  | { state: "loading" }
  | { state: "done"; links: Link[]; name: string }
  | { state: "failed"; error: string };

type ColorMode = "move" | "chain" | "depth";
type SizeMode = "uniform" | "cap";
type View = { x: number; y: number; k: number };

const NODE_W = 148;
const NODE_H = 40;
const MAX_EXPANSIONS = 24;
const layouts: [Layout, string][] = [
  ["tiered", "Chain"],
  ["radial", "Radial"],
  ["force", "Force"],
];
const colorModes: [ColorMode, string][] = [
  ["move", "Day move"],
  ["chain", "Position"],
  ["depth", "Degree"],
];
const kindLabels: [EdgeKind, string][] = [
  ["supply", "Supply"],
  ["partner", "Partners"],
  ["competitor", "Competitors"],
];
const shareSteps = [0, 0.01, 0.05, 0.1, 0.2];

const heat = (value: number | null | undefined) => {
  if (value == null) return "none";
  if (value >= 3) return "gain-3";
  if (value >= 1) return "gain-2";
  if (value > 0) return "gain-1";
  if (value <= -3) return "loss-3";
  if (value <= -1) return "loss-2";
  if (value < 0) return "loss-1";
  return "flat";
};
const truncate = (text: string, size: number) =>
  text.length > size ? `${text.slice(0, size - 1)}…` : text;

function useExpansions() {
  const [expansions, setExpansions] = useState<Record<string, Expansion>>({});
  const latest = useRef(expansions);
  useEffect(() => {
    latest.current = expansions;
  }, [expansions]);
  const expand = useCallback((ticker: string) => {
    const current = latest.current;
    if (current[ticker] && current[ticker].state !== "failed") return;
    if (Object.keys(current).length >= MAX_EXPANSIONS) return;
    latest.current = { ...current, [ticker]: { state: "loading" } };
    setExpansions((now) => ({ ...now, [ticker]: { state: "loading" } }));
    void api<OwnDisclosure>(
      `/api/supply-chain?${new URLSearchParams({ symbol: ticker, part: "own" })}`,
    )
      .then((result) =>
        setExpansions((now) =>
          now[ticker]
            ? {
                ...now,
                [ticker]: {
                  state: "done",
                  links: result.links,
                  name: result.filing.name,
                },
              }
            : now,
        ),
      )
      .catch((error: Error) =>
        setExpansions((now) =>
          now[ticker]
            ? { ...now, [ticker]: { state: "failed", error: error.message } }
            : now,
        ),
      );
  }, []);
  const collapse = useCallback(
    (ticker: string) =>
      setExpansions((current) => {
        const next = { ...current };
        delete next[ticker];
        return next;
      }),
    [],
  );
  return { expansions, expand, collapse, reset: () => setExpansions({}) };
}

function edgePath(a: Point, b: Point, bend: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const trim = (ox: number, oy: number) => {
    const tx = Math.abs(ox) > 0 ? NODE_W / 2 / Math.abs(ox) : Infinity;
    const ty = Math.abs(oy) > 0 ? NODE_H / 2 / Math.abs(oy) : Infinity;
    return Math.min(tx, ty) + 4;
  };
  const cut = trim(ux, uy);
  const start = { x: a.x + ux * cut, y: a.y + uy * cut };
  const end = { x: b.x - ux * (cut + 3), y: b.y - uy * (cut + 3) };
  const mid = {
    x: (start.x + end.x) / 2 - uy * length * bend,
    y: (start.y + end.y) / 2 + ux * length * bend,
  };
  return {
    d: `M${start.x},${start.y} Q${mid.x},${mid.y} ${end.x},${end.y}`,
    label: {
      x: (start.x + 2 * mid.x + end.x) / 4,
      y: (start.y + 2 * mid.y + end.y) / 4,
    },
  };
}

function fit(positions: Map<string, Point>, width: number, height: number): View {
  if (!positions.size || !width || !height) return { x: width / 2, y: height / 2, k: 1 };
  const xs = [...positions.values()].map((point) => point.x);
  const ys = [...positions.values()].map((point) => point.y);
  const minX = Math.min(...xs) - NODE_W * 0.75;
  const maxX = Math.max(...xs) + NODE_W * 0.75;
  const minY = Math.min(...ys) - NODE_H * 1.2;
  const maxY = Math.max(...ys) + NODE_H * 1.2;
  const k = Math.min(1.6, Math.max(0.2, Math.min(width / (maxX - minX), height / (maxY - minY))));
  return {
    k,
    x: width / 2 - ((minX + maxX) / 2) * k,
    y: height / 2 - ((minY + maxY) / 2) * k,
  };
}

export function SupplyGraph({
  ticker,
  company,
  links,
  loading,
  select,
  openFunction,
}: {
  ticker: string;
  company: string;
  links: Link[];
  loading: boolean;
  select: (symbol: string) => void;
  openFunction?: (symbol: string, fn: SecurityFunction) => void;
}) {
  const { expansions, expand, collapse, reset } = useExpansions();
  const [layout, setLayout] = useState<Layout>("tiered");
  const [color, setColor] = useState<ColorMode>("move");
  const [size, setSize] = useState<SizeMode>("cap");
  const [kinds, setKinds] = useState<Set<EdgeKind>>(
    () => new Set(["supply", "partner", "competitor"]),
  );
  const [minShare, setMinShare] = useState(0);
  const [listedOnly, setListedOnly] = useState(false);
  const [hideUnnamed, setHideUnnamed] = useState(true);
  const [maxDepth, setMaxDepth] = useState(9);
  const [labels, setLabels] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, Point>>({});
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<
    | { type: "pan"; x: number; y: number; view: View; moved: boolean }
    | { type: "node"; id: string; x: number; y: number; origin: Point; moved: boolean }
    | null
  >(null);
  const rootId = nodeId(ticker, company);

  const graph: Graph = useMemo(() => {
    const done = new Map<string, Link[]>();
    for (const [key, value] of Object.entries(expansions))
      if (value.state === "done") done.set(key, value.links);
    return buildGraph({ ticker, name: company }, links, done);
  }, [ticker, company, links, expansions]);
  const visible = useMemo(
    () =>
      filterGraph(graph, rootId, {
        kinds,
        minShare,
        listedOnly,
        hideUnnamed,
        maxDepth,
      }),
    [graph, rootId, kinds, minShare, listedOnly, hideUnnamed, maxDepth],
  );
  const base = useMemo(
    () => layoutGraph(visible, rootId, layout),
    [visible, rootId, layout],
  );
  const positions = useMemo(() => {
    const merged = new Map(base);
    for (const [id, point] of Object.entries(moved))
      if (merged.has(id)) merged.set(id, point);
    return merged;
  }, [base, moved]);

  const symbols = useMemo(
    () =>
      [
        ...new Set(
          visible.nodes.flatMap((node) => (node.ticker ? [node.ticker] : [])),
        ),
      ].slice(0, 120),
    [visible.nodes],
  );
  const { data: quoteData } = useQuotes(symbols, true);
  const quotes = useMemo(
    () => new Map(quoteData?.quotes.map((quote) => [quote.symbol, quote])),
    [quoteData],
  );
  const caps = visible.nodes.flatMap((node) => {
    const cap = node.ticker ? quotes.get(node.ticker)?.cap : null;
    return cap ? [Math.log10(cap)] : [];
  });
  const capRange = caps.length
    ? [Math.min(...caps), Math.max(...caps)]
    : [0, 0];
  const scaleOf = (node: GraphNode) => {
    if (size === "uniform") return node.id === rootId ? 1.15 : 1;
    const cap = node.ticker ? quotes.get(node.ticker)?.cap : null;
    if (!cap) return 1;
    const span = capRange[1] - capRange[0] || 1;
    return 0.8 + ((Math.log10(cap) - capRange[0]) / span) * 0.65;
  };

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const nodeCount = visible.nodes.length;
  const fitView = useCallback(
    () => setView(fit(positions, box.width, box.height)),
    [positions, box.width, box.height],
  );
  const fitted = useRef("");
  useEffect(() => {
    const key = `${layout}:${nodeCount}:${box.width > 0}`;
    if (fitted.current === key || !box.width) return;
    fitted.current = key;
    fitView();
  }, [layout, nodeCount, box.width, fitView]);

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        const k = Math.min(3, Math.max(0.15, current.k * Math.exp(-event.deltaY * 0.0015)));
        return {
          k,
          x: px - ((px - current.x) / current.k) * k,
          y: py - ((py - current.y) / current.k) * k,
        };
      });
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  const zoom = (factor: number) =>
    setView((current) => {
      const k = Math.min(3, Math.max(0.15, current.k * factor));
      const cx = box.width / 2;
      const cy = box.height / 2;
      return {
        k,
        x: cx - ((cx - current.x) / current.k) * k,
        y: cy - ((cy - current.y) / current.k) * k,
      };
    });

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const target = (event.target as Element).closest("[data-node]");
    const id = target?.getAttribute("data-node");
    if (event.button !== 0) return;
    if (id) {
      drag.current = {
        type: "node",
        id,
        x: event.clientX,
        y: event.clientY,
        origin: positions.get(id) ?? { x: 0, y: 0 },
        moved: false,
      };
    } else {
      drag.current = {
        type: "pan",
        x: event.clientX,
        y: event.clientY,
        view,
        moved: false,
      };
    }
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 4) return;
    if (!state.moved) event.currentTarget.setPointerCapture(event.pointerId);
    state.moved = true;
    if (state.type === "pan")
      setView({ ...state.view, x: state.view.x + dx, y: state.view.y + dy });
    else {
      const { id, origin } = state;
      setMoved((current) => ({
        ...current,
        [id]: { x: origin.x + dx / view.k, y: origin.y + dy / view.k },
      }));
    }
  }
  function pointerUp() {
    const state = drag.current;
    drag.current = null;
    if (!state || state.moved) return;
    setSelected(state.type === "node" ? state.id : null);
  }

  const focus = hovered ?? selected;
  const linked = useMemo(() => {
    if (!focus) return null;
    const ids = new Set([focus]);
    for (const edge of visible.edges)
      if (edge.from === focus || edge.to === focus) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    return ids;
  }, [focus, visible.edges]);

  const pending = Object.values(expansions).filter(
    (item) => item.state === "loading",
  ).length;
  const firstDegree = visible.nodes.filter(
    (node) => node.depth === 1 && node.ticker && !expansions[node.ticker],
  );
  const filename = `${ticker}-supply-chain`;
  const edgeRows = () =>
    visible.edges.map((edge) => {
      const from = visible.nodes.find((node) => node.id === edge.from);
      const to = visible.nodes.find((node) => node.id === edge.to);
      const source = edge.links[0]?.source;
      return {
        seller: from?.ticker ?? from?.name,
        buyer: to?.ticker ?? to?.name,
        kind: edge.kind,
        share: edge.share,
        period: edge.links[0]?.period ?? "",
        filing: source ? `${source.name} ${source.form} ${source.filed}` : "",
        url: source?.url ?? "",
        quote: edge.links[0]?.quote ?? "",
      };
    });
  const selectedNode = visible.nodes.find((node) => node.id === selected);

  return (
    <div className="graph-shell">
      <div className="graph-toolbar">
        <div className="seg" role="group" aria-label="Layout">
          {layouts.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={layout === key}
              onClick={() => {
                setLayout(key);
                setMoved({});
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Colour nodes by">
          {colorModes.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={color === key}
              onClick={() => setColor(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="chip"
          aria-pressed={size === "cap"}
          title="Size companies by market cap"
          onClick={() => setSize(size === "cap" ? "uniform" : "cap")}
        >
          Size by cap
        </button>
        {kindLabels.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className="chip"
            data-kind={kind}
            aria-pressed={kinds.has(kind)}
            onClick={() =>
              setKinds((current) => {
                const next = new Set(current);
                if (next.has(kind)) next.delete(kind);
                else next.add(kind);
                return next;
              })
            }
          >
            {label}
          </button>
        ))}
        <label className="graph-select">
          Min share
          <select
            value={minShare}
            onChange={(event) => setMinShare(Number(event.target.value))}
          >
            {shareSteps.map((step) => (
              <option key={step} value={step}>
                {step ? `≥${step * 100}%` : "Any"}
              </option>
            ))}
          </select>
        </label>
        <label className="graph-select">
          Degrees
          <select
            value={maxDepth}
            onChange={(event) => setMaxDepth(Number(event.target.value))}
          >
            <option value={1}>1st</option>
            <option value={2}>2nd</option>
            <option value={3}>3rd</option>
            <option value={9}>All</option>
          </select>
        </label>
        <button
          type="button"
          className="chip"
          aria-pressed={listedOnly}
          onClick={() => setListedOnly(!listedOnly)}
          title="Only companies with a ticker"
        >
          Listed only
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={!hideUnnamed}
          onClick={() => setHideUnnamed(!hideUnnamed)}
          title="Show 'unnamed customer' disclosures"
        >
          Unnamed
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={labels}
          onClick={() => setLabels(!labels)}
          title="Revenue share labels on links"
        >
          Labels
        </button>
      </div>
      <div className="graph-body">
        <div className="graph-frame" ref={frame}>
          <svg
            ref={svg}
            className="graph-canvas"
            role="img"
            aria-label={`Supply chain network for ${ticker}: ${visible.nodes.length} companies, ${visible.edges.length} relationships`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={() => (drag.current = null)}
            onDoubleClick={(event) => {
              const id = (event.target as Element)
                .closest("[data-node]")
                ?.getAttribute("data-node");
              const node = visible.nodes.find((item) => item.id === id);
              if (!node?.ticker || node.id === rootId) return;
              if (expansions[node.ticker]) collapse(node.ticker);
              else expand(node.ticker);
            }}
          >
            <defs>
              {(["supply", "partner", "competitor"] as const).map((kind) => (
                <marker
                  key={kind}
                  id={`arrow-${kind}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="9"
                  markerHeight="9"
                  markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" className={`graph-arrow-${kind}`} />
                </marker>
              ))}
            </defs>
            <rect
              className="graph-backdrop"
              x={0}
              y={0}
              width={box.width}
              height={box.height}
            />
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {visible.edges.map((edge) => {
                const a = positions.get(edge.from);
                const b = positions.get(edge.to);
                if (!a || !b) return null;
                const twin = visible.edges.some(
                  (other) => other.from === edge.to && other.to === edge.from,
                );
                const path = edgePath(a, b, twin ? 0.12 : 0.06);
                const dim =
                  linked && !(linked.has(edge.from) && linked.has(edge.to));
                const width =
                  edge.kind === "supply"
                    ? Math.min(9, 1.2 + (edge.share ?? 0) * 18)
                    : 1.2;
                return (
                  <g
                    key={edge.id}
                    className="graph-edge"
                    data-kind={edge.kind}
                    data-dim={dim || undefined}
                  >
                    <path
                      d={path.d}
                      strokeWidth={width}
                      markerEnd={
                        edge.kind === "supply" ? `url(#arrow-${edge.kind})` : undefined
                      }
                    >
                      <title>
                        {edge.kind === "supply"
                          ? `${edge.from} sells to ${edge.to}`
                          : `${edge.from} · ${edge.to} (${edge.kind})`}
                        {edge.share != null ? ` · ${amount(edge.share * 100)}% of revenue` : ""}
                      </title>
                    </path>
                    {labels && edge.share != null ? (
                      <text
                        x={path.label.x}
                        y={path.label.y}
                        className="graph-edge-label"
                      >
                        {amount(edge.share * 100)}%
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {visible.nodes.map((node) => {
                const point = positions.get(node.id);
                if (!point) return null;
                const quote = node.ticker ? quotes.get(node.ticker) : undefined;
                const scale = scaleOf(node);
                const expansion = node.ticker ? expansions[node.ticker] : undefined;
                const fill =
                  color === "move"
                    ? heat(quote?.percent)
                    : color === "chain"
                      ? node.id === rootId
                        ? "root"
                        : node.tier < 0
                          ? "up"
                          : node.tier > 0
                            ? "down"
                            : "side"
                      : `d${Math.min(node.depth, 3)}`;
                return (
                  <g
                    key={node.id}
                    data-node={node.id}
                    className="graph-node"
                    data-fill={fill}
                    data-root={node.id === rootId || undefined}
                    data-selected={selected === node.id || undefined}
                    data-dim={(linked && !linked.has(node.id)) || undefined}
                    data-listed={node.ticker ? undefined : "no"}
                    transform={`translate(${point.x},${point.y}) scale(${scale})`}
                    onPointerEnter={() => setHovered(node.id)}
                    onPointerLeave={() => setHovered(null)}
                  >
                    <rect
                      x={-NODE_W / 2}
                      y={-NODE_H / 2}
                      width={NODE_W}
                      height={NODE_H}
                      rx={3}
                    />
                    <text x={-NODE_W / 2 + 8} y={-4} className="graph-node-code">
                      {node.ticker ?? "PRIVATE"}
                    </text>
                    {quote?.percent != null ? (
                      <text
                        x={NODE_W / 2 - 8}
                        y={-4}
                        className="graph-node-move"
                        textAnchor="end"
                      >
                        {percent(quote.percent)}
                      </text>
                    ) : null}
                    <text x={-NODE_W / 2 + 8} y={12} className="graph-node-name">
                      {truncate(node.name, 22)}
                    </text>
                    {expansion ? (
                      <circle
                        cx={NODE_W / 2 - 6}
                        cy={NODE_H / 2 - 6}
                        r={3}
                        className="graph-node-badge"
                        data-state={expansion.state}
                      />
                    ) : null}
                    <title>
                      {node.name}
                      {node.ticker ? ` (${node.ticker})` : ""}
                      {node.ticker && node.id !== rootId
                        ? expansion
                          ? " · double-click to collapse"
                          : " · double-click to expand its chain"
                        : ""}
                    </title>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="graph-controls">
            <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom in">
              <Plus size={14} />
            </button>
            <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom out">
              <Minus size={14} />
            </button>
            <button type="button" onClick={fitView} aria-label="Fit to screen">
              <Maximize2 size={14} />
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button type="button" aria-label="Export">
                  <Download size={14} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu-content" align="end" sideOffset={4}>
                  <DropdownMenu.Item
                    className="menu-item"
                    onSelect={() => svg.current && downloadSvg(svg.current, filename)}
                  >
                    SVG image
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="menu-item"
                    onSelect={() =>
                      svg.current && void downloadPng([svg.current], filename)
                    }
                  >
                    PNG image
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="menu-item"
                    onSelect={() => downloadCsv(edgeRows(), filename)}
                  >
                    Relationships CSV
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
          <div className="graph-legend" aria-hidden>
            <span data-kind="supply">→ sells to</span>
            <span data-kind="partner">partner</span>
            <span data-kind="competitor">competitor</span>
            <span>width = revenue share · drag to move · double-click to expand</span>
          </div>
          {loading || pending ? (
            <div className="graph-status" role="status">
              {loading ? "Reading filings…" : `Expanding ${pending}…`}
            </div>
          ) : null}
        </div>
        <aside className="graph-inspector" aria-label="Selected company">
          {selectedNode ? (
            <Inspector
              node={selectedNode}
              graph={visible}
              rootId={rootId}
              quote={selectedNode.ticker ? quotes.get(selectedNode.ticker) : undefined}
              expansion={
                selectedNode.ticker ? expansions[selectedNode.ticker] : undefined
              }
              nameOf={(id) => {
                const node = visible.nodes.find((item) => item.id === id);
                return node?.ticker ?? node?.name ?? id;
              }}
              choose={setSelected}
              expand={expand}
              collapse={collapse}
              select={select}
              openFunction={openFunction}
            />
          ) : (
            <GraphSummary
              graph={visible}
              total={graph}
              rootId={rootId}
              expansions={expansions}
              firstDegree={firstDegree.length}
              expandAll={() =>
                firstDegree
                  .slice(0, 8)
                  .forEach((node) => node.ticker && expand(node.ticker))
              }
              reset={() => {
                reset();
                setMoved({});
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function GraphSummary({
  graph,
  total,
  rootId,
  expansions,
  firstDegree,
  expandAll,
  reset,
}: {
  graph: Graph;
  total: Graph;
  rootId: string;
  expansions: Record<string, Expansion>;
  firstDegree: number;
  expandAll: () => void;
  reset: () => void;
}) {
  const count = (kind: EdgeKind) =>
    graph.edges.filter((edge) => edge.kind === kind).length;
  const exposure = concentration(graph, rootId);
  const failed = Object.entries(expansions).filter(
    ([, item]) => item.state === "failed",
  );
  return (
    <div className="term-stack">
      <h3 className="graph-inspector-title">Network</h3>
      <dl className="term-fields">
        <div>
          <dt>Companies</dt>
          <dd>
            {graph.nodes.length}
            {total.nodes.length !== graph.nodes.length
              ? ` of ${total.nodes.length}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Supply links</dt>
          <dd>{count("supply")}</dd>
        </div>
        <div>
          <dt>Partners</dt>
          <dd>{count("partner")}</dd>
        </div>
        <div>
          <dt>Competitors</dt>
          <dd>{count("competitor")}</dd>
        </div>
        <div>
          <dt>Named customer share</dt>
          <dd>{exposure ? `${amount(exposure * 100)}%` : "—"}</dd>
        </div>
        <div>
          <dt>Expanded</dt>
          <dd>{Object.keys(expansions).length}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="chip"
        disabled={!firstDegree}
        onClick={expandAll}
        title="Reads each listed counterparty's annual report (up to 8)"
      >
        <Share2 size={13} aria-hidden /> Expand 1st degree
        {firstDegree ? ` (${Math.min(firstDegree, 8)})` : ""}
      </button>
      {Object.keys(expansions).length ? (
        <button type="button" className="chip" onClick={reset}>
          Reset to {rootId}
        </button>
      ) : null}
      {failed.length ? (
        <ul className="graph-failures">
          {failed.map(([key, item]) => (
            <li key={key}>
              <b>{key}</b> {item.state === "failed" ? item.error : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="term-source">
        Select a company to inspect it. Double-click a listed company to pull in
        its own suppliers and customers from its latest annual report. Revenue
        shares are measured against the company that filed.
      </p>
    </div>
  );
}

function Inspector({
  node,
  graph,
  rootId,
  quote,
  expansion,
  nameOf,
  choose,
  expand,
  collapse,
  select,
  openFunction,
}: {
  node: GraphNode;
  graph: Graph;
  rootId: string;
  quote?: { price: number; percent: number | null; cap: number | null; currency: string };
  expansion?: Expansion;
  nameOf: (id: string) => string;
  choose: (id: string) => void;
  expand: (ticker: string) => void;
  collapse: (ticker: string) => void;
  select: (symbol: string) => void;
  openFunction?: (symbol: string, fn: SecurityFunction) => void;
}) {
  const relations = neighbours(graph, node.id).sort(
    (a, b) => (b.edge.share ?? -1) - (a.edge.share ?? -1),
  );
  const exposure = concentration(graph, node.id);
  return (
    <div className="term-stack">
      <h3 className="graph-inspector-title">
        {node.ticker ?? "Private"} <span>{node.name}</span>
      </h3>
      {quote ? (
        <dl className="term-fields">
          <div>
            <dt>Last</dt>
            <dd>
              {amount(quote.price)} {quote.currency}
            </dd>
          </div>
          <div>
            <dt>Day</dt>
            <dd className={tone(quote.percent)}>{percent(quote.percent)}</dd>
          </div>
          <div>
            <dt>Mkt cap</dt>
            <dd>{compact(quote.cap)}</dd>
          </div>
          <div>
            <dt>Degree</dt>
            <dd>{node.depth}</dd>
          </div>
          {exposure ? (
            <div>
              <dt>Named customer share</dt>
              <dd>{amount(exposure * 100)}%</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {node.ticker ? (
        <div className="graph-actions">
          <button type="button" className="chip" onClick={() => select(node.ticker!)}>
            GP
          </button>
          {openFunction ? (
            <>
              <button
                type="button"
                className="chip"
                onClick={() => openFunction(node.ticker!, "DES")}
              >
                DES
              </button>
              {node.id !== rootId ? (
                <button
                  type="button"
                  className="chip"
                  onClick={() => openFunction(node.ticker!, "SPLC")}
                  title="Re-centre the graph on this company"
                >
                  SPLC
                </button>
              ) : null}
            </>
          ) : null}
          {node.id !== rootId ? (
            expansion ? (
              <button
                type="button"
                className="chip"
                onClick={() => collapse(node.ticker!)}
              >
                {expansion.state === "loading" ? "Reading…" : "Collapse"}
              </button>
            ) : (
              <button
                type="button"
                className="chip"
                onClick={() => expand(node.ticker!)}
              >
                Expand chain
              </button>
            )
          ) : null}
        </div>
      ) : null}
      {expansion?.state === "failed" ? (
        <p className="negative graph-note">{expansion.error}</p>
      ) : null}
      <ul className="graph-relations">
        {relations.map(({ edge, other, role }) => (
          <Relation
            key={edge.id}
            edge={edge}
            role={relationLabel[role]}
            other={nameOf(other)}
            onChoose={() => choose(other)}
          />
        ))}
      </ul>
    </div>
  );
}

function Relation({
  edge,
  role,
  other,
  onChoose,
}: {
  edge: GraphEdge;
  role: string;
  other: string;
  onChoose: () => void;
}) {
  const link = edge.links[0];
  return (
    <li data-kind={edge.kind}>
      <div>
        <button type="button" className="security-link" onClick={onChoose}>
          {other}
        </button>
        <span className="graph-role">{role}</span>
        {edge.share != null ? <b>{amount(edge.share * 100)}%</b> : null}
      </div>
      {link ? (
        <details>
          <summary>
            {link.source.ticker ?? link.source.name} {link.source.form} ·{" "}
            {link.source.filed.slice(0, 7)}
            {edge.links.length > 1 ? ` · +${edge.links.length - 1}` : ""}
          </summary>
          {edge.links.map((item) => (
            <blockquote key={item.quote}>
              “{item.quote}”{" "}
              <a href={item.source.url} target="_blank" rel="noreferrer">
                <ExternalLink size={11} aria-label="Open filing" />
              </a>
            </blockquote>
          ))}
        </details>
      ) : null}
    </li>
  );
}
