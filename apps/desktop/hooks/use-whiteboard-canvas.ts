"use client";

import { useCallback, useRef, useState } from "react";
import type { IWhiteboardElement } from "@/lib/data-types";
import type {
  DrawingData,
  ImageData,
  ResizeHandle,
  SelectionRect,
  ShapeData,
  TextData,
  ViewState,
  WhiteboardTool,
} from "@/lib/whiteboard-types";
import type { useWhiteboardHistory } from "./use-whiteboard-history";

let _idCounter = 0;
function newId(): string {
  _idCounter++;
  return `el_${Date.now()}_${_idCounter}`;
}

function screenToWorld(
  sx: number,
  sy: number,
  view: ViewState,
): { x: number; y: number } {
  return {
    x: (sx - view.x) / view.zoom,
    y: (sy - view.y) / view.zoom,
  };
}

function getElementBounds(el: IWhiteboardElement): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const data = el.data as Record<string, unknown>;

  if (data.points) {
    const d = data as unknown as DrawingData;
    if (d.points.length === 0) {
      return { x: el.x, y: el.y, w: 0, h: 0 };
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of d.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const t = (d.thickness ?? 2) / 2;
    return {
      x: el.x + minX - t,
      y: el.y + minY - t,
      w: maxX - minX + t * 2,
      h: maxY - minY + t * 2,
    };
  }

  if (data.shapeType) {
    const d = data as unknown as ShapeData;
    if (d.shapeType === "arrow") {
      const x2 = d.x2 ?? 0;
      const y2 = d.y2 ?? 0;
      const t = (d.thickness ?? 2) / 2;
      const minX = Math.min(0, x2) - t;
      const minY = Math.min(0, y2) - t;
      const maxX = Math.max(0, x2) + t;
      const maxY = Math.max(0, y2) + t;
      return {
        x: el.x + minX,
        y: el.y + minY,
        w: maxX - minX,
        h: maxY - minY,
      };
    }

    return {
      x: el.x,
      y: el.y,
      w: el.width ?? 0,
      h: el.height ?? 0,
    };
  }

  if (data.text !== undefined) {
    const d = data as unknown as TextData;
    const text = d.text as string;
    const fontSize = d.fontSize ?? 16;

    const estimatedWidth = Math.max(20, text.length * fontSize * 0.6);
    const estimatedHeight = fontSize * 1.4;
    return {
      x: el.x,
      y: el.y,
      w: el.width ?? estimatedWidth,
      h: el.height ?? estimatedHeight,
    };
  }

  return {
    x: el.x,
    y: el.y,
    w: el.width ?? 0,
    h: el.height ?? 0,
  };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function pointInElement(
  wx: number,
  wy: number,
  el: IWhiteboardElement,
  tolerance: number,
): boolean {
  const data = el.data as Record<string, unknown>;

  if (data.points) {
    const d = data as unknown as DrawingData;
    if (d.points.length < 2) return false;
    const strokeTol = tolerance + (d.thickness ?? 2) / 2;
    for (let i = 1; i < d.points.length; i++) {
      const p0 = d.points[i - 1];
      const p1 = d.points[i];
      const dist = pointToSegmentDist(
        wx,
        wy,
        el.x + p0.x,
        el.y + p0.y,
        el.x + p1.x,
        el.y + p1.y,
      );
      if (dist <= strokeTol) return true;
    }
    return false;
  }

  if (data.shapeType) {
    const d = data as unknown as ShapeData;
    const strokeTol = tolerance + (d.thickness ?? 2) / 2;

    if (d.shapeType === "arrow") {
      const x2 = d.x2 ?? 0;
      const y2 = d.y2 ?? 0;
      const dist = pointToSegmentDist(wx, wy, el.x, el.y, el.x + x2, el.y + y2);
      return dist <= strokeTol;
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
      const innerR = Math.max(0, 1 - strokeTol / Math.min(rx, ry));
      return d2 <= outerR * outerR && d2 >= innerR * innerR;
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
      const dist = pointToSegmentDist(wx, wy, ex1, ey1, ex2, ey2);
      if (dist <= strokeTol) return true;
    }
    return false;
  }

  const b = getElementBounds(el);
  return (
    wx >= b.x - tolerance &&
    wx <= b.x + b.w + tolerance &&
    wy >= b.y - tolerance &&
    wy <= b.y + b.h + tolerance
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

function pointToSegmentDist(
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
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
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

function eraserHitsElement(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  el: IWhiteboardElement,
  tolerance: number,
): boolean {
  const data = el.data as Record<string, unknown>;

  if (data.points) {
    const d = data as unknown as DrawingData;
    if (d.points.length < 2) return false;
    const strokeTol = tolerance + (d.thickness ?? 2) / 2;
    for (let i = 1; i < d.points.length; i++) {
      const p0 = d.points[i - 1];
      const p1 = d.points[i];
      const dist = segmentToSegmentDist(
        x1,
        y1,
        x2,
        y2,
        el.x + p0.x,
        el.y + p0.y,
        el.x + p1.x,
        el.y + p1.y,
      );
      if (dist <= strokeTol) return true;
    }
    return false;
  }

  if (data.shapeType) {
    const d = data as unknown as ShapeData;
    const strokeTol = tolerance + (d.thickness ?? 2) / 2;

    if (d.shapeType === "arrow") {
      const ax2 = d.x2 ?? 0;
      const ay2 = d.y2 ?? 0;
      const dist = segmentToSegmentDist(
        x1,
        y1,
        x2,
        y2,
        el.x,
        el.y,
        el.x + ax2,
        el.y + ay2,
      );
      return dist <= strokeTol;
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
      const dist = segmentToSegmentDist(x1, y1, x2, y2, ex1, ey1, ex2, ey2);
      if (dist <= strokeTol) return true;
    }
    return false;
  }

  const b = getElementBounds(el);
  return lineSegmentIntersectsRect(
    x1,
    y1,
    x2,
    y2,
    b.x - tolerance,
    b.y - tolerance,
    b.w + tolerance * 2,
    b.h + tolerance * 2,
  );
}

export function useWhiteboardCanvas(
  history: ReturnType<typeof useWhiteboardHistory>,
) {
  const { elements, addElements, removeElements, pushAction } = history;

  const [viewState, setViewState] = useState<ViewState>({
    x: 0,
    y: 0,
    zoom: 1,
  });

  const [activeDrawing, setActiveDrawing] = useState<IWhiteboardElement | null>(
    null,
  );

  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(
    null,
  );

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  const isDrawing = useRef(false);
  const drawingRef = useRef<IWhiteboardElement | null>(null);

  const isAreaSelecting = useRef(false);
  const areaSelectStart = useRef({ x: 0, y: 0 });

  const isDraggingSelection = useRef(false);
  const dragSelectionStart = useRef({ x: 0, y: 0 });
  const dragSelectionOriginals = useRef<IWhiteboardElement[]>([]);

  const isErasing = useRef(false);
  const eraserLastPos = useRef({ x: 0, y: 0 });
  const eraserTouchedIds = useRef<Set<string>>(new Set());

  const isResizing = useRef(false);
  const resizeHandle = useRef<ResizeHandle | null>(null);
  const resizeElementId = useRef<string | null>(null);
  const resizeOriginal = useRef<IWhiteboardElement | null>(null);

  const [textBox, setTextBox] = useState<{
    worldX: number;
    worldY: number;
    width: number;
    height: number;
  } | null>(null);

  const isDrawingTextBox = useRef(false);
  const textBoxOrigin = useRef({ x: 0, y: 0 });

  const clipboardRef = useRef<IWhiteboardElement[]>([]);
  const lastWorldPos = useRef({ x: 0, y: 0 });

  const getNextZIndex = useCallback((): number => {
    let max = 0;
    for (const el of elements) {
      if (el.zIndex > max) max = el.zIndex;
    }
    return max + 1;
  }, [elements]);

  const toWorld = useCallback(
    (e: React.PointerEvent | React.MouseEvent) => {
      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      return screenToWorld(sx, sy, viewState);
    },
    [viewState],
  );

  const startResize = useCallback(
    (elementId: string, handle: ResizeHandle) => {
      const el = elements.find((e) => e.id === elementId);
      if (!el) return;
      isResizing.current = true;
      resizeHandle.current = handle;
      resizeElementId.current = elementId;
      resizeOriginal.current = { ...el };
    },
    [elements],
  );

  const onPointerDown = useCallback(
    (
      e: React.PointerEvent<SVGSVGElement>,
      tool: WhiteboardTool,
      color: string,
      thickness: number,
    ) => {
      const svg = e.currentTarget;
      svg.setPointerCapture(e.pointerId);
      const w = toWorld(e);

      if (tool === "hand") {
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (tool === "pointer") {
        const tolerance = 8 / viewState.zoom;

        const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
        for (const el of sorted) {
          if (pointInElement(w.x, w.y, el, tolerance)) {
            if (selectedElementIds.has(el.id)) {
              isDraggingSelection.current = true;
              dragSelectionStart.current = { x: w.x, y: w.y };
              dragSelectionOriginals.current = elements.filter((e) =>
                selectedElementIds.has(e.id),
              );
              return;
            }

            setSelectedElementIds(new Set([el.id]));
            isDraggingSelection.current = true;
            dragSelectionStart.current = { x: w.x, y: w.y };
            dragSelectionOriginals.current = [el];
            return;
          }
        }

        isAreaSelecting.current = true;
        areaSelectStart.current = { x: w.x, y: w.y };
        setSelectionRect({ x: w.x, y: w.y, width: 0, height: 0 });
        setSelectedElementIds(new Set());
        return;
      }

      if (tool === "select") {
        isAreaSelecting.current = true;
        areaSelectStart.current = { x: w.x, y: w.y };
        setSelectionRect({ x: w.x, y: w.y, width: 0, height: 0 });
        setSelectedElementIds(new Set());
        return;
      }

      if (tool === "eraser") {
        const tolerance = 2 / viewState.zoom;
        isErasing.current = true;
        eraserLastPos.current = { x: w.x, y: w.y };
        eraserTouchedIds.current = new Set();

        for (const el of elements) {
          if (eraserHitsElement(w.x, w.y, w.x, w.y, el, tolerance)) {
            eraserTouchedIds.current.add(el.id);
          }
        }
        return;
      }

      if (tool === "text") {
        isDrawingTextBox.current = true;
        textBoxOrigin.current = { x: w.x, y: w.y };
        setTextBox({ worldX: w.x, worldY: w.y, width: 0, height: 0 });
        return;
      }

      isDrawing.current = true;
      const id = newId();

      if (tool === "pen") {
        const el: IWhiteboardElement = {
          id,
          type: "drawing",
          x: w.x,
          y: w.y,
          zIndex: getNextZIndex(),
          data: {
            points: [{ x: 0, y: 0 }],
            color,
            thickness: Math.max(thickness, 2),
          } satisfies DrawingData as unknown as Record<string, unknown>,
        };
        drawingRef.current = el;
        setActiveDrawing(el);
        return;
      }

      if (
        tool === "square" ||
        tool === "rectangle" ||
        tool === "circle" ||
        tool === "arrow"
      ) {
        const el: IWhiteboardElement = {
          id,
          type: "drawing",
          x: w.x,
          y: w.y,
          width: 0,
          height: 0,
          zIndex: getNextZIndex(),
          data: {
            shapeType: tool,
            color,
            thickness: Math.max(thickness, 2),
            x2: 0,
            y2: 0,
          } satisfies ShapeData as unknown as Record<string, unknown>,
        };
        drawingRef.current = el;
        setActiveDrawing(el);
        return;
      }
    },
    [toWorld, viewState.zoom, elements, selectedElementIds, getNextZIndex],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>, _tool: WhiteboardTool) => {
      const wp = toWorld(e);
      lastWorldPos.current = wp;

      if (isPanning.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        panStart.current = { x: e.clientX, y: e.clientY };
        setViewState((prev) => ({
          ...prev,
          x: prev.x + dx,
          y: prev.y + dy,
        }));
        return;
      }

      if (isDraggingSelection.current) {
        const w = toWorld(e);
        const dx = w.x - dragSelectionStart.current.x;
        const dy = w.y - dragSelectionStart.current.y;
        const moved = dragSelectionOriginals.current.map((el) => ({
          ...el,
          x: el.x + dx,
          y: el.y + dy,
        }));

        history.setElements((prev) => {
          const movedMap = new Map(moved.map((m) => [m.id, m]));
          return prev.map((el) => movedMap.get(el.id) ?? el);
        });
        return;
      }

      if (
        isResizing.current &&
        resizeOriginal.current &&
        resizeHandle.current
      ) {
        const w = toWorld(e);
        const orig = resizeOriginal.current;
        const handle = resizeHandle.current;
        const origBounds = getElementBounds(orig);
        const MIN_SIZE = 20;

        const offsetX = origBounds.x - orig.x;
        const offsetY = origBounds.y - orig.y;

        let newBoundsX = origBounds.x;
        let newBoundsY = origBounds.y;
        let newW = origBounds.w;
        let newH = origBounds.h;

        if (handle === "top-left") {
          newW = origBounds.x + origBounds.w - w.x;
          newH = origBounds.y + origBounds.h - w.y;
          newBoundsX = w.x;
          newBoundsY = w.y;
        } else if (handle === "top-right") {
          newW = w.x - origBounds.x;
          newH = origBounds.y + origBounds.h - w.y;
          newBoundsY = w.y;
        } else if (handle === "bottom-left") {
          newW = origBounds.x + origBounds.w - w.x;
          newH = w.y - origBounds.y;
          newBoundsX = w.x;
        } else if (handle === "bottom-right") {
          newW = w.x - origBounds.x;
          newH = w.y - origBounds.y;
        }

        if (newW < MIN_SIZE) {
          if (handle === "top-left" || handle === "bottom-left") {
            newBoundsX = origBounds.x + origBounds.w - MIN_SIZE;
          }
          newW = MIN_SIZE;
        }
        if (newH < MIN_SIZE) {
          if (handle === "top-left" || handle === "top-right") {
            newBoundsY = origBounds.y + origBounds.h - MIN_SIZE;
          }
          newH = MIN_SIZE;
        }

        const scaleX = origBounds.w > 0 ? newW / origBounds.w : 1;
        const scaleY = origBounds.h > 0 ? newH / origBounds.h : 1;

        const newElX = newBoundsX - offsetX * scaleX;
        const newElY = newBoundsY - offsetY * scaleY;

        const data = orig.data as Record<string, unknown>;
        let updated: IWhiteboardElement;

        if (data.points) {
          const d = data as unknown as DrawingData;
          if (d.points.length < 2) return;
          const scaledPoints = d.points.map((p) => ({
            x: p.x * scaleX,
            y: p.y * scaleY,
          }));
          updated = {
            ...orig,
            x: newElX,
            y: newElY,
            data: {
              ...d,
              points: scaledPoints,
            } as unknown as Record<string, unknown>,
          };
        } else if (data.shapeType) {
          const d = data as unknown as ShapeData;
          if (d.shapeType === "arrow") {
            updated = {
              ...orig,
              x: newElX,
              y: newElY,
              width: newW,
              height: newH,
              data: {
                ...d,
                x2: (d.x2 ?? 0) * scaleX,
                y2: (d.y2 ?? 0) * scaleY,
              } as unknown as Record<string, unknown>,
            };
          } else {
            updated = {
              ...orig,
              x: newBoundsX,
              y: newBoundsY,
              width: newW,
              height: newH,
            };
          }
        } else {
          updated = {
            ...orig,
            x: newBoundsX,
            y: newBoundsY,
            width: newW,
            height: newH,
          };
        }

        history.setElements((prev) =>
          prev.map((el) => (el.id === updated.id ? updated : el)),
        );
        return;
      }

      if (isAreaSelecting.current) {
        const w = toWorld(e);
        const sx = areaSelectStart.current.x;
        const sy = areaSelectStart.current.y;
        const rect: SelectionRect = {
          x: Math.min(sx, w.x),
          y: Math.min(sy, w.y),
          width: Math.abs(w.x - sx),
          height: Math.abs(w.y - sy),
        };
        setSelectionRect(rect);
        return;
      }

      if (isErasing.current) {
        const w = toWorld(e);
        const tolerance = 2 / viewState.zoom;
        const prevX = eraserLastPos.current.x;
        const prevY = eraserLastPos.current.y;

        for (const el of elements) {
          if (eraserTouchedIds.current.has(el.id)) continue;
          if (eraserHitsElement(prevX, prevY, w.x, w.y, el, tolerance)) {
            eraserTouchedIds.current.add(el.id);
          }
        }

        eraserLastPos.current = { x: w.x, y: w.y };
        return;
      }

      if (isDrawingTextBox.current) {
        const w = toWorld(e);
        const ox = textBoxOrigin.current.x;
        const oy = textBoxOrigin.current.y;
        setTextBox({
          worldX: Math.min(ox, w.x),
          worldY: Math.min(oy, w.y),
          width: Math.abs(w.x - ox),
          height: Math.abs(w.y - oy),
        });
        return;
      }

      if (isDrawing.current && drawingRef.current) {
        const w = toWorld(e);
        const el = drawingRef.current;

        if (
          el.type === "drawing" &&
          (el.data as unknown as DrawingData).points
        ) {
          const d = el.data as unknown as DrawingData;
          const localX = w.x - el.x;
          const localY = w.y - el.y;
          const updated: IWhiteboardElement = {
            ...el,
            data: {
              ...d,
              points: [...d.points, { x: localX, y: localY }],
            } as unknown as Record<string, unknown>,
          };
          drawingRef.current = updated;
          setActiveDrawing(updated);
        } else if (
          el.type === "drawing" &&
          (el.data as unknown as ShapeData).shapeType
        ) {
          const shapeData = el.data as unknown as ShapeData;
          const dx = w.x - el.x;
          const dy = w.y - el.y;

          let width: number;
          let height: number;

          if (shapeData.shapeType === "square") {
            const size = Math.max(Math.abs(dx), Math.abs(dy));
            width = dx < 0 ? -size : size;
            height = dy < 0 ? -size : size;
          } else {
            width = dx;
            height = dy;
          }

          const updated: IWhiteboardElement = {
            ...el,
            width: Math.abs(width),
            height: Math.abs(height),
            data: {
              ...shapeData,
              x2: width,
              y2: height,
            } as unknown as Record<string, unknown>,
          };

          if (width < 0 || height < 0) {
            updated.x = el.x + Math.min(0, width);
            updated.y = el.y + Math.min(0, height);
            if (shapeData.shapeType === "arrow") {
              updated.data = {
                ...shapeData,
                x2: width,
                y2: height,
              } as unknown as Record<string, unknown>;
              updated.x = el.x;
              updated.y = el.y;
            }
          }

          drawingRef.current = updated;
          setActiveDrawing(updated);
        }
      }
    },
    [toWorld, viewState.zoom, elements, history],
  );

  const onPointerUp = useCallback(
    (_e: React.PointerEvent<SVGSVGElement>, _tool: WhiteboardTool) => {
      if (isPanning.current) {
        isPanning.current = false;
        return;
      }

      if (isErasing.current) {
        isErasing.current = false;
        if (eraserTouchedIds.current.size > 0) {
          removeElements(eraserTouchedIds.current);
        }
        eraserTouchedIds.current = new Set();
        return;
      }

      if (isDraggingSelection.current) {
        isDraggingSelection.current = false;

        const originals = dragSelectionOriginals.current;
        if (originals.length > 0) {
          const currentEls = elements.filter((el) =>
            selectedElementIds.has(el.id),
          );
          const hasMoved = originals.some((orig) => {
            const cur = currentEls.find((c) => c.id === orig.id);
            return cur && (cur.x !== orig.x || cur.y !== orig.y);
          });
          if (hasMoved) {
            pushAction({
              type: "update",
              before: originals,
              after: currentEls,
            });
          }
        }
        dragSelectionOriginals.current = [];
        return;
      }

      if (isResizing.current) {
        isResizing.current = false;
        const orig = resizeOriginal.current;
        const elId = resizeElementId.current;
        if (orig && elId) {
          const current = elements.find((el) => el.id === elId);
          if (
            current &&
            (current.x !== orig.x ||
              current.y !== orig.y ||
              current.width !== orig.width ||
              current.height !== orig.height)
          ) {
            pushAction({
              type: "update",
              before: [orig],
              after: [current],
            });
          }
        }
        resizeHandle.current = null;
        resizeElementId.current = null;
        resizeOriginal.current = null;
        return;
      }

      if (isAreaSelecting.current) {
        isAreaSelecting.current = false;
        if (selectionRect) {
          const selBounds = {
            x: selectionRect.x,
            y: selectionRect.y,
            w: selectionRect.width,
            h: selectionRect.height,
          };
          const selected = new Set<string>();
          for (const el of elements) {
            const b = getElementBounds(el);
            if (rectsOverlap(selBounds, b)) {
              selected.add(el.id);
            }
          }
          setSelectedElementIds(selected);
        }
        setSelectionRect(null);
        return;
      }

      if (isDrawingTextBox.current) {
        isDrawingTextBox.current = false;
        setTextBox((prev) => {
          if (!prev) return null;

          const minW = 100;
          const minH = 40;
          return {
            ...prev,
            width: Math.max(prev.width, minW),
            height: Math.max(prev.height, minH),
          };
        });
        return;
      }

      if (isDrawing.current) {
        isDrawing.current = false;
        if (drawingRef.current) {
          const el = drawingRef.current;

          const d = el.data as unknown as DrawingData;
          const s = el.data as unknown as ShapeData;
          const hasSubstance =
            (d.points && d.points.length > 1) ||
            (s.shapeType &&
              (Math.abs(el.width ?? 0) > 2 || Math.abs(el.height ?? 0) > 2));

          if (hasSubstance) {
            addElements([el]);
          }
          drawingRef.current = null;
          setActiveDrawing(null);
        }
        return;
      }
    },
    [
      elements,
      selectedElementIds,
      selectionRect,
      addElements,
      pushAction,
      removeElements,
    ],
  );

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = -e.deltaY * 0.001;
      setViewState((prev) => {
        const newZoom = Math.max(0.1, Math.min(5, prev.zoom * (1 + delta)));
        const scale = newZoom / prev.zoom;
        return {
          x: mx - (mx - prev.x) * scale,
          y: my - (my - prev.y) * scale,
          zoom: newZoom,
        };
      });
    } else {
      setViewState((prev) => ({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  }, []);

  const commitText = useCallback(
    (text: string, color: string, fontSize: number) => {
      if (!textBox || !text.trim()) {
        setTextBox(null);
        return;
      }
      const el: IWhiteboardElement = {
        id: newId(),
        type: "drawing",
        x: textBox.worldX,
        y: textBox.worldY,
        width: textBox.width,
        height: textBox.height,
        zIndex: getNextZIndex(),
        data: {
          text,
          color,
          fontSize,
        } satisfies TextData as unknown as Record<string, unknown>,
      };
      addElements([el]);
      setTextBox(null);
    },
    [textBox, addElements, getNextZIndex],
  );

  const findNonOverlappingPosition = useCallback(
    (
      targetW: number,
      targetH: number,
      preferX: number,
      preferY: number,
    ): { x: number; y: number } => {
      const PADDING = 20;
      const _candidate = { x: preferX, y: preferY, w: targetW, h: targetH };

      const existingBounds = elements.map((el) => getElementBounds(el));

      const overlaps = (cx: number, cy: number): boolean => {
        const c = { x: cx, y: cy, w: targetW, h: targetH };
        for (const b of existingBounds) {
          if (rectsOverlap(c, b)) return true;
        }
        return false;
      };

      if (!overlaps(preferX, preferY)) {
        return { x: preferX, y: preferY };
      }

      const step = PADDING + Math.max(targetW, targetH) * 0.5;
      for (let ring = 1; ring <= 20; ring++) {
        const dist = ring * step;

        for (let angle = 0; angle < 8; angle++) {
          const rad = (angle / 8) * Math.PI * 2;
          const cx = preferX + Math.cos(rad) * dist;
          const cy = preferY + Math.sin(rad) * dist;
          if (!overlaps(cx, cy)) {
            return { x: cx, y: cy };
          }
        }
      }

      return {
        x: preferX + targetW + PADDING,
        y: preferY,
      };
    },
    [elements],
  );

  const addComponent = useCallback(
    (
      componentType: string,
      defaultSize: { width: number; height: number },
      defaultData: Record<string, unknown>,
    ) => {
      const centerX =
        (-viewState.x + window.innerWidth / 2) / viewState.zoom -
        defaultSize.width / 2;
      const centerY =
        (-viewState.y + window.innerHeight / 2) / viewState.zoom -
        defaultSize.height / 2;

      const pos = findNonOverlappingPosition(
        defaultSize.width,
        defaultSize.height,
        centerX,
        centerY,
      );

      const el: IWhiteboardElement = {
        id: newId(),
        type: "component",
        componentType,
        x: pos.x,
        y: pos.y,
        width: defaultSize.width,
        height: defaultSize.height,
        zIndex: getNextZIndex(),
        data: { ...defaultData },
      };
      addElements([el]);
      setSelectedElementIds(new Set([el.id]));
    },
    [viewState, getNextZIndex, addElements, findNonOverlappingPosition],
  );

  const updateComponentData = useCallback(
    (elementId: string, newData: Record<string, unknown>) => {
      history.setElements((prev) => {
        const el = prev.find((e) => e.id === elementId);
        if (!el) return prev;
        const before = el;
        const after = { ...el, data: newData };
        pushAction({ type: "update", before: [before], after: [after] });
        return prev.map((e) => (e.id === elementId ? after : e));
      });
    },
    [history, pushAction],
  );

  const addImage = useCallback(
    (src: string) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const maxW = 800;
        const maxH = 600;
        if (w > maxW || h > maxH) {
          const scale = Math.min(maxW / w, maxH / h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }

        const centerX =
          (-viewState.x + window.innerWidth / 2) / viewState.zoom - w / 2;
        const centerY =
          (-viewState.y + window.innerHeight / 2) / viewState.zoom - h / 2;

        const el: IWhiteboardElement = {
          id: newId(),
          type: "drawing",
          x: centerX,
          y: centerY,
          width: w,
          height: h,
          zIndex: getNextZIndex(),
          data: {
            src,
          } satisfies ImageData as unknown as Record<string, unknown>,
        };
        addElements([el]);
        setSelectedElementIds(new Set([el.id]));
      };
      img.src = src;
    },
    [viewState, getNextZIndex, addElements],
  );

  const copySelected = useCallback(() => {
    if (selectedElementIds.size === 0) return;
    const selected = elements.filter((el) => selectedElementIds.has(el.id));
    clipboardRef.current = structuredClone(selected);
  }, [elements, selectedElementIds]);

  const pasteElements = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    isDraggingSelection.current = false;
    dragSelectionOriginals.current = [];
    setSelectedElementIds(new Set());

    const items = clipboardRef.current;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of items) {
      const b = getElementBounds(el);
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    const groupCx = (minX + maxX) / 2;
    const groupCy = (minY + maxY) / 2;
    const dx = lastWorldPos.current.x - groupCx;
    const dy = lastWorldPos.current.y - groupCy;

    const pasted = items.map((el) => ({
      ...structuredClone(el),
      id: newId(),
      x: el.x + dx,
      y: el.y + dy,
      zIndex: getNextZIndex(),
    }));
    addElements(pasted);
    setSelectedElementIds(new Set(pasted.map((el) => el.id)));
  }, [getNextZIndex, addElements]);

  const pasteImage = useCallback(
    (src: string) => {
      addImage(src);
    },
    [addImage],
  );

  const hasClipboard = useCallback(() => {
    return clipboardRef.current.length > 0;
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedElementIds.size === 0) return;
    removeElements(selectedElementIds);
    setSelectedElementIds(new Set());
  }, [selectedElementIds, removeElements]);

  const initializeView = useCallback((vs: ViewState) => {
    setViewState(vs);
  }, []);

  return {
    viewState,
    setViewState,
    activeDrawing,
    selectedElementIds,
    setSelectedElementIds,
    selectionRect,
    textBox,
    setTextBox,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    commitText,
    deleteSelected,
    initializeView,
    startResize,
    addComponent,
    updateComponentData,
    addImage,
    copySelected,
    pasteElements,
    pasteImage,
    hasClipboard,
  };
}
