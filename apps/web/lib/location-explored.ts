import type { LocationExplored } from "@repo/schemas";

/**
 * Explored ground: every accurate fix swept by a radius, joined to the fix
 * before it when the two are close enough in time and space to have been one
 * walk (or ride). Pure and streaming, so the loader can feed it a cursor over
 * a history that is kept indefinitely.
 *
 * Coverage is a set of grid cells half the radius across, with cell rows a
 * constant ground height and each row's width scaled by its own latitude, so a
 * cell is roughly square anywhere. That set is also what keeps the payload
 * bounded: a segment is only sent when it reached a cell nothing before it
 * did, so the hundredth walk down the same street costs nothing.
 */

export interface ExploredFix {
  latitude: number;
  longitude: number;
  recordedAt: Date;
}

/** `significant` fixes are hundreds of metres out; they say where, not what. */
export const EXPLORED_MAX_ACCURACY_METRES = 25;
const LINK_MAX_SECONDS = 120;
const LINK_MAX_METRES = 1_000;
/** Faster than a train between two fixes is a GPS jump, not travel. */
const LINK_MAX_SPEED = 70;
const SIMPLIFY_METRES = 1;
const METRES_PER_DEGREE = 111_320;
const RADII = [5, 10] as const;

type Radius = (typeof RADII)[number];

function toRad(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function metresBetween(a: ExploredFix, b: ExploredFix) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}

/** Cells of `radius / 2` metres that a disk swept from `a` to `b` touches. */
class CoverageGrid {
  readonly cells = new Set<number>();
  private readonly cellMetres: number;

  constructor(readonly radius: number) {
    this.cellMetres = radius / 2;
  }

  get areaSquareMetres() {
    return this.cells.size * this.cellMetres ** 2;
  }

  /** Marks the sweep; true when it reached at least one new cell. */
  sweep(a: ExploredFix, b: ExploredFix) {
    const length = metresBetween(a, b);
    // Pieces no longer than the radius keep each bounding box small, however
    // far a train went between two fixes.
    const pieces = Math.max(1, Math.ceil(length / this.radius));
    let novel = false;
    for (let index = 0; index < pieces; index += 1) {
      const from = interpolate(a, b, index / pieces);
      const to = interpolate(a, b, (index + 1) / pieces);
      if (this.sweepPiece(from, to)) novel = true;
    }
    return novel;
  }

  private sweepPiece(a: ExploredFix, b: ExploredFix) {
    const cell = this.cellMetres;
    const r = this.radius;
    const radiusDegrees = r / METRES_PER_DEGREE;
    const rowFrom = Math.floor(
      ((Math.min(a.latitude, b.latitude) - radiusDegrees) * METRES_PER_DEGREE) /
        cell,
    );
    const rowTo = Math.floor(
      ((Math.max(a.latitude, b.latitude) + radiusDegrees) * METRES_PER_DEGREE) /
        cell,
    );
    let novel = false;
    for (let row = rowFrom; row <= rowTo; row += 1) {
      const rowLatitude = ((row + 0.5) * cell) / METRES_PER_DEGREE;
      const metresPerLon = METRES_PER_DEGREE * Math.cos(toRad(rowLatitude));
      const lonRadius = r / metresPerLon;
      const colFrom = Math.floor(
        ((Math.min(a.longitude, b.longitude) - lonRadius) * metresPerLon) /
          cell,
      );
      const colTo = Math.floor(
        ((Math.max(a.longitude, b.longitude) + lonRadius) * metresPerLon) /
          cell,
      );
      // Everything in metres from `a`, on this row's scale.
      const bx = (b.longitude - a.longitude) * metresPerLon;
      const by = (b.latitude - a.latitude) * METRES_PER_DEGREE;
      const cy =
        rowLatitude * METRES_PER_DEGREE - a.latitude * METRES_PER_DEGREE;
      const lengthSquared = bx * bx + by * by;
      for (let col = colFrom; col <= colTo; col += 1) {
        const cx = (col + 0.5) * cell - a.longitude * metresPerLon;
        const t =
          lengthSquared === 0
            ? 0
            : Math.max(0, Math.min(1, (cx * bx + cy * by) / lengthSquared));
        const dx = cx - t * bx;
        const dy = cy - t * by;
        if (dx * dx + dy * dy > r * r) continue;
        const key = cellKey(row, col);
        if (!this.cells.has(key)) {
          this.cells.add(key);
          novel = true;
        }
      }
    }
    return novel;
  }
}

/** Rows and columns each fit 24 bits at 2.5 m cells, so the key is exact. */
function cellKey(row: number, col: number) {
  return (row + 2 ** 23) * 2 ** 24 + (col + 2 ** 23);
}

function interpolate(a: ExploredFix, b: ExploredFix, t: number): ExploredFix {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
    recordedAt: a.recordedAt,
  };
}

/** Douglas–Peucker in local metres; endpoints always survive. */
export function simplifyTrack(track: ExploredFix[], tolerance: number) {
  const origin = track[0];
  if (!origin || track.length <= 2) return track;
  const metresPerLon = METRES_PER_DEGREE * Math.cos(toRad(origin.latitude));
  const xs = track.map(
    (fix) => (fix.longitude - origin.longitude) * metresPerLon,
  );
  const ys = track.map(
    (fix) => (fix.latitude - origin.latitude) * METRES_PER_DEGREE,
  );
  const keep = new Set([0, track.length - 1]);
  const stack: [number, number][] = [[0, track.length - 1]];
  for (let span = stack.pop(); span; span = stack.pop()) {
    const [start, end] = span;
    const ax = xs[start] ?? 0;
    const ay = ys[start] ?? 0;
    const dx = (xs[end] ?? 0) - ax;
    const dy = (ys[end] ?? 0) - ay;
    const lengthSquared = dx * dx + dy * dy;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const px = (xs[index] ?? 0) - ax;
      const py = (ys[index] ?? 0) - ay;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared));
      const distance = Math.hypot(px - t * dx, py - t * dy);
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest >= 0) {
      keep.add(farthest);
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return track.filter((_, index) => keep.has(index));
}

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

export class ExploredAccumulator {
  private readonly grids: Record<Radius, CoverageGrid> = {
    5: new CoverageGrid(5),
    10: new CoverageGrid(10),
  };
  private readonly tracks: ExploredFix[][] = [];
  private readonly spots: ExploredFix[] = [];
  private current: ExploredFix[] = [];
  private previous: ExploredFix | null = null;
  /** The previous fix has not yet been linked to anything. */
  private previousAlone = false;
  private distance = 0;
  private count = 0;
  private west = Number.POSITIVE_INFINITY;
  private south = Number.POSITIVE_INFINITY;
  private east = Number.NEGATIVE_INFINITY;
  private north = Number.NEGATIVE_INFINITY;
  private firstAt: Date | null = null;
  private lastAt: Date | null = null;

  /** Fixes must arrive oldest first. */
  add(fix: ExploredFix) {
    this.count += 1;
    this.extend(fix);
    const previous = this.previous;
    const linked = previous !== null && this.linkable(previous, fix);
    if (previous && linked) {
      this.distance += metresBetween(previous, fix);
      const novel = this.sweep(previous, fix);
      if (novel) {
        if (!this.current.length) this.current.push(previous);
        this.current.push(fix);
      } else {
        this.closeTrack();
      }
      this.previousAlone = false;
    } else {
      this.closeTrack();
      if (previous && this.previousAlone) this.addSpot(previous);
      this.previousAlone = true;
    }
    this.previous = fix;
  }

  /** A stay's centre, which is ground stood on but not part of any walk. */
  addStay(fix: ExploredFix) {
    this.extend(fix);
    this.addSpot(fix);
  }

  finish(): LocationExplored {
    this.closeTrack();
    if (this.previous && this.previousAlone) this.addSpot(this.previous);
    this.previousAlone = false;
    return {
      tracks: this.tracks.map((track) =>
        simplifyTrack(track, SIMPLIFY_METRES).flatMap((fix) => [
          round6(fix.longitude),
          round6(fix.latitude),
        ]),
      ),
      spots: this.spots.map((fix) => [
        round6(fix.longitude),
        round6(fix.latitude),
      ]),
      bounds: Number.isFinite(this.west)
        ? [this.west, this.south, this.east, this.north]
        : null,
      areaSquareMetres: {
        r5: Math.round(this.grids[5].areaSquareMetres),
        r10: Math.round(this.grids[10].areaSquareMetres),
      },
      distanceMetres: Math.round(this.distance),
      points: this.count,
      firstAt: this.firstAt?.toISOString() ?? null,
      lastAt: this.lastAt?.toISOString() ?? null,
    };
  }

  private linkable(a: ExploredFix, b: ExploredFix) {
    const seconds = (b.recordedAt.getTime() - a.recordedAt.getTime()) / 1_000;
    if (seconds > LINK_MAX_SECONDS) return false;
    const metres = metresBetween(a, b);
    return (
      metres <= LINK_MAX_METRES &&
      metres / Math.max(1, seconds) <= LINK_MAX_SPEED
    );
  }

  /** Both grids see every sweep; the smaller one decides what is new. */
  private sweep(a: ExploredFix, b: ExploredFix) {
    this.grids[10].sweep(a, b);
    return this.grids[5].sweep(a, b);
  }

  private addSpot(fix: ExploredFix) {
    if (this.sweep(fix, fix)) this.spots.push(fix);
  }

  private closeTrack() {
    if (this.current.length >= 2) this.tracks.push(this.current);
    this.current = [];
  }

  private extend(fix: ExploredFix) {
    this.west = Math.min(this.west, fix.longitude);
    this.east = Math.max(this.east, fix.longitude);
    this.south = Math.min(this.south, fix.latitude);
    this.north = Math.max(this.north, fix.latitude);
    if (!this.firstAt || fix.recordedAt < this.firstAt) {
      this.firstAt = fix.recordedAt;
    }
    if (!this.lastAt || fix.recordedAt > this.lastAt) {
      this.lastAt = fix.recordedAt;
    }
  }
}

export function computeExplored(
  fixes: Iterable<ExploredFix>,
  stays: Iterable<ExploredFix> = [],
) {
  const accumulator = new ExploredAccumulator();
  for (const fix of fixes) accumulator.add(fix);
  for (const stay of stays) accumulator.addStay(stay);
  return accumulator.finish();
}
