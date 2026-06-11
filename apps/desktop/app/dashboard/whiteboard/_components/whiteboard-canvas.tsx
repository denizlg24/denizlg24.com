"use client";

import type { IWhiteboardElement } from "@/lib/data-types";
import type {
  DrawingData,
  ResizeHandle,
  SelectionRect,
  ShapeData,
  TextData,
  ViewState,
  WhiteboardTool,
} from "@/lib/whiteboard-types";
import { templateRegistry } from "./templates";
import { WhiteboardElement } from "./whiteboard-element";

const GRID_SIZE = 40;

function GridPattern({ zoom }: { zoom: number }) {
  const scaledSize = GRID_SIZE * zoom;
  if (scaledSize < 8) return null;

  const opacity = Math.min(0.3, Math.max(0.05, (scaledSize - 8) / 80));

  return (
    <defs>
      <pattern
        id="whiteboard-grid"
        width={GRID_SIZE}
        height={GRID_SIZE}
        patternUnits="userSpaceOnUse"
      >
        <circle
          cx={GRID_SIZE / 2}
          cy={GRID_SIZE / 2}
          r={0.8}
          fill={`rgba(48, 54, 48, ${opacity})`}
        />
      </pattern>
    </defs>
  );
}

function SelectionOverlay({
  rect,
  viewState,
}: {
  rect: SelectionRect;
  viewState: ViewState;
}) {
  return (
    <rect
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      fill="rgba(161, 188, 152, 0.15)"
      stroke="var(--accent)"
      strokeWidth={1 / viewState.zoom}
      strokeDasharray={`${4 / viewState.zoom}`}
    />
  );
}

function SelectedElementHighlight({
  element,
  zoom,
  onStartResize,
  isPointerTool,
}: {
  element: IWhiteboardElement;
  zoom: number;
  onStartResize: (elementId: string, handle: ResizeHandle) => void;
  isPointerTool: boolean;
}) {
  const padding = 4 / zoom;
  const sw = 1.5 / zoom;
  const handleSize = 8 / zoom;

  const data = element.data as Record<string, unknown>;
  let bx: number;
  let by: number;
  let bw: number;
  let bh: number;

  if (data.points) {
    const points = data.points as { x: number; y: number }[];
    if (points.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    bx = element.x + minX - padding;
    by = element.y + minY - padding;
    bw = maxX - minX + padding * 2;
    bh = maxY - minY + padding * 2;
  } else {
    const w = element.width ?? 0;
    const h = element.height ?? 0;
    bx = element.x - padding;
    by = element.y - padding;
    bw = w + padding * 2;
    bh = h + padding * 2;
  }

  const handles: {
    handle: ResizeHandle;
    cx: number;
    cy: number;
    cursor: string;
  }[] = [
    { handle: "top-left", cx: bx, cy: by, cursor: "nwse-resize" },
    { handle: "top-right", cx: bx + bw, cy: by, cursor: "nesw-resize" },
    { handle: "bottom-left", cx: bx, cy: by + bh, cursor: "nesw-resize" },
    { handle: "bottom-right", cx: bx + bw, cy: by + bh, cursor: "nwse-resize" },
  ];

  return (
    <g>
      <rect
        x={bx}
        y={by}
        width={bw}
        height={bh}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={sw}
        strokeDasharray={`${3 / zoom}`}
        rx={2 / zoom}
      />
      {isPointerTool &&
        handles.map((h) => (
          <rect
            key={h.handle}
            x={h.cx - handleSize / 2}
            y={h.cy - handleSize / 2}
            width={handleSize}
            height={handleSize}
            fill="white"
            stroke="var(--accent)"
            strokeWidth={sw}
            rx={1 / zoom}
            style={{ cursor: h.cursor }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const svg = (e.target as SVGElement).ownerSVGElement;
              if (svg) svg.setPointerCapture(e.pointerId);
              onStartResize(element.id, h.handle);
            }}
          />
        ))}
    </g>
  );
}

export function getElementBoundsForCanvas(el: IWhiteboardElement): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const data = el.data as Record<string, unknown>;

  if (data.points) {
    const d = data as unknown as DrawingData;
    if (d.points.length === 0) return { x: el.x, y: el.y, w: 0, h: 0 };
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
      return { x: el.x + minX, y: el.y + minY, w: maxX - minX, h: maxY - minY };
    }
    return { x: el.x, y: el.y, w: el.width ?? 0, h: el.height ?? 0 };
  }

  if (data.text !== undefined) {
    const d = data as unknown as TextData;
    const fontSize = d.fontSize ?? 16;
    const text = d.text as string;
    const estimatedWidth = Math.max(20, text.length * fontSize * 0.6);
    return {
      x: el.x,
      y: el.y,
      w: el.width ?? estimatedWidth,
      h: el.height ?? fontSize * 1.4,
    };
  }

  return { x: el.x, y: el.y, w: el.width ?? 0, h: el.height ?? 0 };
}

function getSelectionBoundingBox(
  elements: IWhiteboardElement[],
  selectedIds: Set<string>,
): { x: number; y: number; w: number; h: number } | null {
  if (selectedIds.size === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const el of elements) {
    if (!selectedIds.has(el.id)) continue;
    found = true;
    const b = getElementBoundsForCanvas(el);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export interface WhiteboardCanvasProps {
  elements: IWhiteboardElement[];
  viewState: ViewState;
  selectedTool: WhiteboardTool;
  selectedElementIds: Set<string>;
  selectionRect: SelectionRect | null;
  activeDrawing: IWhiteboardElement | null;
  textBox: {
    worldX: number;
    worldY: number;
    width: number;
    height: number;
  } | null;
  selectedColor: string;
  selectedThickness: number;
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  onTextCommit: (text: string) => void;
  onTextCancel: () => void;
  onDeleteSelected: () => void;
  onStartResize: (elementId: string, handle: ResizeHandle) => void;
  onComponentDataChange: (
    elementId: string,
    data: Record<string, unknown>,
  ) => void;
  onComponentDelete: (elementId: string) => void;
}

export function WhiteboardCanvas({
  elements,
  viewState,
  selectedTool,
  selectedElementIds,
  selectionRect,
  activeDrawing,
  textBox,
  selectedColor,
  selectedThickness,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onTextCommit,
  onTextCancel,
  onDeleteSelected,
  onStartResize,
  onComponentDataChange,
  onComponentDelete,
}: WhiteboardCanvasProps) {
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const selectionBBox = getSelectionBoundingBox(elements, selectedElementIds);
  const isPointerTool = selectedTool === "pointer" || selectedTool === "select";

  return (
    <div className="relative w-full h-full">
      <svg
        className="w-full h-full touch-none"
        style={{ display: "block" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <GridPattern zoom={viewState.zoom} />
        <rect
          x={-viewState.x / viewState.zoom - 50000}
          y={-viewState.y / viewState.zoom - 50000}
          width={100000}
          height={100000}
          fill="url(#whiteboard-grid)"
          transform={`translate(${viewState.x}, ${viewState.y}) scale(${viewState.zoom})`}
        />

        <g
          transform={`translate(${viewState.x}, ${viewState.y}) scale(${viewState.zoom})`}
        >
          {sorted.map((el) => (
            <WhiteboardElement key={el.id} element={el} />
          ))}

          {activeDrawing && <WhiteboardElement element={activeDrawing} />}

          {selectedElementIds.size > 0 &&
            elements
              .filter((el) => selectedElementIds.has(el.id))
              .map((el) => (
                <SelectedElementHighlight
                  key={`sel-${el.id}`}
                  element={el}
                  zoom={viewState.zoom}
                  onStartResize={onStartResize}
                  isPointerTool={isPointerTool}
                />
              ))}

          {selectionRect && (
            <SelectionOverlay rect={selectionRect} viewState={viewState} />
          )}
        </g>
      </svg>

      {sorted
        .filter(
          (el): el is IWhiteboardElement & { componentType: string } =>
            el.type === "component" && !!el.componentType,
        )
        .map((el) => {
          const templateDef = templateRegistry[el.componentType];
          if (!templateDef) return null;

          const TemplateComponent = templateDef.component;
          const screenX = el.x * viewState.zoom + viewState.x;
          const screenY = el.y * viewState.zoom + viewState.y;
          const screenW =
            (el.width ?? templateDef.defaultSize.width) * viewState.zoom;
          const screenH =
            (el.height ?? templateDef.defaultSize.height) * viewState.zoom;

          const isSelected = selectedElementIds.has(el.id);

          return (
            <div
              key={`component-${el.id}`}
              className="absolute origin-top-left"
              style={{
                left: screenX,
                top: screenY,
                width: screenW,
                height: screenH,
                pointerEvents: isPointerTool && isSelected ? "auto" : "none",
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  width: el.width ?? templateDef.defaultSize.width,
                  height: el.height ?? templateDef.defaultSize.height,
                  transform: `scale(${viewState.zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <TemplateComponent
                  id={el.id}
                  data={el.data}
                  onDataChange={(newData) =>
                    onComponentDataChange(el.id, newData)
                  }
                  onDelete={() => onComponentDelete(el.id)}
                  width={el.width ?? templateDef.defaultSize.width}
                  height={el.height ?? templateDef.defaultSize.height}
                />
              </div>
            </div>
          );
        })}

      {textBox && (
        <div
          className="absolute"
          style={{
            left: textBox.worldX * viewState.zoom + viewState.x,
            top: textBox.worldY * viewState.zoom + viewState.y,
            width: textBox.width * viewState.zoom,
            height: textBox.height * viewState.zoom,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <textarea
            // biome-ignore lint: autofocus is intentional for text tool
            autoFocus
            className="w-full h-full bg-transparent border border-primary/60 outline-none text-accent-strong resize-none p-1 rounded-sm"
            style={{
              color: selectedColor,
              fontSize: `${Math.max(selectedThickness * 2, 16) * viewState.zoom}px`,
              lineHeight: 1.3,
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onTextCommit((e.target as HTMLTextAreaElement).value);
              }
              if (e.key === "Escape") {
                onTextCancel();
              }
            }}
            onBlur={(e) => {
              if (e.target.value.trim()) {
                onTextCommit(e.target.value);
              } else {
                onTextCancel();
              }
            }}
          />
        </div>
      )}

      {selectionBBox && selectedElementIds.size > 0 && (
        <button
          type="button"
          className="absolute flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-white hover:bg-destructive/80 shadow-sm transition-colors z-10"
          style={{
            left:
              (selectionBBox.x + selectionBBox.w) * viewState.zoom +
              viewState.x +
              4,
            top: selectionBBox.y * viewState.zoom + viewState.y - 10,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteSelected();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Delete selected"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      )}
    </div>
  );
}
