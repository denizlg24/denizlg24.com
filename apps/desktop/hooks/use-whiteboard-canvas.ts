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
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
/** Screen pixels a press may wander before it counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

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

type Point = { x: number; y: number };

interface TextStyle {
  color: string;
  fontSize: number;
  fontWeight: number;
  fontFamily: TextFontFamily;
  align: "left" | "center" | "right";
}

/* One gesture at a time, from pointerdown to pointerup. `latest` holds what a
   transform last wrote so the history entry records it, rather than whatever
   the last render happened to see. */
type Gesture =
  | { kind: "pan"; last: Point }
  | {
      kind: "move";
      origin: Point;
      screen: Point;
      originals: IWhiteboardElement[];
      latest: IWhiteboardElement[] | null;
      /** Selection to apply if the press ends without dragging. */
      onClick: Set<string> | null;
    }
  | { kind: "marquee"; origin: Point; base: Set<string> }
  | { kind: "erase"; last: Point; touched: Set<string> }
  | { kind: "text-box"; origin: Point; style: TextStyle }
  | { kind: "edit-text"; id: string }
  | { kind: "draw"; element: IWhiteboardElement }
  | {
      kind: "resize";
      handle: ResizeHandle;
      originals: IWhiteboardElement[];
      latest: IWhiteboardElement[] | null;
    }
  | {
      kind: "rotate";
      original: IWhiteboardElement;
      center: Point;
      startAngle: number;
      latest: IWhiteboardElement | null;
    };

const CREATION_TOOLS: ReadonlySet<WhiteboardTool> = new Set([
  "pen",
  "highlighter",
  "eraser",
  "text",
  "rectangle",
  "square",
  "circle",
  "arrow",
  "line",
  "bucket",
]);

/** Tools that author content; picking one drops the current selection. */
export function isCreationTool(tool: WhiteboardTool): boolean {
  return CREATION_TOOLS.has(tool);
}

function screenToWorld(sx: number, sy: number, view: ViewState) {
  return { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom };
}

function sameIds(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function useWhiteboardCanvas(
  history: ReturnType<typeof useWhiteboardHistory>,
) {
  const {
    elements,
    getElements,
    setElements,
    addElements,
    removeElements,
    updateElements,
    pushAction,
  } = history;

  /* View, selection and the text box are mirrored into refs for the same
     reason the elements are: two pointer events can arrive before React
     re-renders, and a handler reading render-time state then acts on a
     selection or view that is already gone. */
  const [viewState, setViewStateRaw] = useState<ViewState>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const viewRef = useRef(viewState);
  const setViewState = useCallback((action: SetStateAction<ViewState>) => {
    const next =
      typeof action === "function" ? action(viewRef.current) : action;
    viewRef.current = next;
    setViewStateRaw(next);
  }, []);

  const [selectedElementIds, setSelectedRaw] = useState<Set<string>>(new Set());
  const selectionRef = useRef(selectedElementIds);
  const setSelectedElementIds = useCallback(
    (action: SetStateAction<Set<string>>) => {
      const next =
        typeof action === "function" ? action(selectionRef.current) : action;
      if (sameIds(next, selectionRef.current)) return;
      selectionRef.current = next;
      setSelectedRaw(next);
    },
    [],
  );

  const [textBox, setTextBoxRaw] = useState<TextBoxState | null>(null);
  const textBoxRef = useRef(textBox);
  const setTextBox = useCallback((next: TextBoxState | null) => {
    textBoxRef.current = next;
    setTextBoxRaw(next);
  }, []);

  const [activeDrawing, setActiveDrawing] = useState<IWhiteboardElement | null>(
    null,
  );
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(
    null,
  );
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);

  const gesture = useRef<Gesture | null>(null);
  const gesturePointer = useRef<number | null>(null);
  const spacePan = useRef(false);

  const clipboard = useRef<IWhiteboardElement[]>([]);
  const lastWorld = useRef({ x: 0, y: 0 });

  /* Undo, redo and the eraser remove elements without going through the
     selection, so ids that no longer exist are dropped here. */
  useEffect(() => {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const live = new Set(elements.map((el) => el.id));
    const pruned = new Set([...sel].filter((id) => live.has(id)));
    if (pruned.size !== sel.size) setSelectedElementIds(pruned);
  }, [elements, setSelectedElementIds]);

  const getNextZIndex = useCallback((): number => {
    let max = 0;
    for (const el of getElements()) if (el.zIndex > max) max = el.zIndex;
    return max + 1;
  }, [getElements]);

  const toWorld = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
      viewRef.current,
    );
  }, []);

  const topmostHit = useCallback(
    (p: Point, tolerance: number, skipId?: string | null) => {
      const sorted = [...getElements()].sort((a, b) => b.zIndex - a.zIndex);
      return (
        sorted.find(
          (el) => el.id !== skipId && hitTest(el, p.x, p.y, tolerance),
        ) ?? null
      );
    },
    [getElements],
  );

  const setSpacePan = useCallback((on: boolean) => {
    spacePan.current = on;
  }, []);

  const updateLive = useCallback(
    (updated: IWhiteboardElement[]) => {
      const map = new Map(updated.map((el) => [el.id, el]));
      setElements((prev) => prev.map((el) => map.get(el.id) ?? el));
    },
    [setElements],
  );

  const startResize = useCallback(
    (handle: ResizeHandle) => {
      if (gesture.current) return;
      const sel = selectionRef.current;
      const originals = getElements().filter((el) => sel.has(el.id));
      if (originals.length === 0) return;
      gesture.current = {
        kind: "resize",
        handle,
        originals: originals.map((el) => ({ ...el })),
        latest: null,
      };
    },
    [getElements],
  );

  const startRotate = useCallback(
    (worldX: number, worldY: number) => {
      if (gesture.current) return;
      const sel = selectionRef.current;
      if (sel.size !== 1) return;
      const id = [...sel][0];
      const orig = getElements().find((el) => el.id === id);
      if (!orig) return;
      const c = centerOf(boundsOf(orig, false));
      gesture.current = {
        kind: "rotate",
        original: { ...orig },
        center: c,
        startAngle: Math.atan2(worldY - c.y, worldX - c.x),
        latest: null,
      };
    },
    [getElements],
  );

  const commitBucket = useCallback(
    (wx: number, wy: number, settings: DrawSettings) => {
      const tolerance = 6 / viewRef.current.zoom;
      const sorted = [...getElements()].sort((a, b) => b.zIndex - a.zIndex);
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
    [getElements, updateElements],
  );

  const beginEditText = useCallback(
    (elementId: string) => {
      const el = getElements().find((e) => e.id === elementId);
      if (!el || whiteboardElementKind(el) !== "text") return;
      const d = el.data as unknown as ITextData;
      setSelectedElementIds(new Set());
      setTextBox({
        worldX: el.x,
        worldY: el.y,
        width: el.width ?? 120,
        height: el.height ?? d.fontSize * 1.4,
        autoSize: false,
        editingId: el.id,
        color: d.color,
        fontSize: d.fontSize,
        fontWeight: d.fontWeight ?? 400,
        fontFamily: d.fontFamily ?? "handwriting",
        align: d.align ?? "left",
        initialText: d.text,
      });
    },
    [getElements, setSelectedElementIds, setTextBox],
  );

  const onPointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      tool: WhiteboardTool,
      settings: DrawSettings,
    ) => {
      /* A second finger or pen while a gesture runs, and the context-menu
         button, are not gestures of their own. */
      if (gesture.current || (e.button !== 0 && e.button !== 1)) return;
      if (e.button === 1) e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      gesturePointer.current = e.pointerId;
      const w = toWorld(e);
      lastWorld.current = w;

      if (spacePan.current || tool === "hand" || e.button === 1) {
        gesture.current = { kind: "pan", last: { x: e.clientX, y: e.clientY } };
        return;
      }

      if (isCreationTool(tool)) setSelectedElementIds(new Set());

      if (tool === "bucket") {
        commitBucket(w.x, w.y, settings);
        return;
      }

      if (tool === "pointer") {
        const additive = e.shiftKey || e.metaKey;
        const sel = selectionRef.current;
        const hit = topmostHit(
          w,
          8 / viewRef.current.zoom,
          textBoxRef.current?.editingId,
        );

        if (hit) {
          const selected = sel.has(hit.id);
          let next: Set<string>;
          let onClick: Set<string> | null = null;
          if (additive) {
            next = selected ? sel : new Set([...sel, hit.id]);
            /* Shift-clicking a selected element removes it, but only once it
               is clear the press was a click: dragging moves the selection. */
            if (selected) {
              onClick = new Set(sel);
              onClick.delete(hit.id);
            }
          } else {
            next = selected ? sel : new Set([hit.id]);
            if (selected && sel.size > 1) onClick = new Set([hit.id]);
          }
          setSelectedElementIds(next);
          gesture.current = {
            kind: "move",
            origin: w,
            screen: { x: e.clientX, y: e.clientY },
            originals: getElements().filter((el) => next.has(el.id)),
            latest: null,
            onClick,
          };
          return;
        }

        const base = additive ? new Set(sel) : new Set<string>();
        if (!additive) setSelectedElementIds(base);
        gesture.current = { kind: "marquee", origin: w, base };
        setSelectionRect({ x: w.x, y: w.y, width: 0, height: 0 });
        return;
      }

      if (tool === "eraser") {
        const tolerance = 2 / viewRef.current.zoom;
        const touched = new Set<string>();
        for (const el of getElements()) {
          if (eraserHitsElement(w.x, w.y, w.x, w.y, el, tolerance)) {
            touched.add(el.id);
          }
        }
        gesture.current = { kind: "erase", last: w, touched };
        return;
      }

      if (tool === "text") {
        const tolerance = 8 / viewRef.current.zoom;
        const existing = [...getElements()]
          .sort((a, b) => b.zIndex - a.zIndex)
          .find(
            (el) =>
              whiteboardElementKind(el) === "text" &&
              hitTest(el, w.x, w.y, tolerance),
          );
        /* Editing must start on pointer-up: mounting the editor during
           pointerdown (while the canvas holds pointer capture) gets it blurred
           by the ensuing pointerup, which instantly commits and closes it. */
        if (existing) {
          gesture.current = { kind: "edit-text", id: existing.id };
          return;
        }
        gesture.current = {
          kind: "text-box",
          origin: w,
          style: {
            color: settings.color,
            fontSize: settings.fontSize,
            fontWeight: settings.fontWeight,
            fontFamily: settings.fontFamily,
            align: settings.align,
          },
        };
        setTextDraft({ x: w.x, y: w.y, width: 0, height: 0 });
        return;
      }

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
        gesture.current = { kind: "draw", element: el };
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
      gesture.current = { kind: "draw", element: el };
      setActiveDrawing(el);
    },
    [
      toWorld,
      topmostHit,
      getElements,
      getNextZIndex,
      commitBucket,
      setSelectedElementIds,
    ],
  );

  const resizeTo = useCallback(
    (
      handle: ResizeHandle,
      originals: IWhiteboardElement[],
      w: Point,
      shift: boolean,
    ): IWhiteboardElement[] => {
      const isCorner = handleAffectsX(handle) && handleAffectsY(handle);

      if (originals.length === 1 && originals[0]) {
        const orig = originals[0];
        const rot = orig.rotation ?? 0;
        const ob = boundsOf(orig, false);
        const oc = centerOf(ob);
        const anchor = anchorForHandle(ob, handle);
        const pl = rotatePoint(w.x, w.y, oc.x, oc.y, -rot);
        const { sx, sy } = computeScale(ob, anchor, handle, pl, shift);
        const scaled = scaleElementAbout(
          orig,
          anchor.x,
          anchor.y,
          sx,
          sy,
          isCorner,
        );
        return [reanchorRotated(orig, scaled, anchor.x, anchor.y)];
      }

      const gb = unionBounds(originals);
      if (!gb) return originals;
      const anchor = anchorForHandle(gb, handle);
      const { sx, sy } = computeScale(gb, anchor, handle, w, shift);
      return originals.map((o) =>
        scaleElementAbout(o, anchor.x, anchor.y, sx, sy, isCorner),
      );
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, _tool: WhiteboardTool) => {
      if (
        gesturePointer.current !== null &&
        e.pointerId !== gesturePointer.current
      )
        return;
      const w = toWorld(e);
      lastWorld.current = w;
      const g = gesture.current;
      if (!g) return;

      switch (g.kind) {
        case "pan": {
          const dx = e.clientX - g.last.x;
          const dy = e.clientY - g.last.y;
          g.last = { x: e.clientX, y: e.clientY };
          setViewState((prev) => ({
            ...prev,
            x: prev.x + dx,
            y: prev.y + dy,
          }));
          return;
        }
        case "rotate": {
          const angle = Math.atan2(w.y - g.center.y, w.x - g.center.x);
          let deg =
            (g.original.rotation ?? 0) +
            ((angle - g.startAngle) * 180) / Math.PI;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          g.latest = { ...g.original, rotation: deg };
          updateLive([g.latest]);
          return;
        }
        case "resize": {
          g.latest = resizeTo(g.handle, g.originals, w, e.shiftKey);
          updateLive(g.latest);
          return;
        }
        case "move": {
          if (
            !g.latest &&
            Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) <
              DRAG_THRESHOLD
          )
            return;
          const dx = w.x - g.origin.x;
          const dy = w.y - g.origin.y;
          g.latest = g.originals.map((el) => ({
            ...el,
            x: el.x + dx,
            y: el.y + dy,
          }));
          updateLive(g.latest);
          return;
        }
        case "marquee": {
          const rect: SelectionRect = {
            x: Math.min(g.origin.x, w.x),
            y: Math.min(g.origin.y, w.y),
            width: Math.abs(w.x - g.origin.x),
            height: Math.abs(w.y - g.origin.y),
          };
          setSelectionRect(rect);
          const next = new Set(g.base);
          for (const el of getElements())
            if (marqueeHits(el, rect)) next.add(el.id);
          setSelectedElementIds(next);
          return;
        }
        case "erase": {
          const tolerance = 2 / viewRef.current.zoom;
          for (const el of getElements()) {
            if (g.touched.has(el.id)) continue;
            if (
              eraserHitsElement(g.last.x, g.last.y, w.x, w.y, el, tolerance)
            ) {
              g.touched.add(el.id);
            }
          }
          g.last = w;
          return;
        }
        case "text-box": {
          setTextDraft({
            x: Math.min(g.origin.x, w.x),
            y: Math.min(g.origin.y, w.y),
            width: Math.abs(w.x - g.origin.x),
            height: Math.abs(w.y - g.origin.y),
          });
          return;
        }
        case "draw": {
          const el = g.element;
          if (whiteboardElementKind(el) === "pen") {
            const d = el.data as unknown as IDrawingData;
            g.element = {
              ...el,
              data: {
                ...d,
                points: [...d.points, { x: w.x - el.x, y: w.y - el.y }],
              } as unknown as Record<string, unknown>,
            };
            setActiveDrawing(g.element);
            return;
          }
          const s = el.data as unknown as IShapeData;
          /* `el.x/y` is re-anchored below for negative boxes, so the drag
             is measured from where the press began, which never moves. */
          const start = {
            x: el.x - Math.min(0, s.x2 ?? 0),
            y: el.y - Math.min(0, s.y2 ?? 0),
          };
          const isSegment = s.shapeType === "arrow" || s.shapeType === "line";
          const ox = isSegment ? el.x : start.x;
          const oy = isSegment ? el.y : start.y;
          const dx = w.x - ox;
          const dy = w.y - oy;
          let width = dx;
          let height = dy;
          if (s.shapeType === "square") {
            const size = Math.max(Math.abs(dx), Math.abs(dy));
            width = dx < 0 ? -size : size;
            height = dy < 0 ? -size : size;
          }
          g.element = {
            ...el,
            x: isSegment ? ox : ox + Math.min(0, width),
            y: isSegment ? oy : oy + Math.min(0, height),
            width: Math.abs(width),
            height: Math.abs(height),
            data: {
              ...s,
              x2: width,
              y2: height,
            } as unknown as Record<string, unknown>,
          };
          setActiveDrawing(g.element);
          return;
        }
        case "edit-text":
          return;
      }
    },
    [
      toWorld,
      getElements,
      resizeTo,
      updateLive,
      setViewState,
      setSelectedElementIds,
    ],
  );

  const commitTransform = useCallback(
    (originals: IWhiteboardElement[], latest: IWhiteboardElement[] | null) => {
      if (!latest || originals.length === 0) return;
      const changed = latest.some((cur) => {
        const orig = originals.find((o) => o.id === cur.id);
        return orig && JSON.stringify(orig) !== JSON.stringify(cur);
      });
      if (changed)
        pushAction({ type: "update", before: originals, after: latest });
    },
    [pushAction],
  );

  /** Ends the current gesture and returns the id of an element it created. */
  const onPointerUp = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      _tool: WhiteboardTool,
    ): string | null => {
      if (
        gesturePointer.current !== null &&
        e.pointerId !== gesturePointer.current
      )
        return null;
      const g = gesture.current;
      gesture.current = null;
      gesturePointer.current = null;
      if (!g) return null;

      switch (g.kind) {
        case "pan":
          return null;
        case "edit-text":
          beginEditText(g.id);
          return null;
        case "rotate":
          commitTransform([g.original], g.latest ? [g.latest] : null);
          return null;
        case "resize":
          commitTransform(g.originals, g.latest);
          return null;
        case "move":
          if (g.latest) commitTransform(g.originals, g.latest);
          else if (g.onClick) setSelectedElementIds(g.onClick);
          return null;
        case "marquee":
          setSelectionRect(null);
          return null;
        case "erase":
          if (g.touched.size > 0) removeElements(g.touched);
          return null;
        case "text-box": {
          setTextDraft(null);
          const { style, origin: ox } = g;
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
            editingId: null,
            color: style.color,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            fontFamily: style.fontFamily,
            align: style.align,
            initialText: "",
          });
          return null;
        }
        case "draw": {
          const el = g.element;
          setActiveDrawing(null);
          const kind = whiteboardElementKind(el);
          const hasSubstance =
            kind === "pen"
              ? (el.data as unknown as IDrawingData).points.length > 1
              : Math.abs(el.width ?? 0) > 2 || Math.abs(el.height ?? 0) > 2;
          if (!hasSubstance) return null;
          addElements([el]);
          /* A shape hands over to the select tool with itself selected; a
             stroke leaves nothing selected so the next stroke can follow. */
          if (kind !== "pen") setSelectedElementIds(new Set([el.id]));
          return el.id;
        }
      }
    },
    [
      addElements,
      removeElements,
      commitTransform,
      beginEditText,
      setSelectedElementIds,
      setTextBox,
    ],
  );

  /** Abandons the current gesture, putting transformed elements back. */
  const cancelGesture = useCallback((): boolean => {
    const g = gesture.current;
    gesture.current = null;
    gesturePointer.current = null;
    if (!g) return false;
    switch (g.kind) {
      case "move":
      case "resize":
        if (g.latest) updateLive(g.originals);
        break;
      case "rotate":
        if (g.latest) updateLive([g.original]);
        break;
      case "marquee":
        setSelectionRect(null);
        setSelectedElementIds(g.base);
        break;
      case "text-box":
        setTextDraft(null);
        break;
      case "draw":
        setActiveDrawing(null);
        break;
      default:
        break;
    }
    return true;
  }, [updateLive, setSelectedElementIds]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = e.currentTarget.getBoundingClientRect();
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
    },
    [setViewState],
  );

  /** Opens the topmost element under a double-click for editing if it is
   *  text; returns whether it did. */
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): boolean => {
      if (textBoxRef.current) return false;
      const hit = topmostHit(toWorld(e), 8 / viewRef.current.zoom);
      if (!hit || whiteboardElementKind(hit) !== "text") return false;
      beginEditText(hit.id);
      return true;
    },
    [topmostHit, toWorld, beginEditText],
  );

  /** Commits the open text box. `select` leaves the result selected, which is
   *  what an explicit exit (Escape, Cmd+Enter) wants; a blur caused by
   *  pressing elsewhere leaves selection to that press. Safe to call twice:
   *  the unmount that follows a commit can blur the textarea again. */
  const commitText = useCallback(
    (text: string, width: number, height: number, select: boolean) => {
      const box = textBoxRef.current;
      if (!box) return;
      setTextBox(null);
      const trimmed = text.replace(/\s+$/g, "");

      if (box.editingId) {
        const orig = getElements().find((el) => el.id === box.editingId);
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
        if (JSON.stringify(after) !== JSON.stringify(orig))
          updateElements([after]);
        if (select) setSelectedElementIds(new Set([orig.id]));
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
      if (select) setSelectedElementIds(new Set([el.id]));
    },
    [
      getElements,
      addElements,
      updateElements,
      removeElements,
      getNextZIndex,
      setSelectedElementIds,
      setTextBox,
    ],
  );

  const cancelText = useCallback(() => setTextBox(null), [setTextBox]);

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
    [
      viewportCenter,
      findFreePosition,
      getNextZIndex,
      addElements,
      setSelectedElementIds,
    ],
  );

  const updateComponentData = useCallback(
    (
      elementId: string,
      newData: Record<string, unknown>,
      size?: { width?: number; height?: number },
    ) => {
      const el = getElements().find((e) => e.id === elementId);
      if (!el) return;
      // A component that reports a size derives it from its content, so the
      // value is applied as given. Only the axis it reports is touched.
      updateElements([
        {
          ...el,
          data: newData,
          width: size?.width ?? el.width,
          height: size?.height ?? el.height,
        },
      ]);
    },
    [getElements, updateElements],
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
    [viewportCenter, getNextZIndex, addElements, setSelectedElementIds],
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
  }, [getNextZIndex, addElements, setSelectedElementIds]);

  const cutSelected = useCallback(() => {
    if (selectedElementIds.size === 0) return;
    copySelected();
    removeElements(selectedElementIds);
    setSelectedElementIds(new Set());
  }, [selectedElementIds, copySelected, removeElements, setSelectedElementIds]);

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
  }, [
    elements,
    selectedElementIds,
    getNextZIndex,
    addElements,
    setSelectedElementIds,
  ]);

  const pasteImage = useCallback((src: string) => addImage(src), [addImage]);
  const hasClipboard = useCallback(() => clipboard.current.length > 0, []);

  const deleteSelected = useCallback(() => {
    if (selectedElementIds.size === 0) return;
    removeElements(selectedElementIds);
    setSelectedElementIds(new Set());
  }, [selectedElementIds, removeElements, setSelectedElementIds]);

  const selectAll = useCallback(() => {
    setSelectedElementIds(new Set(elements.map((el) => el.id)));
  }, [elements, setSelectedElementIds]);

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
    [removeElements, setSelectedElementIds],
  );

  const initializeView = useCallback(
    (vs: ViewState) => setViewState(vs),
    [setViewState],
  );

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
    cancelGesture,
    onWheel,
    onDoubleClick,
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
