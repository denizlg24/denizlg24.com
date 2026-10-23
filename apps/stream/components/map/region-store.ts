import type { MapPoint } from "@repo/schemas/stream";

import { type Bounds, contains, type Tile, tilesFor } from "./camera";

export type MapKind = "movie" | "series";

export interface RegionRequest {
  bounds: Bounds;
  cell: number;
  kind: MapKind | null;
}

export type TileLoader = (
  tile: Tile,
  cell: number,
  kind: MapKind | null,
  signal: AbortSignal,
) => Promise<MapPoint[]>;

const MAX_CACHED_TILES = 400;

function tileKey(tile: Tile, cell: number, kind: MapKind | null): string {
  return `${kind ?? "all"}:${cell}:${tile.tx}:${tile.ty}`;
}

/**
 * Viewport → grid-aligned tiles → cached `MapPoint`s. A tile still loading is
 * filled with whatever was on screen there before, so zooming swaps detail in
 * place rather than blanking. Requests for tiles that left the view are aborted.
 */
export class RegionStore {
  private readonly cache = new Map<string, MapPoint[]>();
  private readonly inflight = new Map<string, AbortController>();
  private display: MapPoint[] = [];
  private current: {
    tiles: Tile[];
    keys: string[];
    kind: MapKind | null;
  } | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly size: number,
    private readonly load: TileLoader,
    private readonly onChange: (points: MapPoint[], settled: boolean) => void,
  ) {}

  request({ bounds, cell, kind }: RegionRequest): void {
    if (this.disposed) return;
    const tiles = tilesFor(bounds, cell, this.size);
    const keys = tiles.map((tile) => tileKey(tile, cell, kind));
    const wanted = new Set(keys);
    for (const [key, controller] of this.inflight) {
      if (!wanted.has(key)) {
        controller.abort();
        this.inflight.delete(key);
      }
    }
    if (this.current && this.current.kind !== kind) this.display = [];
    this.current = { tiles, keys, kind };
    this.publish();
    tiles.forEach((tile, index) => {
      const key = keys[index];
      if (this.cache.has(key) || this.inflight.has(key)) return;
      const controller = new AbortController();
      this.inflight.set(key, controller);
      this.load(tile, cell, kind, controller.signal).then(
        (points) => {
          if (this.inflight.get(key) === controller) this.inflight.delete(key);
          this.remember(key, points);
          if (this.current?.keys.includes(key)) this.schedulePublish();
        },
        () => {
          if (this.inflight.get(key) === controller) this.inflight.delete(key);
        },
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    if (this.publishTimer) clearTimeout(this.publishTimer);
  }

  private remember(key: string, points: MapPoint[]): void {
    this.cache.delete(key);
    this.cache.set(key, points);
    while (this.cache.size > MAX_CACHED_TILES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private schedulePublish(): void {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.publish();
    }, 32);
  }

  private publish(): void {
    const current = this.current;
    if (!current || this.disposed) return;
    const seen = new Set<string>();
    const next: MapPoint[] = [];
    const missing: Tile[] = [];
    current.tiles.forEach((tile, index) => {
      const cached = this.cache.get(current.keys[index]);
      if (!cached) {
        missing.push(tile);
        return;
      }
      for (const point of cached) {
        if (seen.has(point.id)) continue;
        seen.add(point.id);
        next.push(point);
      }
    });
    if (missing.length > 0) {
      for (const point of this.display) {
        if (seen.has(point.id)) continue;
        if (missing.some((tile) => contains(tile, point.x, point.y))) {
          seen.add(point.id);
          next.push(point);
        }
      }
    }
    this.display = next;
    this.onChange(next, missing.length === 0);
  }
}
