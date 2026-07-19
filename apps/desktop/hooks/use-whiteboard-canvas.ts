"use client";

import type {
  IDrawingData,
  IImageData,
  IShapeData,
  ITextData,
  IWhiteboardElement,
  TextFontFamily,
} from "@repo/schemas";
import { whiteboardElementKind } from "@repo/schemas";
import { useCallback, useRef, useState } from "react";
import {
  anchorForHandle,
  boundsOf,
  centerOf,
  eraserHitsElement,
  handleAffectsX,
  handleAffectsY,
  hitTest,
  marqueeHits,
  reanchorRotated,
  rotatePoint,
  scaleElementAbout,
  unionBounds,
} from "@/lib/whiteboard-geometry";
import type {
  ResizeHandle,
  SelectionRect,
  TextBoxState,
  TextDraft,
  ViewState,
  WhiteboardTool,
} from "@/lib/whiteboard-types";

import type { useWhiteboardHistory } from "./use-whiteboard-history";

let _idCounter = 0;
function newId(): string {
  _idCounter++;
  return `el_${Date.now()}_${_idCounter}`;
}

const MIN_SIZE = 8;
const TEXT_MAX_WIDTH = 480;

export interface DrawSettings {
  color: string;
  thickness: number;
  highlighterThickness: number;
  fill: string;
  fontSize: number;
  fontWeight: number;
  fontFamily: TextFontFamily;
  align: "left" | "center" | "right";
  onSetBackground?: (color: string) => void;
}

function screenToWorld(sx: number, sy: number, view: ViewState) {
  return { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom };
}

export function useWhiteboardCanvas(
  history: ReturnType<typeof useWhiteboardHistory>,
) {
  const { elements, addElements, removeElements, updateElements, pushAction } =
    history;

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
  const [textBox, setTextBox] = useState<TextBoxState | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const spacePan = useRef(false);

  const isDrawing = useRef(false);
  const drawingRef = useRef<IWhiteboardElement | null>(null);

  const isMarquee = useRef(false);
  const marqueeStart = useRef({ x: 0, y: 0 });
  const marqueeBaseIds = useRef<Set<string>>(new Set());

  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragOriginals = useRef<IWhiteboardElement[]>([]);

  const isErasing = useRef(false);
  const eraserLast = useRef({ x: 0, y: 0 });
  const eraserTouched = useRef<Set<string>>(new Set());

  const isResizing = useRef(false);
  const resizeHandle = useRef<ResizeHandle | null>(null);
  const resizeOriginals = useRef<IWhiteboardElement[]>([]);
  const resizeShift = useRef(false);

  const isRotating = useRef(false);
  const rotateOriginal = useRef<IWhiteboardElement | null>(null);
  const rotateCenter = useRef({ x: 0, y: 0 });
  const rotateStartAngle = useRef(0);
  const rotateShift = useRef(false);

  const isDrawingTextBox = useRef(false);
  /* Editing must start on pointer-up: mounting the editor during pointerdown
     (while the SVG holds pointer capture) gets it blurred by the ensuing
     pointerup, which instantly commits and closes it. */
  const pendingEditId = useRef<string | null>(null);
  const textBoxOrigin = useRef({ x: 0, y: 0 });
  const textStyle = useRef<{
    color: string;
    fontSize: number;
    fontWeight: number;
    fontFamily: TextFontFamily;
    align: "left" | "center" | "right";
  }>({
    color: "#18181b",
    fontSize: 24,
    fontWeight: 400,
    fontFamily: "handwriting",
    align: "left",
  });

  const clipboard = useRef<IWhiteboardElement[]>([]);
  const lastWorld = useRef({ x: 0, y: 0 });
  const lastClick = useRef<{ id: string; t: number }>({ id: "", t: 0 });

  const getNextZIndex = useCallback((): number => {
    let max = 0;
    for (const el of elements) if (el.zIndex > max) max = el.zIndex;
    return max + 1;
  }, [elements]);

  const toWorld = useCallback(
    (e: React.PointerEvent | React.MouseEvent) => {
      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      return screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top,
        viewState,
      );
    },
    [viewState],
  );

  const setSpacePan = useCallback((on: boolean) => {
    spacePan.current = on;
  }, []);

  const startResize = useCallback(
    (handle: ResizeHandle, shift: boolean) => {
      const originals = elements.filter((el) => selectedElementIds.has(el.id));
      if (originals.length === 0) return;
      isResizing.current = true;
      resizeHandle.current = handle;
      resizeOriginals.current = originals.map((el) => ({ ...el }));
      resizeShift.current = shift;
    },
    [elements, selectedElementIds],
  );

  const startRotate = useCallback(
    (worldX: number, worldY: number) => {
      if (selectedElementIds.size !== 1) return;
      const id = [...selectedElementIds][0];
      const orig = elements.find((el) => el.id === id);
      if (!orig) return;
      isRotating.current = true;
      rotateOriginal.current = { ...orig };
      const c = centerOf(boundsOf(orig, false));
      rotateCenter.current = c;
      rotateStartAngle.current = Math.atan2(worldY - c.y, worldX - c.x);
    },
    [elements, selectedElementIds],
  );

  const commitBucket = useCallback(
    (wx: number, wy: number, settings: DrawSettings) => {
      const tolerance = 6 / viewState.zoom;
      const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
      for (const el of sorted) {
        if (whiteboardElementKind(el) !== "shape") continue;
        if (!hitTest(el, wx, wy, tolerance)) continue;
        const d = el.data as unknown as IShapeData;
        if (d.shapeType === "arrow" || d.shapeType === "line") continue;
        const after = {
          ...el,
          data: { ...d, fill: settings.color } as unknown as Record<
            string,
            unknown
          >,
        };
        updateElements([after]);
        return;
      }
      settings.onSetBackground?.(settings.color);
    },
    [elements, viewState.zoom, updateElements],
  );

  const beginEditText = useCallback(
    (elementId: string) => {
      const el = elements.find((e) => e.id === elementId);
      if (!el || whiteboardElementKind(el) !== "text") return;
      const d = el.data as unknown as ITextData;
      setSelectedElementIds(new Set());
      setTextBox({
        worldX: el.x,
        worldY: el.y,
        width: el.width ?? 120,
        height: el.height ?? d.fontSize * 1.4,
        autoSize: false,
        maxWidth: TEXT_MAX_WIDTH,
        editingId: el.id,
        color: d.color,
        fontSize: d.fontSize,
        fontWeight: d.fontWeight ?? 400,
        fontFamily: d.fontFamily ?? "handwriting",
        align: d.align ?? "left",
        initialText: d.text,
      });
    },
    [elements],
  );

  const onPointerDown = useCallback(
    (
      e: React.PointerEvent<SVGSVGElement>,
      tool: WhiteboardTool,
      settings: DrawSettings,
    ) => {
      const svg = e.currentTarget;
      svg.setPointerCapture(e.pointerId);
      const w = toWorld(e);
      lastWorld.current = w;

      if (spacePan.current || tool === "hand" || e.button === 1) {
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (tool === "bucket") {
        commitBucket(w.x, w.y, settings);
        return;
      }

      if (tool === "pointer") {
        const tolerance = 8 / viewState.zoom;
        const additive = e.shiftKey;
        const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
        let hit: IWhiteboardElement | null = null;
        for (const el of sorted) {
          if (hitTest(el, w.x, w.y, tolerance)) {
            hit = el;
            break;
          }
        }

        if (hit) {
          const target = hit;
          const now = Date.now();
          if (
            !additive &&
            whiteboardElementKind(target) === "text" &&
            lastClick.current.id === target.id &&
            now - lastClick.current.t < 350
          ) {
            lastClick.current = { id: "", t: 0 };
            pendingEditId.current = target.id;
            return;
          }
          lastClick.current = { id: target.id, t: now };
          if (additive) {
            setSelectedElementIds((prev) => {
              const next = new Set(prev);
              if (next.has(target.id)) next.delete(target.id);
              else next.add(target.id);
              return next;
            });
            return;
          }
          const nextSel = selectedElementIds.has(target.id)
            ? selectedElementIds
            : new Set([target.id]);
          if (!selectedElementIds.has(target.id))
            setSelectedElementIds(nextSel);
          isDragging.current = true;
          dragStart.current = { x: w.x, y: w.y };
          dragOriginals.current = elements.filter((el) => nextSel.has(el.id));
          return;
        }

        isMarquee.current = true;
        marqueeStart.current = { x: w.x, y: w.y };
        marqueeBaseIds.current = additive
          ? new Set(selectedElementIds)
          : new Set();
        if (!additive) setSelectedElementIds(new Set());
        setSelectionRect({ x: w.x, y: w.y, width: 0, height: 0 });
        return;
      }

      if (tool === "eraser") {
        const tolerance = 2 / viewState.zoom;
        isErasing.current = true;
        eraserLast.current = { x: w.x, y: w.y };
        eraserTouched.current = new Set();
        for (const el of elements) {
          if (eraserHitsElement(w.x, w.y, w.x, w.y, el, tolerance)) {
            eraserTouched.current.add(el.id);
          }
        }
        return;
      }

      if (tool === "text") {
        const tolerance = 8 / viewState.zoom;
        const existing = [...elements]
          .sort((a, b) => b.zIndex - a.zIndex)
          .find(
            (el) =>
              whiteboardElementKind(el) === "text" &&
              hitTest(el, w.x, w.y, tolerance),
          );
        if (existing) {
          pendingEditId.current = existing.id;
          return;
        }
        isDrawingTextBox.current = true;
        textBoxOrigin.current = { x: w.x, y: w.y };
        textStyle.current = {
          color: settings.color,
          fontSize: settings.fontSize,
          fontWeight: settings.fontWeight,
          fontFamily: settings.fontFamily,
          align: settings.align,
        };
        setTextDraft({ x: w.x, y: w.y, width: 0, height: 0 });
        return;
      }

      isDrawing.current = true;
      const id = newId();

      if (tool === "pen" || tool === "highlighter") {
        const thickness =
          tool === "highlighter"
            ? Math.max(settings.highlighterThickness, 2)
            : Math.max(settings.thickness, 2);
        const el: IWhiteboardElement = {
          id,
          type: "drawing",
          x: w.x,
          y: w.y,
          zIndex: getNextZIndex(),
          data: {
            points: [{ x: 0, y: 0 }],
            color: settings.color,
            thickness,
            brush: tool === "highlighter" ? "highlighter" : "pen",
          } satisfies IDrawingData as unknown as Record<string, unknown>,
        };
        drawingRef.current = el;
        setActiveDrawing(el);
        return;
      }

      const shapeType =
        tool === "rectangle"
          ? "rectangle"
          : tool === "square"
            ? "square"
            : tool === "circle"
              ? "circle"
              : tool === "line"
                ? "line"
                : "arrow";
      const el: IWhiteboardElement = {
        id,
        type: "drawing",
        x: w.x,
        y: w.y,
        width: 0,
        height: 0,
        zIndex: getNextZIndex(),
        data: {
          shapeType,
          color: settings.color,
          thickness: Math.max(settings.thickness, 2),
          fill:
            settings.fill && settings.fill !== "none"
              ? settings.fill
              : undefined,
          x2: 0,
          y2: 0,
        } satisfies IShapeData as unknown as Record<string, unknown>,
      };
      drawingRef.current = el;
      setActiveDrawing(el);
    },
    [
      toWorld,
      viewState.zoom,
      elements,
      selectedElementIds,
      getNextZIndex,
      commitBucket,
    ],
  );

  const updateLive = useCallback(
    (updated: IWhiteboardElement[]) => {
      const map = new Map(updated.map((el) => [el.id, el]));
      history.setElements((prev) => prev.map((el) => map.get(el.id) ?? el));
    },
    [history],
  );

  const applyResize = useCallback(
    (w: { x: number; y: number }) => {
      const handle = resizeHandle.current;
      const originals = resizeOriginals.current;
      if (!handle || originals.length === 0) return;
      const isCorner = handleAffectsX(handle) && handleAffectsY(handle);

      if (originals.length === 1 && originals[0]) {
        const orig = originals[0];
        const rot = orig.rotation ?? 0;
        const ob = boundsOf(orig, false);
        const oc = centerOf(ob);
        const anchor = anchorForHandle(ob, handle);
        const pl = rotatePoint(w.x, w.y, oc.x, oc.y, -rot);
        const { sx, sy } = computeScale(
          ob,
          anchor,
          handle,
          pl,
          resizeShift.current,
        );
        let scaled = scaleElementAbout(
          orig,
          anchor.x,
          anchor.y,
          sx,
          sy,
          isCorner,
        );
        scaled = reanchorRotated(orig, scaled, anchor.x, anchor.y);
        updateLive([scaled]);
        return;
      }

      const gb = unionBounds(originals);
      if (!gb) return;
      const anchor = anchorForHandle(gb, handle);
      const { sx, sy } = computeScale(
        gb,
        anchor,
        handle,
        w,
        resizeShift.current,
      );
      const scaled = originals.map((o) =>
        scaleElementAbout(o, anchor.x, anchor.y, sx, sy, isCorner),
      );
      updateLive(scaled);
    },
    [updateLive],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>, _tool: WhiteboardTool) => {
      const w = toWorld(e);
      lastWorld.current = w;

      if (isPanning.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        panStart.current = { x: e.clientX, y: e.clientY };
        setViewState((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        return;
      }

      if (isRotating.current && rotateOriginal.current) {
        const c = rotateCenter.current;
        const angle = Math.atan2(w.y - c.y, w.x - c.x);
        let deg =
          (rotateOriginal.current.rotation ?? 0) +
          ((angle - rotateStartAngle.current) * 180) / Math.PI;
        if (rotateShift.current) deg = Math.round(deg / 15) * 15;
        const next = { ...rotateOriginal.current, rotation: deg };
        updateLive([next]);
        return;
      }

      if (isResizing.current) {
        applyResize(w);
        return;
      }

      if (isDragging.current) {
        const dx = w.x - dragStart.current.x;
        const dy = w.y - dragStart.current.y;
        const moved = dragOriginals.current.map((el) => ({
          ...el,
          x: el.x + dx,
          y: el.y + dy,
        }));
        updateLive(moved);
        return;
      }

      if (isMarquee.current) {
        const sx = marqueeStart.current.x;
        const sy = marqueeStart.current.y;
        const rect: SelectionRect = {
          x: Math.min(sx, w.x),
          y: Math.min(sy, w.y),
          width: Math.abs(w.x - sx),
          height: Math.abs(w.y - sy),
        };
        setSelectionRect(rect);
        const next = new Set(marqueeBaseIds.current);
        for (const el of elements) if (marqueeHits(el, rect)) next.add(el.id);
        setSelectedElementIds(next);
        return;
      }

      if (isErasing.current) {
        const tolerance = 2 / viewState.zoom;
        for (const el of elements) {
          if (eraserTouched.current.has(el.id)) continue;
          if (
            eraserHitsElement(
              eraserLast.current.x,
              eraserLast.current.y,
              w.x,
              w.y,
              el,
              tolerance,
            )
          ) {
            eraserTouched.current.add(el.id);
          }
        }
        eraserLast.current = { x: w.x, y: w.y };
        return;
      }

      if (isDrawingTextBox.current) {
        const ox = textBoxOrigin.current.x;
        const oy = textBoxOrigin.current.y;
        setTextDraft({
          x: Math.min(ox, w.x),
          y: Math.min(oy, w.y),
          width: Math.abs(w.x - ox),
          height: Math.abs(w.y - oy),
        });
        return;
      }

      if (isDrawing.current && drawingRef.current) {
        const el = drawingRef.current;
        const kind = whiteboardElementKind(el);
        if (kind === "pen") {
          const d = el.data as unknown as IDrawingData;
          const updated: IWhiteboardElement = {
            ...el,
            data: {
              ...d,
              points: [...d.points, { x: w.x - el.x, y: w.y - el.y }],
            } as unknown as Record<string, unknown>,
          };
          drawingRef.current = updated;
          setActiveDrawing(updated);
        } else {
          const s = el.data as unknown as IShapeData;
          const dx = w.x - el.x;
          const dy = w.y - el.y;
          let width = dx;
          let height = dy;
          if (s.shapeType === "square") {
            const size = Math.max(Math.abs(dx), Math.abs(dy));
            width = dx < 0 ? -size : size;
            height = dy < 0 ? -size : size;
          }
          const updated: IWhiteboardElement = {
            ...el,
            width: Math.abs(width),
            height: Math.abs(height),
            data: {
              ...s,
              x2: width,
              y2: height,
            } as unknown as Record<string, unknown>,
          };
          if (
            s.shapeType !== "arrow" &&
            s.shapeType !== "line" &&
            (width < 0 || height < 0)
          ) {
            updated.x = el.x + Math.min(0, width);
            updated.y = el.y + Math.min(0, height);
          }
          drawingRef.current = updated;
          setActiveDrawing(updated);
        }
      }
    },
    [toWorld, viewState.zoom, elements, applyResize, updateLive],
  );

  const commitTransform = useCallback(
    (originals: IWhiteboardElement[]) => {
      if (originals.length === 0) return;
      const current = elements.filter((el) =>
        originals.some((o) => o.id === el.id),
      );
      const changed = current.some((cur) => {
        const orig = originals.find((o) => o.id === cur.id);
        return orig && JSON.stringify(orig) !== JSON.stringify(cur);
      });
      if (changed) {
        pushAction({ type: "update", before: originals, after: current });
      }
    },
    [elements, pushAction],
  );

  const onPointerUp = useCallback(
    (_e: React.PointerEvent<SVGSVGElement>, _tool: WhiteboardTool) => {
      if (pendingEditId.current) {
        const id = pendingEditId.current;
        pendingEditId.current = null;
        beginEditText(id);
        return;
      }
      if (isPanning.current) {
        isPanning.current = false;
        return;
      }
      if (isRotating.current) {
        isRotating.current = false;
        if (rotateOriginal.current) commitTransform([rotateOriginal.current]);
        rotateOriginal.current = null;
        return;
      }
      if (isResizing.current) {
        isResizing.current = false;
        commitTransform(resizeOriginals.current);
        resizeHandle.current = null;
        resizeOriginals.current = [];
        return;
      }
      if (isDragging.current) {
        isDragging.current = false;
        commitTransform(dragOriginals.current);
        dragOriginals.current = [];
        return;
      }
      if (isMarquee.current) {
        isMarquee.current = false;
        setSelectionRect(null);
        return;
      }
      if (isErasing.current) {
        isErasing.current = false;
        if (eraserTouched.current.size > 0)
          removeElements(eraserTouched.current);
        eraserTouched.current = new Set();
        return;
      }
      if (isDrawingTextBox.current) {
        isDrawingTextBox.current = false;
        setTextDraft(null);
        const style = textStyle.current;
        const ox = textBoxOrigin.current;
        const last = lastWorld.current;
        const dw = Math.abs(last.x - ox.x);
        const dh = Math.abs(last.y - ox.y);
        const dragged = dw > 8 || dh > 8;
        setTextBox({
          worldX: dragged ? Math.min(ox.x, last.x) : ox.x,
          worldY: dragged ? Math.min(ox.y, last.y) : ox.y,
          width: dragged ? Math.max(dw, 40) : 40,
          height: dragged
            ? Math.max(dh, style.fontSize * 1.4)
            : style.fontSize * 1.4,
          autoSize: !dragged,
          maxWidth: TEXT_MAX_WIDTH,
          editingId: null,
          color: style.color,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontFamily: style.fontFamily,
          align: style.align,
          initialText: "",
        });
        return;
      }
      if (isDrawing.current && drawingRef.current) {
        isDrawing.current = false;
        const el = drawingRef.current;
        const kind = whiteboardElementKind(el);
        const hasSubstance =
          kind === "pen"
            ? (el.data as unknown as IDrawingData).points.length > 1
            : Math.abs(el.width ?? 0) > 2 || Math.abs(el.height ?? 0) > 2;
        if (hasSubstance) addElements([el]);
        drawingRef.current = null;
        setActiveDrawing(null);
      }
    },
    [addElements, removeElements, commitTransform, beginEditText],
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
    (text: string, width: number, height: number) => {
      const box = textBox;
      setTextBox(null);
      if (!box) return;
      const trimmed = text.replace(/\s+$/g, "");

      if (box.editingId) {
        const orig = elements.find((el) => el.id === box.editingId);
        if (!orig) return;
        if (!trimmed) {
          removeElements(new Set([box.editingId]));
          return;
        }
        const d = orig.data as unknown as ITextData;
        const after: IWhiteboardElement = {
          ...orig,
          width,
          height,
          data: { ...d, text } as unknown as Record<string, unknown>,
        };
        updateElements([after]);
        return;
      }

      if (!trimmed) return;
      const el: IWhiteboardElement = {
        id: newId(),
        type: "drawing",
        x: box.worldX,
        y: box.worldY,
        width,
        height,
        zIndex: getNextZIndex(),
        data: {
          text,
          color: box.color,
          fontSize: box.fontSize,
          fontWeight: box.fontWeight,
          fontFamily: box.fontFamily,
          align: box.align,
        } satisfies ITextData as unknown as Record<string, unknown>,
      };
      addElements([el]);
    },
    [
      textBox,
      elements,
      addElements,
      updateElements,
      removeElements,
      getNextZIndex,
    ],
  );

  const cancelText = useCallback(() => setTextBox(null), []);

  const findFreePosition = useCallback(
    (tw: number, th: number, px: number, py: number) => {
      const PAD = 20;
      const existing = elements.map((el) => boundsOf(el, true));
      const overlaps = (cx: number, cy: number) => {
        for (const b of existing) {
          if (
            cx < b.x + b.width &&
            cx + tw > b.x &&
            cy < b.y + b.height &&
            cy + th > b.y
          )
            return true;
        }
        return false;
      };
      if (!overlaps(px, py)) return { x: px, y: py };
      const step = PAD + Math.max(tw, th) * 0.5;
      for (let ring = 1; ring <= 20; ring++) {
        for (let a = 0; a < 8; a++) {
          const rad = (a / 8) * Math.PI * 2;
          const cx = px + Math.cos(rad) * ring * step;
          const cy = py + Math.sin(rad) * ring * step;
          if (!overlaps(cx, cy)) return { x: cx, y: cy };
        }
      }
      return { x: px + tw + PAD, y: py };
    },
    [elements],
  );

  const viewportCenter = useCallback(
    (w: number, h: number) => ({
      x: (-viewState.x + window.innerWidth / 2) / viewState.zoom - w / 2,
      y: (-viewState.y + window.innerHeight / 2) / viewState.zoom - h / 2,
    }),
    [viewState],
  );

  const addComponent = useCallback(
    (
      componentType: string,
      defaultSize: { width: number; height: number },
      defaultData: Record<string, unknown>,
    ) => {
      const c = viewportCenter(defaultSize.width, defaultSize.height);
      const pos = findFreePosition(
        defaultSize.width,
        defaultSize.height,
        c.x,
        c.y,
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
    [viewportCenter, findFreePosition, getNextZIndex, addElements],
  );

  const updateComponentData = useCallback(
    (elementId: string, newData: Record<string, unknown>) => {
      history.setElements((prev) => {
        const el = prev.find((e) => e.id === elementId);
        if (!el) return prev;
        const after = { ...el, data: newData };
        pushAction({ type: "update", before: [el], after: [after] });
        return prev.map((e) => (e.id === elementId ? after : e));
      });
    },
    [history, pushAction],
  );

  const addImage = useCallback(
    (src: string) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || 200;
        let h = img.naturalHeight || 200;
        const maxW = 800;
        const maxH = 600;
        if (w > maxW || h > maxH) {
          const scale = Math.min(maxW / w, maxH / h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const c = viewportCenter(w, h);
        const el: IWhiteboardElement = {
          id: newId(),
          type: "drawing",
          x: c.x,
          y: c.y,
          width: w,
          height: h,
          zIndex: getNextZIndex(),
          data: { src } satisfies IImageData as unknown as Record<
            string,
            unknown
          >,
        };
        addElements([el]);
        setSelectedElementIds(new Set([el.id]));
      };
      img.src = src;
    },
    [viewportCenter, getNextZIndex, addElements],
  );

  const copySelected = useCallback(() => {
    if (selectedElementIds.size === 0) return;
    clipboard.current = structuredClone(
      elements.filter((el) => selectedElementIds.has(el.id)),
    );
  }, [elements, selectedElementIds]);

  const pasteElements = useCallback(() => {
    if (clipboard.current.length === 0) return;
    const items = clipboard.current;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of items) {
      const b = boundsOf(el, true);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    const dx = lastWorld.current.x - (minX + maxX) / 2;
    const dy = lastWorld.current.y - (minY + maxY) / 2;
    let z = getNextZIndex();
    const pasted = items.map((el) => ({
      ...structuredClone(el),
      id: newId(),
      x: el.x + dx,
      y: el.y + dy,
      zIndex: z++,
    }));
    addElements(pasted);
    setSelectedElementIds(new Set(pasted.map((el) => el.id)));
  }, [getNextZIndex, addElements]);

  const cutSelected = useCallback(() => {
    if (selectedElementIds.size === 0) return;
    copySelected();
    removeElements(selectedElementIds);
    setSelectedElementIds(new Set());
  }, [selectedElementIds, copySelected, removeElements]);

  const duplicateSelected = useCallback(() => {
    if (selectedElementIds.size === 0) return;
    const items = elements.filter((el) => selectedElementIds.has(el.id));
    let z = getNextZIndex();
    const dupes = items.map((el) => ({
      ...structuredClone(el),
      id: newId(),
      x: el.x + 16,
      y: el.y + 16,
      zIndex: z++,
    }));
    addElements(dupes);
    setSelectedElementIds(new Set(dupes.map((el) => el.id)));
  }, [elements, selectedElementIds, getNextZIndex, addElements]);

  const pasteImage = useCallback((src: string) => addImage(src), [addImage]);
  const hasClipboard = useCallback(() => clipboard.current.length > 0, []);

  const deleteSelected = useCallback(() => {
    if (selectedElementIds.size === 0) return;
    removeElements(selectedElementIds);
    setSelectedElementIds(new Set());
  }, [selectedElementIds, removeElements]);

  const selectAll = useCallback(() => {
    setSelectedElementIds(new Set(elements.map((el) => el.id)));
  }, [elements]);

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (selectedElementIds.size === 0) return;
      const before = elements.filter((el) => selectedElementIds.has(el.id));
      const after = before.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy }));
      updateElements(after);
    },
    [elements, selectedElementIds, updateElements],
  );

  const updateSelectedStyle = useCallback(
    (mutate: (el: IWhiteboardElement) => IWhiteboardElement | null) => {
      if (selectedElementIds.size === 0) return;
      const before: IWhiteboardElement[] = [];
      const after: IWhiteboardElement[] = [];
      for (const el of elements) {
        if (!selectedElementIds.has(el.id)) continue;
        const next = mutate(el);
        if (next && JSON.stringify(next) !== JSON.stringify(el)) {
          before.push(el);
          after.push(next);
        }
      }
      if (after.length > 0) updateElements(after);
    },
    [elements, selectedElementIds, updateElements],
  );

  const reorderZ = useCallback(
    (op: "front" | "back" | "forward" | "backward") => {
      const ids = selectedElementIds;
      if (ids.size === 0) return;
      const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
      let ordered: IWhiteboardElement[];
      if (op === "front") {
        ordered = [
          ...sorted.filter((el) => !ids.has(el.id)),
          ...sorted.filter((el) => ids.has(el.id)),
        ];
      } else if (op === "back") {
        ordered = [
          ...sorted.filter((el) => ids.has(el.id)),
          ...sorted.filter((el) => !ids.has(el.id)),
        ];
      } else {
        ordered = [...sorted];
        const dir = op === "forward" ? 1 : -1;
        const indices = ordered
          .map((el, i) => ({ el, i }))
          .filter(({ el }) => ids.has(el.id))
          .map(({ i }) => i);
        const iter = dir === 1 ? [...indices].reverse() : indices;
        for (const i of iter) {
          const j = i + dir;
          if (j < 0 || j >= ordered.length) continue;
          if (ids.has(ordered[j]?.id ?? "")) continue;
          const a = ordered[i];
          const b = ordered[j];
          if (a && b) {
            ordered[i] = b;
            ordered[j] = a;
          }
        }
      }
      const changed: IWhiteboardElement[] = [];
      ordered.forEach((el, i) => {
        if (el.zIndex !== i) changed.push({ ...el, zIndex: i });
      });
      if (changed.length > 0) updateElements(changed);
    },
    [elements, selectedElementIds, updateElements],
  );

  const moveElementZ = useCallback(
    (elementId: string, dir: "up" | "down") => {
      const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
      const i = sorted.findIndex((el) => el.id === elementId);
      if (i < 0) return;
      const j = dir === "up" ? i + 1 : i - 1;
      if (j < 0 || j >= sorted.length) return;
      const a = sorted[i];
      const b = sorted[j];
      if (!a || !b) return;
      updateElements([
        { ...a, zIndex: b.zIndex },
        { ...b, zIndex: a.zIndex },
      ]);
    },
    [elements, updateElements],
  );

  const deleteElement = useCallback(
    (elementId: string) => {
      removeElements(new Set([elementId]));
      setSelectedElementIds((prev) => {
        const next = new Set(prev);
        next.delete(elementId);
        return next;
      });
    },
    [removeElements],
  );

  const initializeView = useCallback((vs: ViewState) => setViewState(vs), []);

  return {
    viewState,
    setViewState,
    activeDrawing,
    selectedElementIds,
    setSelectedElementIds,
    selectionRect,
    textBox,
    setTextBox,
    textDraft,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    setSpacePan,
    startResize,
    startRotate,
    beginEditText,
    commitText,
    cancelText,
    addComponent,
    updateComponentData,
    addImage,
    copySelected,
    cutSelected,
    pasteElements,
    pasteImage,
    duplicateSelected,
    hasClipboard,
    deleteSelected,
    deleteElement,
    selectAll,
    nudgeSelected,
    updateSelectedStyle,
    reorderZ,
    moveElementZ,
    initializeView,
  };
}

function computeScale(
  ob: { x: number; y: number; width: number; height: number },
  anchor: { x: number; y: number },
  handle: ResizeHandle,
  p: { x: number; y: number },
  shift: boolean,
): { sx: number; sy: number } {
  const affX = handleAffectsX(handle);
  const affY = handleAffectsY(handle);
  const leftSide = handle === "nw" || handle === "w" || handle === "sw";
  const topSide = handle === "nw" || handle === "n" || handle === "ne";

  let newW = ob.width;
  let newH = ob.height;
  if (affX) {
    newW = leftSide ? anchor.x - p.x : p.x - anchor.x;
    newW = Math.max(MIN_SIZE, newW);
  }
  if (affY) {
    newH = topSide ? anchor.y - p.y : p.y - anchor.y;
    newH = Math.max(MIN_SIZE, newH);
  }
  let sx = ob.width > 0 ? newW / ob.width : 1;
  let sy = ob.height > 0 ? newH / ob.height : 1;
  if (!affX) sx = 1;
  if (!affY) sy = 1;
  if (shift && affX && affY) {
    const s = Math.max(sx, sy);
    sx = s;
    sy = s;
  }
  return { sx, sy };
}
