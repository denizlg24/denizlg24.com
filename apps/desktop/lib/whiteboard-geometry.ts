import type {
  IDrawingData,
  IShapeData,
  ITextData,
  IWhiteboardElement,
} from "@repo/schemas";
import { whiteboardElementKind } from "@repo/schemas";
import { type Bounds, elementBounds } from "@repo/whiteboard-render";

export type { Bounds };

export function boundsOf(
  el: IWhiteboardElement,
  includeRotation = false,
): Bounds {
  return elementBounds(el, includeRotation);
}

export function centerOf(b: Bounds): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number,
): { x: number; y: number } {
  if (!deg) return { x: px, y: py };
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

export function unionBounds(elements: IWhiteboardElement[]): Bounds | null {
  if (elements.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const el of elements) {
    const b = boundsOf(el, true);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (minX === Number.POSITIVE_INFINITY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function selectionBounds(
  elements: IWhiteboardElement[],
  ids: Set<string>,
): Bounds | null {
  return unionBounds(elements.filter((el) => ids.has(el.id)));
}

export function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segmentToSegmentDist(
  a1x: number,
  a1y: number,
  a2x: number,
  a2y: number,
  b1x: number,
  b1y: number,
  b2x: number,
  b2y: number,
): number {
  const d1 = (b2x - b1x) * (a1y - b1y) - (b2y - b1y) * (a1x - b1x);
  const d2 = (b2x - b1x) * (a2y - b1y) - (b2y - b1y) * (a2x - b1x);
  const d3 = (a2x - a1x) * (b1y - a1y) - (a2y - a1y) * (b1x - a1x);
  const d4 = (a2x - a1x) * (b2y - a1y) - (a2y - a1y) * (b2x - a1x);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    pointToSegmentDist(a1x, a1y, b1x, b1y, b2x, b2y),
    pointToSegmentDist(a2x, a2y, b1x, b1y, b2x, b2y),
    pointToSegmentDist(b1x, b1y, a1x, a1y, a2x, a2y),
    pointToSegmentDist(b2x, b2y, a1x, a1y, a2x, a2y),
  );
}

function lineSegmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  if (rw <= 0 || rh <= 0) return false;
  if (x1 >= rx && x1 <= rx + rw && y1 >= ry && y1 <= ry + rh) return true;
  if (x2 >= rx && x2 <= rx + rw && y2 >= ry && y2 <= ry + rh) return true;
  const edges: [number, number, number, number][] = [
    [rx, ry, rx + rw, ry],
    [rx, ry + rh, rx + rw, ry + rh],
    [rx, ry, rx, ry + rh],
    [rx + rw, ry, rx + rw, ry + rh],
  ];
  const dx = x2 - x1;
  const dy = y2 - y1;
  for (const [ex1, ey1, ex2, ey2] of edges) {
    const edx = ex2 - ex1;
    const edy = ey2 - ey1;
    const denom = dx * edy - dy * edx;
    if (Math.abs(denom) < 1e-10) continue;
    const t = ((ex1 - x1) * edy - (ey1 - y1) * edx) / denom;
    const u = ((ex1 - x1) * dy - (ey1 - y1) * dx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}

/** Transform a world point into the element's unrotated local frame. */
function toLocal(
  el: IWhiteboardElement,
  wx: number,
  wy: number,
): { x: number; y: number } {
  if (!el.rotation) return { x: wx, y: wy };
  const c = centerOf(boundsOf(el, false));
  return rotatePoint(wx, wy, c.x, c.y, -el.rotation);
}

function hitTestUnrotated(
  wx: number,
  wy: number,
  el: IWhiteboardElement,
  tolerance: number,
): boolean {
  const kind = whiteboardElementKind(el);

  if (kind === "pen") {
    const d = el.data as unknown as IDrawingData;
    if (d.points.length < 2) return false;
    const strokeTol = tolerance + d.thickness / 2;
    for (let i = 1; i < d.points.length; i++) {
      const p0 = d.points[i - 1];
      const p1 = d.points[i];
      if (!p0 || !p1) continue;
      if (
        pointToSegmentDist(
          wx,
          wy,
          el.x + p0.x,
          el.y + p0.y,
          el.x + p1.x,
          el.y + p1.y,
        ) <= strokeTol
      ) {
        return true;
      }
    }
    return false;
  }

  if (kind === "shape") {
    const d = el.data as unknown as IShapeData;
    const strokeTol = tolerance + d.thickness / 2;
    const filled = !!d.fill && d.fill !== "none";

    if (d.shapeType === "arrow" || d.shapeType === "line") {
      return (
        pointToSegmentDist(
          wx,
          wy,
          el.x,
          el.y,
          el.x + (d.x2 ?? 0),
          el.y + (d.y2 ?? 0),
        ) <= strokeTol
      );
    }

    if (d.shapeType === "circle") {
      const w = el.width ?? 0;
      const h = el.height ?? 0;
      const cx = el.x + w / 2;
      const cy = el.y + h / 2;
      const rx = w / 2;
      const ry = h / 2;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (wx - cx) / rx;
      const ny = (wy - cy) / ry;
      const d2 = nx * nx + ny * ny;
      const outerR = 1 + strokeTol / Math.min(rx, ry);
      if (filled) return d2 <= outerR * outerR;
      const innerR = Math.max(0, 1 - strokeTol / Math.min(rx, ry));
      return d2 <= outerR * outerR && d2 >= innerR * innerR;
    }

    const bx = el.x;
    const by = el.y;
    const bw = el.width ?? 0;
    const bh = el.height ?? 0;
    if (
      filled &&
      wx >= bx - strokeTol &&
      wx <= bx + bw + strokeTol &&
      wy >= by - strokeTol &&
      wy <= by + bh + strokeTol
    ) {
      return true;
    }
    const edges: [number, number, number, number][] = [
      [bx, by, bx + bw, by],
      [bx + bw, by, bx + bw, by + bh],
      [bx + bw, by + bh, bx, by + bh],
      [bx, by + bh, bx, by],
    ];
    for (const [ex1, ey1, ex2, ey2] of edges) {
      if (pointToSegmentDist(wx, wy, ex1, ey1, ex2, ey2) <= strokeTol) {
        return true;
      }
    }
    return false;
  }

  const b = boundsOf(el, false);
  return (
    wx >= b.x - tolerance &&
    wx <= b.x + b.width + tolerance &&
    wy >= b.y - tolerance &&
    wy <= b.y + b.height + tolerance
  );
}

export function hitTest(
  el: IWhiteboardElement,
  wx: number,
  wy: number,
  tolerance: number,
): boolean {
  const local = toLocal(el, wx, wy);
  return hitTestUnrotated(local.x, local.y, el, tolerance);
}

export function eraserHitsElement(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  el: IWhiteboardElement,
  tolerance: number,
): boolean {
  const a = toLocal(el, x1, y1);
  const b = toLocal(el, x2, y2);
  const kind = whiteboardElementKind(el);

  if (kind === "pen") {
    const d = el.data as unknown as IDrawingData;
    if (d.points.length < 2) return false;
    const strokeTol = tolerance + d.thickness / 2;
    for (let i = 1; i < d.points.length; i++) {
      const p0 = d.points[i - 1];
      const p1 = d.points[i];
      if (!p0 || !p1) continue;
      if (
        segmentToSegmentDist(
          a.x,
          a.y,
          b.x,
          b.y,
          el.x + p0.x,
          el.y + p0.y,
          el.x + p1.x,
          el.y + p1.y,
        ) <= strokeTol
      ) {
        return true;
      }
    }
    return false;
  }

  if (kind === "shape") {
    const d = el.data as unknown as IShapeData;
    const strokeTol = tolerance + d.thickness / 2;
    if (d.shapeType === "arrow" || d.shapeType === "line") {
      return (
        segmentToSegmentDist(
          a.x,
          a.y,
          b.x,
          b.y,
          el.x,
          el.y,
          el.x + (d.x2 ?? 0),
          el.y + (d.y2 ?? 0),
        ) <= strokeTol
      );
    }
    const bx = el.x;
    const by = el.y;
    const bw = el.width ?? 0;
    const bh = el.height ?? 0;
    const edges: [number, number, number, number][] = [
      [bx, by, bx + bw, by],
      [bx + bw, by, bx + bw, by + bh],
      [bx + bw, by + bh, bx, by + bh],
      [bx, by + bh, bx, by],
    ];
    for (const [ex1, ey1, ex2, ey2] of edges) {
      if (
        segmentToSegmentDist(a.x, a.y, b.x, b.y, ex1, ey1, ex2, ey2) <=
        strokeTol
      ) {
        return true;
      }
    }
    return false;
  }

  const bb = boundsOf(el, false);
  return lineSegmentIntersectsRect(
    a.x,
    a.y,
    b.x,
    b.y,
    bb.x - tolerance,
    bb.y - tolerance,
    bb.width + tolerance * 2,
    bb.height + tolerance * 2,
  );
}

export function marqueeHits(
  el: IWhiteboardElement,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const b = boundsOf(el, true);
  return (
    b.x >= rect.x &&
    b.y >= rect.y &&
    b.x + b.width <= rect.x + rect.width &&
    b.y + b.height <= rect.y + rect.height
  );
}

/**
 * Scale an element's stored (unrotated) geometry about a fixed anchor point.
 * `scaleFont` scales text fontSize (corner drags); otherwise only the box grows.
 */
export function scaleElementAbout(
  el: IWhiteboardElement,
  anchorX: number,
  anchorY: number,
  sx: number,
  sy: number,
  scaleFont: boolean,
): IWhiteboardElement {
  const kind = whiteboardElementKind(el);
  const newX = anchorX + (el.x - anchorX) * sx;
  const newY = anchorY + (el.y - anchorY) * sy;

  if (kind === "pen") {
    const d = el.data as unknown as IDrawingData;
    return {
      ...el,
      x: newX,
      y: newY,
      data: {
        ...d,
        points: d.points.map((p) => ({ x: p.x * sx, y: p.y * sy })),
      } as unknown as Record<string, unknown>,
    };
  }

  if (kind === "shape") {
    const d = el.data as unknown as IShapeData;
    if (d.shapeType === "arrow" || d.shapeType === "line") {
      return {
        ...el,
        x: newX,
        y: newY,
        width: Math.abs((d.x2 ?? 0) * sx),
        height: Math.abs((d.y2 ?? 0) * sy),
        data: {
          ...d,
          x2: (d.x2 ?? 0) * sx,
          y2: (d.y2 ?? 0) * sy,
        } as unknown as Record<string, unknown>,
      };
    }
    return {
      ...el,
      x: newX,
      y: newY,
      width: (el.width ?? 0) * sx,
      height: (el.height ?? 0) * sy,
    };
  }

  if (kind === "text") {
    const d = el.data as unknown as ITextData;
    const nextFont = scaleFont
      ? Math.max(4, d.fontSize * ((sx + sy) / 2))
      : d.fontSize;
    return {
      ...el,
      x: newX,
      y: newY,
      width: (el.width ?? 100) * sx,
      height: (el.height ?? 40) * sy,
      data: {
        ...d,
        fontSize: nextFont,
      } as unknown as Record<string, unknown>,
    };
  }

  return {
    ...el,
    x: newX,
    y: newY,
    width: (el.width ?? 100) * sx,
    height: (el.height ?? 60) * sy,
  };
}

/**
 * Re-anchor a resized single element so the given world-space anchor stays
 * put after rotation is reapplied around the element's new center.
 */
export function reanchorRotated(
  original: IWhiteboardElement,
  scaled: IWhiteboardElement,
  anchorLocalX: number,
  anchorLocalY: number,
): IWhiteboardElement {
  if (!original.rotation) return scaled;
  const oc = centerOf(boundsOf(original, false));
  const preAnchor = rotatePoint(
    anchorLocalX,
    anchorLocalY,
    oc.x,
    oc.y,
    original.rotation,
  );
  const nc = centerOf(boundsOf(scaled, false));
  const postAnchor = rotatePoint(
    anchorLocalX,
    anchorLocalY,
    nc.x,
    nc.y,
    original.rotation,
  );
  return {
    ...scaled,
    x: scaled.x + (preAnchor.x - postAnchor.x),
    y: scaled.y + (preAnchor.y - postAnchor.y),
  };
}

export const RESIZE_CURSORS: Record<
  import("./whiteboard-types").ResizeHandle,
  string
> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

/** The opposite (fixed) corner/edge point for a handle, on a bounds rect. */
export function anchorForHandle(
  b: Bounds,
  handle: import("./whiteboard-types").ResizeHandle,
): { x: number; y: number } {
  const left = b.x;
  const right = b.x + b.width;
  const top = b.y;
  const bottom = b.y + b.height;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  switch (handle) {
    case "nw":
      return { x: right, y: bottom };
    case "n":
      return { x: cx, y: bottom };
    case "ne":
      return { x: left, y: bottom };
    case "e":
      return { x: left, y: cy };
    case "se":
      return { x: left, y: top };
    case "s":
      return { x: cx, y: top };
    case "sw":
      return { x: right, y: top };
    case "w":
      return { x: right, y: cy };
  }
}

export function handleAffectsX(
  handle: import("./whiteboard-types").ResizeHandle,
): boolean {
  return handle !== "n" && handle !== "s";
}

export function handleAffectsY(
  handle: import("./whiteboard-types").ResizeHandle,
): boolean {
  return handle !== "e" && handle !== "w";
}
