export interface Cell {
  gx: number;
  gy: number;
}

export interface Pitch {
  /** Poster width in CSS pixels. */
  cell: number;
  gap: number;
  /** Centre-to-centre distance between columns and between rows. */
  x: number;
  y: number;
}

export const CAPTION_HEIGHT = 54;

/** Bigger posters on a TV-sized screen, smaller on a phone; never a zoom. */
export function pitchFor(viewportWidth: number, tv: boolean): Pitch {
  const cell = tv
    ? Math.round(Math.min(260, Math.max(200, viewportWidth / 8)))
    : viewportWidth < 640
      ? 116
      : viewportWidth < 1100
        ? 150
        : 172;
  const gap = Math.round(cell * 0.16);
  return {
    cell,
    gap,
    x: cell + gap,
    y: Math.round(cell * 1.5) + CAPTION_HEIGHT + gap,
  };
}

export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Cells to render around the focus: the screen plus a margin to scroll into. */
export function visibleRange(
  focus: Cell,
  viewport: { width: number; height: number },
  pitch: Pitch,
  margin = 2,
): { x0: number; x1: number; y0: number; y1: number } {
  const halfCols = Math.ceil(viewport.width / pitch.x / 2) + margin;
  const halfRows = Math.ceil(viewport.height / pitch.y / 2) + margin;
  return {
    x0: focus.gx - halfCols,
    x1: focus.gx + halfCols,
    y0: focus.gy - halfRows,
    y1: focus.gy + halfRows,
  };
}

export const BLOCK = { w: 24, h: 16 } as const;

/** Data is fetched in blocks aligned to the wrapped lattice, so revisits hit the cache. */
export function blocksFor(
  range: { x0: number; x1: number; y0: number; y1: number },
  size: { width: number; height: number },
): { bx: number; by: number }[] {
  const seen = new Set<string>();
  const blocks: { bx: number; by: number }[] = [];
  for (let gy = range.y0; gy <= range.y1; gy++) {
    for (let gx = range.x0; gx <= range.x1; gx++) {
      const bx = Math.floor(wrap(gx, size.width) / BLOCK.w);
      const by = Math.floor(wrap(gy, size.height) / BLOCK.h);
      const key = `${bx},${by}`;
      if (!seen.has(key)) {
        seen.add(key);
        blocks.push({ bx, by });
      }
    }
  }
  return blocks;
}

export function wrappedKey(
  cell: Cell,
  size: { width: number; height: number },
) {
  return `${wrap(cell.gx, size.width)},${wrap(cell.gy, size.height)}`;
}

/** Shortest distance on a torus, since walking off one edge comes back on the other. */
export function torusDistance(
  a: Cell,
  b: Cell,
  size: { width: number; height: number },
): number {
  const dx = Math.abs(wrap(a.gx, size.width) - wrap(b.gx, size.width));
  const dy = Math.abs(wrap(a.gy, size.height) - wrap(b.gy, size.height));
  return Math.hypot(
    Math.min(dx, size.width - dx),
    Math.min(dy, size.height - dy),
  );
}

export function nearestRegion<T extends Cell & { genre: string }>(
  focus: Cell,
  regions: readonly T[],
  size: { width: number; height: number },
): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    const distance = torusDistance(focus, region, size);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region;
    }
  }
  return best;
}

export const ARROWS: Record<string, Cell> = {
  ArrowLeft: { gx: -1, gy: 0 },
  ArrowRight: { gx: 1, gy: 0 },
  ArrowUp: { gx: 0, gy: -1 },
  ArrowDown: { gx: 0, gy: 1 },
};
