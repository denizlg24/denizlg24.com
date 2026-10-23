/**
 * Lays titles on a lattice that keeps taste-space neighbours next to each
 * other: sort by y and cut into rows, then sort each row by x. A 2D sort is
 * not optimal, but it is deterministic, O(n log n), and keeps clusters
 * contiguous, which is all a remote-driven grid needs.
 */
export interface LatticeInput {
  id: string;
  x: number;
  y: number;
}

export interface Lattice<T extends LatticeInput> {
  width: number;
  height: number;
  /** Row-major; `cells[gy * width + gx]`. Every row is full. */
  cells: T[];
}

/** Wide rather than tall: a TV screen shows more columns than rows. */
export function latticeWidth(count: number): number {
  return Math.max(1, Math.round(Math.sqrt(count * 1.6)));
}

/**
 * Callers pass items most important first; the tail that does not fill a
 * whole row is dropped, so wrapping never lands on a hole.
 */
export function layLattice<T extends LatticeInput>(
  items: readonly T[],
): Lattice<T> {
  const width = latticeWidth(items.length);
  const height = Math.floor(items.length / width);
  const byY = items
    .slice(0, width * height)
    .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
  const cells: T[] = [];
  for (let start = 0; start < byY.length; start += width) {
    const row = byY
      .slice(start, start + width)
      .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    cells.push(...row);
  }
  return { width, height, cells };
}

/** Endless in both directions: any integer cell maps onto the lattice. */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

export function cellAt<T extends LatticeInput>(
  lattice: Lattice<T>,
  gx: number,
  gy: number,
): T | null {
  const x = wrap(gx, lattice.width);
  const y = wrap(gy, lattice.height);
  return lattice.cells[y * lattice.width + x] ?? null;
}

export interface Region {
  genre: string;
  gx: number;
  gy: number;
}

/**
 * Where each genre's neighbourhood sits on the lattice: the centroid of the
 * cells whose title is nearest that genre's anchor in taste space.
 */
export function latticeRegions<T extends LatticeInput>(
  lattice: Lattice<T>,
  anchors: readonly { genre: string; x: number; y: number }[],
): Region[] {
  const sums = new Map<string, { x: number; y: number; n: number }>();
  lattice.cells.forEach((cell, index) => {
    let best = anchors[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const anchor of anchors) {
      const distance = (anchor.x - cell.x) ** 2 + (anchor.y - cell.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = anchor;
      }
    }
    if (!best) return;
    const sum = sums.get(best.genre) ?? { x: 0, y: 0, n: 0 };
    sum.x += index % lattice.width;
    sum.y += Math.floor(index / lattice.width);
    sum.n += 1;
    sums.set(best.genre, sum);
  });
  return [...sums.entries()]
    .filter(([, sum]) => sum.n >= 12)
    .map(([genre, sum]) => ({
      genre,
      gx: Math.round(sum.x / sum.n),
      gy: Math.round(sum.y / sum.n),
    }));
}
