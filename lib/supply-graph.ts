import type { Link, RelationKind } from "./supply-chain-types";

export type GraphNode = {
  id: string;
  ticker: string | null;
  name: string;
  depth: number;
  /** Horizontal position in the value chain: suppliers < 0 < customers. */
  tier: number;
};

export type EdgeKind = "supply" | "partner" | "competitor" | "mention";

export type GraphEdge = {
  id: string;
  /** For supply edges, the seller; otherwise either party. */
  from: string;
  /** For supply edges, the buyer. */
  to: string;
  kind: EdgeKind;
  /** Largest revenue share any filing states for this relationship. */
  share: number | null;
  links: Link[];
};

export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type Point = { x: number; y: number };
export type Layout = "tiered" | "radial" | "force";

const unnamed = /^unnamed/i;
const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const nodeId = (ticker: string | null, name: string) =>
  ticker ? ticker.toUpperCase() : `~${nameKey(name)}`;

/**
 * Builds the visible graph from the root's links plus the links of every
 * expanded company still reachable from the root. Collapsing a company drops
 * whatever was only reachable through it.
 */
export function buildGraph(
  root: { ticker: string; name: string },
  rootLinks: Link[],
  expansions: ReadonlyMap<string, Link[]>,
): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const rootId = nodeId(root.ticker, root.name);
  nodes.set(rootId, {
    id: rootId,
    ticker: root.ticker,
    name: root.name,
    depth: 0,
    tier: 0,
  });

  function attach(owner: GraphNode, links: Link[]) {
    for (const link of links) {
      if (link.role === "mention") continue;
      const id = nodeId(link.ticker, link.counterparty);
      if (id === owner.id) continue;
      const tierShift =
        link.role === "supplier" ? -1 : link.role === "customer" ? 1 : 0;
      if (!nodes.has(id))
        nodes.set(id, {
          id,
          ticker: link.ticker,
          name: link.counterparty,
          depth: owner.depth + 1,
          tier: owner.tier + tierShift,
        });
      const kind: EdgeKind =
        link.role === "supplier" || link.role === "customer"
          ? "supply"
          : link.role;
      const [from, to] =
        link.role === "supplier"
          ? [id, owner.id]
          : link.role === "customer"
            ? [owner.id, id]
            : [owner.id, id].sort();
      const key = `${kind}:${from}>${to}`;
      const edge = edges.get(key) ?? {
        id: key,
        from,
        to,
        kind,
        share: null,
        links: [],
      };
      if (!edge.links.some((item) => item.quote === link.quote))
        edge.links.push(link);
      if (link.share != null)
        edge.share = Math.max(edge.share ?? 0, link.share);
      edges.set(key, edge);
    }
  }

  attach(nodes.get(rootId)!, rootLinks);
  const done = new Set<string>([rootId]);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [ticker, links] of expansions) {
      const node = nodes.get(nodeId(ticker, ticker));
      if (!node || done.has(node.id)) continue;
      done.add(node.id);
      attach(node, links);
      progressed = true;
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export type GraphFilter = {
  kinds: ReadonlySet<EdgeKind>;
  minShare: number;
  listedOnly: boolean;
  hideUnnamed: boolean;
  maxDepth: number;
};

/** Applies filters, then keeps only what still connects to the root. */
export function filterGraph(graph: Graph, rootId: string, filter: GraphFilter) {
  const keep = new Map(
    graph.nodes
      .filter(
        (node) =>
          node.id === rootId ||
          (node.depth <= filter.maxDepth &&
            (!filter.listedOnly || node.ticker) &&
            (!filter.hideUnnamed || !unnamed.test(node.name))),
      )
      .map((node) => [node.id, node]),
  );
  const edges = graph.edges.filter(
    (edge) =>
      filter.kinds.has(edge.kind) &&
      keep.has(edge.from) &&
      keep.has(edge.to) &&
      (filter.minShare <= 0 ||
        edge.kind !== "supply" ||
        (edge.share ?? 0) >= filter.minShare),
  );
  const adjacent = new Map<string, string[]>();
  for (const edge of edges) {
    adjacent.set(edge.from, [...(adjacent.get(edge.from) ?? []), edge.to]);
    adjacent.set(edge.to, [...(adjacent.get(edge.to) ?? []), edge.from]);
  }
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adjacent.get(id) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return {
    nodes: graph.nodes.filter((node) => seen.has(node.id)),
    edges: edges.filter((edge) => seen.has(edge.from) && seen.has(edge.to)),
  };
}

const COLUMN = 210;
const ROW = 56;

function tiered(graph: Graph): Map<string, Point> {
  const columns = new Map<number, GraphNode[]>();
  for (const node of graph.nodes)
    columns.set(node.tier, [...(columns.get(node.tier) ?? []), node]);
  const weight = (id: string) =>
    graph.edges
      .filter((edge) => edge.from === id || edge.to === id)
      .reduce((sum, edge) => sum + (edge.share ?? 0.01), 0);
  const positions = new Map<string, Point>();
  for (const [tier, members] of columns) {
    members.sort(
      (a, b) => a.depth - b.depth || weight(b.id) - weight(a.id) || a.name.localeCompare(b.name),
    );
    const ordered: GraphNode[] = [];
    members.forEach((node, index) =>
      index % 2 ? ordered.push(node) : ordered.unshift(node),
    );
    ordered.forEach((node, index) =>
      positions.set(node.id, {
        x: tier * COLUMN,
        y: (index - (ordered.length - 1) / 2) * ROW,
      }),
    );
  }
  return positions;
}

function radial(graph: Graph, rootId: string): Map<string, Point> {
  const positions = new Map<string, Point>([[rootId, { x: 0, y: 0 }]]);
  const rings = new Map<number, GraphNode[]>();
  for (const node of graph.nodes)
    if (node.id !== rootId)
      rings.set(node.depth, [...(rings.get(node.depth) ?? []), node]);
  for (const [depth, members] of rings) {
    members.sort(
      (a, b) => a.tier - b.tier || a.name.localeCompare(b.name),
    );
    const radius = 190 * depth + Math.max(0, members.length - 12) * 6;
    members.forEach((node, index) => {
      const angle =
        Math.PI / 2 + ((index + 0.5) / members.length) * Math.PI * 2;
      positions.set(node.id, {
        x: Math.cos(angle) * radius * 1.25,
        y: Math.sin(angle) * radius,
      });
    });
  }
  return positions;
}

function force(graph: Graph, rootId: string): Map<string, Point> {
  const seed = tiered(graph);
  const ids = graph.nodes.map((node) => node.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const x = ids.map((id) => seed.get(id)?.x ?? 0);
  const y = ids.map((id, i) => (seed.get(id)?.y ?? 0) + ((i * 37) % 11) - 5);
  const links = graph.edges.flatMap((edge) => {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    return a == null || b == null ? [] : [[a, b] as const];
  });
  const root = index.get(rootId) ?? 0;
  const n = ids.length;
  for (let step = 0; step < 320; step++) {
    const heat = 1 - step / 320;
    const dx = new Array<number>(n).fill(0);
    const dy = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const ox = x[i] - x[j];
        const oy = y[i] - y[j];
        const d2 = Math.max(400, ox * ox + oy * oy);
        const push = 26000 / d2;
        const d = Math.sqrt(d2);
        dx[i] += (ox / d) * push;
        dy[i] += (oy / d) * push;
        dx[j] -= (ox / d) * push;
        dy[j] -= (oy / d) * push;
      }
    for (const [a, b] of links) {
      const ox = x[b] - x[a];
      const oy = y[b] - y[a];
      const d = Math.max(1, Math.hypot(ox, oy));
      const pull = (d - 170) * 0.04;
      dx[a] += (ox / d) * pull;
      dy[a] += (oy / d) * pull;
      dx[b] -= (ox / d) * pull;
      dy[b] -= (oy / d) * pull;
    }
    for (let i = 0; i < n; i++) {
      const tierX = graph.nodes[i].tier * COLUMN * 0.6;
      dx[i] += (tierX - x[i]) * 0.01;
      dy[i] -= y[i] * 0.004;
      if (i === root) continue;
      const limit = 30 * heat + 2;
      x[i] += Math.max(-limit, Math.min(limit, dx[i]));
      y[i] += Math.max(-limit, Math.min(limit, dy[i]));
    }
    x[root] = 0;
    y[root] = 0;
  }
  return new Map(ids.map((id, i) => [id, { x: x[i], y: y[i] }]));
}

export function layoutGraph(graph: Graph, rootId: string, layout: Layout) {
  if (layout === "radial") return radial(graph, rootId);
  if (layout === "force") return force(graph, rootId);
  return tiered(graph);
}

export const relationLabel: Record<RelationKind, string> = {
  supplier: "Supplier",
  customer: "Customer",
  partner: "Partner",
  competitor: "Competitor",
  mention: "Mention",
};

/** Edges touching the node, described from that node's point of view. */
export function neighbours(graph: Graph, id: string) {
  return graph.edges.flatMap((edge) => {
    if (edge.from !== id && edge.to !== id) return [];
    const other = edge.from === id ? edge.to : edge.from;
    const role: RelationKind =
      edge.kind === "supply"
        ? edge.from === id
          ? "customer"
          : "supplier"
        : edge.kind;
    return [{ edge, other, role }];
  });
}

/**
 * Share of `id`'s revenue from named customers, as stated in `id`'s own
 * filings. Filings state shares against the filer's revenue, so only links
 * sourced from the seller count.
 */
export function concentration(graph: Graph, id: string) {
  return graph.edges
    .filter((edge) => edge.kind === "supply" && edge.from === id)
    .reduce((sum, edge) => {
      const stated = edge.links
        .filter(
          (link) =>
            link.share != null &&
            nodeId(link.source.ticker, link.source.name) === id,
        )
        .map((link) => link.share ?? 0);
      return sum + (stated.length ? Math.max(...stated) : 0);
    }, 0);
}

/**
 * Propagates a revenue shock at `rootId` up the supply chain: a supplier
 * loses `share × shock` of revenue for every customer hit by `shock`, where
 * `share` is the customer's stated share of that supplier's revenue. Shares
 * are only known where filings state them, so this is a lower bound.
 */
export function propagateShock(
  graph: Graph,
  rootId: string,
  shock: number,
  depth = 4,
) {
  const impact = new Map<string, number>([[rootId, shock]]);
  let frontier = new Map<string, number>([[rootId, shock]]);
  for (let level = 0; level < depth && frontier.size; level++) {
    const next = new Map<string, number>();
    for (const [buyer, hit] of frontier)
      for (const edge of graph.edges) {
        if (edge.kind !== "supply" || edge.to !== buyer || edge.share == null)
          continue;
        if (edge.from === rootId) continue;
        const passed = hit * edge.share;
        if (Math.abs(passed) < 0.0001) continue;
        next.set(edge.from, (next.get(edge.from) ?? 0) + passed);
      }
    for (const [id, value] of next) impact.set(id, (impact.get(id) ?? 0) + value);
    frontier = next;
  }
  return impact;
}
