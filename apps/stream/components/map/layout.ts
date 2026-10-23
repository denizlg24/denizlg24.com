import type { MapMeta, MapPoint } from "@repo/schemas/stream";

export type Anchor = MapMeta["anchors"][number];

export interface PosterTile {
  point: MapPoint;
  /** Top-left corner and size, in map units. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Caption room under a poster, as a share of its width, reserved even before captions show. */
export const CAPTION_RATIO = 0.34;

/**
 * Muted hues on ink. Each genre's hue follows its anchor's bearing from the
 * map centre, so neighbouring genres read as neighbouring colours.
 */
export function genreTints(anchors: readonly Anchor[], size: number): string[] {
  return anchors.map((anchor) => {
    const bearing = Math.atan2(anchor.y - size / 2, anchor.x - size / 2);
    const hue = Math.round(((bearing / (Math.PI * 2) + 1) % 1) * 360);
    return `hsl(${hue} 34% 66%)`;
  });
}

export function nearestAnchor(
  anchors: readonly Anchor[],
  x: number,
  y: number,
): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const distance = (anchor.x - x) ** 2 + (anchor.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Greedy placement, heaviest first: a poster that would overlap one already
 * placed is dropped. The server's cells keep this mostly a no-op, but two
 * titles near a shared cell edge can still sit closer than a poster is wide.
 */
export function declutter(
  points: readonly MapPoint[],
  posterWidth: number,
): PosterTile[] {
  const width = posterWidth;
  const height = posterWidth * 1.5;
  const slotW = width * 1.08;
  const slotH = height + width * CAPTION_RATIO;
  const grid = new Map<string, PosterTile[]>();
  const placed: PosterTile[] = [];
  const sorted = [...points].sort((a, b) => b.weight - a.weight);
  for (const point of sorted) {
    const gx = Math.floor(point.x / slotW);
    const gy = Math.floor(point.y / slotH);
    let blocked = false;
    for (let dy = -1; dy <= 1 && !blocked; dy++) {
      for (let dx = -1; dx <= 1 && !blocked; dx++) {
        for (const other of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
          if (
            Math.abs(other.point.x - point.x) < slotW &&
            Math.abs(other.point.y - point.y) < slotH
          ) {
            blocked = true;
            break;
          }
        }
      }
    }
    if (blocked) continue;
    const tile = {
      point,
      left: point.x - width / 2,
      top: point.y - height / 2,
      width,
      height,
    };
    placed.push(tile);
    const key = `${gx}:${gy}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(tile);
    else grid.set(key, [tile]);
  }
  return placed;
}

export function nearestTo<T extends { x: number; y: number }>(
  items: readonly T[],
  x: number,
  y: number,
  within = Number.POSITIVE_INFINITY,
): T | null {
  let best: T | null = null;
  let bestDistance = within * within;
  for (const item of items) {
    const distance = (item.x - x) ** 2 + (item.y - y) ** 2;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

export function tileAt(
  tiles: readonly PosterTile[],
  x: number,
  y: number,
): PosterTile | null {
  for (const tile of tiles) {
    if (
      x >= tile.left &&
      x <= tile.left + tile.width &&
      y >= tile.top &&
      y <= tile.top + tile.height
    ) {
      return tile;
    }
  }
  return null;
}
