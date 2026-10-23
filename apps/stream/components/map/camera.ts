/** `x`/`y` is the map point at the centre of the viewport; `scale` is screen px per map unit. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ZoomLimits {
  min: number;
  max: number;
}

export interface Tile extends Bounds {
  tx: number;
  ty: number;
}

export type Lod =
  | { mode: "dots"; cell: number }
  | { mode: "posters"; cell: number; posterWidth: number };

/** Screen footprint of one dot cell: neighbouring dots sit at least this far apart. */
export const DOT_CELL_PX = 14;
/** Screen footprint of one poster cell at the coarsest scale of its level. */
export const POSTER_CELL_PX = 132;
/** A poster takes this share of its cell's width, leaving room for its neighbours. */
export const POSTER_WIDTH_RATIO = 0.6;
export const MAX_POSTER_PX = 140;
/** Finest poster cell the client asks for; past it posters grow instead of multiplying. */
export const FINEST_POSTER_CELL = 40;
export const POSTER_SCALE = 0.5;
export const MIN_CELL = 20;
/** 38² cells stays under the server's 1500-point cap, so a tile is never truncated. */
export const CELLS_PER_TILE = 38;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(
  edge0: number,
  edge1: number,
  value: number,
): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function toScreen(
  camera: Camera,
  viewport: Viewport,
  x: number,
  y: number,
): [number, number] {
  return [
    (x - camera.x) * camera.scale + viewport.width / 2,
    (y - camera.y) * camera.scale + viewport.height / 2,
  ];
}

export function toMap(
  camera: Camera,
  viewport: Viewport,
  sx: number,
  sy: number,
): [number, number] {
  return [
    (sx - viewport.width / 2) / camera.scale + camera.x,
    (sy - viewport.height / 2) / camera.scale + camera.y,
  ];
}

export function visibleBounds(camera: Camera, viewport: Viewport): Bounds {
  const [x0, y0] = toMap(camera, viewport, 0, 0);
  const [x1, y1] = toMap(camera, viewport, viewport.width, viewport.height);
  return { x0, y0, x1, y1 };
}

/** The CSS transform that places map unit (0, 0) for a layer with `transform-origin: 0 0`. */
export function layerTransform(camera: Camera, viewport: Viewport): string {
  const [tx, ty] = toScreen(camera, viewport, 0, 0);
  return `translate3d(${tx}px, ${ty}px, 0) scale(${camera.scale})`;
}

export function zoomLimits(viewport: Viewport, size: number): ZoomLimits {
  const fit =
    (Math.min(viewport.width, viewport.height) * 0.92) / Math.max(size, 1);
  const max = MAX_POSTER_PX / (POSTER_WIDTH_RATIO * FINEST_POSTER_CELL);
  return { min: fit, max: Math.max(max, fit * 4) };
}

export function clampCamera(
  camera: Camera,
  limits: ZoomLimits,
  size: number,
): Camera {
  return {
    x: clamp(camera.x, 0, size),
    y: clamp(camera.y, 0, size),
    scale: clamp(camera.scale, limits.min, limits.max),
  };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    x: camera.x - dx / camera.scale,
    y: camera.y - dy / camera.scale,
  };
}

/** Zooms by `factor` keeping the map point under screen (sx, sy) where it is. */
export function zoomAt(
  camera: Camera,
  viewport: Viewport,
  factor: number,
  sx: number,
  sy: number,
  limits: ZoomLimits,
): Camera {
  const scale = clamp(camera.scale * factor, limits.min, limits.max);
  const [mx, my] = toMap(camera, viewport, sx, sy);
  return {
    scale,
    x: mx - (sx - viewport.width / 2) / scale,
    y: my - (sy - viewport.height / 2) / scale,
  };
}

export function boundsOf(
  points: readonly { x: number; y: number }[],
): Bounds | null {
  if (points.length === 0) return null;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const { x, y } of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/** Frames `bounds` inside the viewport less `insets`, never zooming past `maxScale`. */
export function fitBounds(
  bounds: Bounds,
  viewport: Viewport,
  insets: Insets,
  limits: ZoomLimits,
  maxScale = limits.max,
): Camera {
  const innerW = Math.max(viewport.width - insets.left - insets.right, 1);
  const innerH = Math.max(viewport.height - insets.top - insets.bottom, 1);
  const spanX = Math.max(bounds.x1 - bounds.x0, 1);
  const spanY = Math.max(bounds.y1 - bounds.y0, 1);
  const scale = clamp(
    Math.min(innerW / spanX, innerH / spanY, maxScale),
    limits.min,
    limits.max,
  );
  const offsetX = (insets.left - insets.right) / 2 / scale;
  const offsetY = (insets.top - insets.bottom) / 2 / scale;
  return {
    x: (bounds.x0 + bounds.x1) / 2 - offsetX,
    y: (bounds.y0 + bounds.y1) / 2 - offsetY,
    scale,
  };
}

/** Scale is interpolated in log space so a long zoom feels even throughout. */
export function interpolate(from: Camera, to: Camera, t: number): Camera {
  const scale = Math.exp(
    Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * t,
  );
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    scale,
  };
}

/** Snaps to half-octaves so a slow zoom only changes level of detail every √2×. */
export function levelScale(scale: number): number {
  return 2 ** (Math.floor(Math.log2(scale) * 2) / 2);
}

export function lodFor(scale: number, size: number): Lod {
  const level = levelScale(scale);
  if (level < POSTER_SCALE) {
    return {
      mode: "dots",
      cell: Math.round(clamp(DOT_CELL_PX / level, MIN_CELL, size)),
    };
  }
  const cell = Math.round(
    clamp(POSTER_CELL_PX / level, Math.max(FINEST_POSTER_CELL, MIN_CELL), size),
  );
  return { mode: "posters", cell, posterWidth: cell * POSTER_WIDTH_RATIO };
}

export function sameLod(a: Lod, b: Lod): boolean {
  return a.mode === b.mode && a.cell === b.cell;
}

/** 0 → dots, 1 → posters; posters fade in over the first stretch of the poster levels. */
export function posterBlend(scale: number): number {
  return smoothstep(POSTER_SCALE, POSTER_SCALE * 1.3, scale);
}

/** Tiles aligned to the server's cell grid, so each one is answered independently and cached. */
export function tilesFor(bounds: Bounds, cell: number, size: number): Tile[] {
  const side = cell * CELLS_PER_TILE;
  const last = Math.max(Math.ceil(size / side) - 1, 0);
  const tx0 = clamp(Math.floor(Math.min(bounds.x0, bounds.x1) / side), 0, last);
  const tx1 = clamp(Math.floor(Math.max(bounds.x0, bounds.x1) / side), 0, last);
  const ty0 = clamp(Math.floor(Math.min(bounds.y0, bounds.y1) / side), 0, last);
  const ty1 = clamp(Math.floor(Math.max(bounds.y0, bounds.y1) / side), 0, last);
  const tiles: Tile[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      tiles.push({
        tx,
        ty,
        x0: tx * side,
        y0: ty * side,
        x1: Math.min((tx + 1) * side, size),
        y1: Math.min((ty + 1) * side, size),
      });
    }
  }
  return tiles;
}

export function expandBounds(bounds: Bounds, by: number): Bounds {
  const dx = (bounds.x1 - bounds.x0) * by;
  const dy = (bounds.y1 - bounds.y0) * by;
  return {
    x0: bounds.x0 - dx,
    y0: bounds.y0 - dy,
    x1: bounds.x1 + dx,
    y1: bounds.y1 + dy,
  };
}

export function contains(bounds: Bounds, x: number, y: number): boolean {
  return x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
}
