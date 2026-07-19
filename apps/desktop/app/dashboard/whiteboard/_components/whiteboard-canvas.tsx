"use client";

import type { IWhiteboardBackground } from "@repo/schemas";
import {
  DEFAULT_BOARD_BACKGROUND,
  normalizeWhiteboardText,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  WHITEBOARD_FONT_FAMILIES,
} from "@repo/whiteboard-render";
import { useLayoutEffect, useRef, useState } from "react";
import type { IWhiteboardElement } from "@/lib/data-types";
import {
  boundsOf,
  centerOf,
  RESIZE_CURSORS,
  selectionBounds,
} from "@/lib/whiteboard-geometry";
import type {
  ResizeHandle,
  SelectionRect,
  TextBoxState,
  TextDraft,
  ViewState,
  WhiteboardTool,
} from "@/lib/whiteboard-types";
import { templateRegistry } from "./templates";
import { WhiteboardElement } from "./whiteboard-element";

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return 1;
  const v = Number.parseInt(m[1], 16);
  return (
    (0.2126 * ((v >> 16) & 0xff) +
      0.7152 * ((v >> 8) & 0xff) +
      0.0722 * (v & 0xff)) /
    255
  );
}

function BoardBackground({
  background,
  viewState,
}: {
  background?: IWhiteboardBackground;
  viewState: ViewState;
}) {
  const color = background?.color ?? DEFAULT_BOARD_BACKGROUND;
  const pattern = background?.pattern ?? "none";
  const dark = luminance(color) < 0.45;
  const stroke = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const size = pattern === "lines" ? 32 : 24;

  return (
    <>
      <rect x={0} y={0} width="100%" height="100%" fill={color} />
      {pattern !== "none" && (
        <>
          <defs>
            <pattern
              id="board-pattern"
              width={size}
              height={size}
              patternUnits="userSpaceOnUse"
            >
              {pattern === "dots" && (
                <circle cx={1.5} cy={1.5} r={1.2} fill={stroke} />
              )}
              {pattern === "grid" && (
                <path
                  d={`M ${size} 0 L 0 0 0 ${size}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1}
                />
              )}
              {pattern === "lines" && (
                <line
                  x1={0}
                  y1={0.5}
                  x2={size}
                  y2={0.5}
                  stroke={stroke}
                  strokeWidth={1}
                />
              )}
            </pattern>
          </defs>
          <rect
            x={-viewState.x / viewState.zoom - 50000}
            y={-viewState.y / viewState.zoom - 50000}
            width={100000}
            height={100000}
            fill="url(#board-pattern)"
            transform={`translate(${viewState.x}, ${viewState.y}) scale(${viewState.zoom})`}
          />
        </>
      )}
    </>
  );
}

const HANDLES: { handle: ResizeHandle; fx: number; fy: number }[] = [
  { handle: "nw", fx: 0, fy: 0 },
  { handle: "n", fx: 0.5, fy: 0 },
  { handle: "ne", fx: 1, fy: 0 },
  { handle: "e", fx: 1, fy: 0.5 },
  { handle: "se", fx: 1, fy: 1 },
  { handle: "s", fx: 0.5, fy: 1 },
  { handle: "sw", fx: 0, fy: 1 },
  { handle: "w", fx: 0, fy: 0.5 },
];

function SelectionHandles({
  bounds,
  zoom,
  showRotate,
  onStartResize,
  onStartRotate,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  zoom: number;
  showRotate: boolean;
  onStartResize: (handle: ResizeHandle, shift: boolean) => void;
  onStartRotate: (e: React.PointerEvent) => void;
}) {
  const sw = 1.5 / zoom;
  const hs = 8 / zoom;
  const capture = (e: React.PointerEvent) => {
    const svg = (e.target as SVGElement).ownerSVGElement;
    if (svg) svg.setPointerCapture(e.pointerId);
  };
  const rotY = bounds.y - 24 / zoom;
  const rotX = bounds.x + bounds.width / 2;
  return (
    <g>
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={sw}
        strokeDasharray={`${3 / zoom}`}
      />
      {showRotate && (
        <>
          <line
            x1={rotX}
            y1={bounds.y}
            x2={rotX}
            y2={rotY}
            stroke="var(--accent)"
            strokeWidth={sw}
          />
          <circle
            cx={rotX}
            cy={rotY}
            r={hs / 1.4}
            fill="white"
            stroke="var(--accent)"
            strokeWidth={sw}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              capture(e);
              onStartRotate(e);
            }}
          />
        </>
      )}
      {HANDLES.map((h) => (
        <rect
          key={h.handle}
          x={bounds.x + bounds.width * h.fx - hs / 2}
          y={bounds.y + bounds.height * h.fy - hs / 2}
          width={hs}
          height={hs}
          fill="white"
          stroke="var(--accent)"
          strokeWidth={sw}
          style={{ cursor: RESIZE_CURSORS[h.handle] }}
          onPointerDown={(e) => {
            e.stopPropagation();
            capture(e);
            onStartResize(h.handle, e.shiftKey);
          }}
        />
      ))}
    </g>
  );
}

function measureFont(box: TextBoxState) {
  return WHITEBOARD_FONT_FAMILIES[box.fontFamily].css;
}

function TextEditor({
  box,
  viewState,
  onCommit,
  onCancel,
}: {
  box: TextBoxState;
  viewState: ViewState;
  onCommit: (text: string, width: number, height: number) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() =>
    normalizeWhiteboardText(box.initialText),
  );
  const measureRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sizeRef = useRef({ w: box.width, h: box.height });
  const [worldSize, setWorldSize] = useState({ w: box.width, h: box.height });

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const w = box.autoSize ? Math.max(40, el.offsetWidth) : box.width;
    const h = Math.max(box.height, box.fontSize * 1.4, el.offsetHeight);
    sizeRef.current = { w, h };
    setWorldSize({ w, h });
  }, [text, box.fontSize, box.width, box.height, box.autoSize]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const commit = () => onCommit(text, sizeRef.current.w, sizeRef.current.h);

  return (
    <div
      className="absolute"
      style={{
        left: box.worldX * viewState.zoom + viewState.x,
        top: box.worldY * viewState.zoom + viewState.y,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          whiteSpace: "pre-wrap",
          width: box.autoSize ? "max-content" : box.width,
          maxWidth: box.autoSize ? box.maxWidth : undefined,
          fontSize: box.fontSize,
          fontWeight: box.fontWeight,
          fontFamily: measureFont(box),
          lineHeight: TEXT_LINE_HEIGHT,
          padding: TEXT_PADDING,
          boxSizing: "border-box",
        }}
      >
        {text === "" ? " " : text}
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="bg-transparent outline outline-1 outline-primary/60 resize-none overflow-hidden"
        style={{
          width: worldSize.w * viewState.zoom,
          height: worldSize.h * viewState.zoom,
          color: box.color,
          fontSize: box.fontSize * viewState.zoom,
          fontWeight: box.fontWeight,
          fontFamily: measureFont(box),
          textAlign: box.align,
          lineHeight: TEXT_LINE_HEIGHT,
          padding: TEXT_PADDING * viewState.zoom,
          boxSizing: "border-box",
        }}
        onFocus={(e) => {
          const v = e.target.value;
          e.target.setSelectionRange(v.length, v.length);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export interface WhiteboardCanvasProps {
  elements: IWhiteboardElement[];
  background?: IWhiteboardBackground;
  viewState: ViewState;
  selectedTool: WhiteboardTool;
  selectedElementIds: Set<string>;
  selectionRect: SelectionRect | null;
  activeDrawing: IWhiteboardElement | null;
  textBox: TextBoxState | null;
  textDraft?: TextDraft | null;
  readOnly?: boolean;
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  onDoubleClick?: (e: React.MouseEvent<SVGSVGElement>) => void;
  onTextCommit?: (text: string, width: number, height: number) => void;
  onTextCancel?: () => void;
  onStartResize?: (handle: ResizeHandle, shift: boolean) => void;
  onStartRotate?: (e: React.PointerEvent) => void;
  onComponentDataChange?: (
    elementId: string,
    data: Record<string, unknown>,
  ) => void;
  onComponentDelete?: (elementId: string) => void;
}

export function WhiteboardCanvas({
  elements,
  background,
  viewState,
  selectedTool,
  selectedElementIds,
  selectionRect,
  activeDrawing,
  textBox,
  textDraft,
  readOnly,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onDoubleClick,
  onTextCommit,
  onTextCancel,
  onStartResize,
  onStartRotate,
  onComponentDataChange,
  onComponentDelete,
}: WhiteboardCanvasProps) {
  const editingId = textBox?.editingId ?? null;
  const sorted = [...elements]
    .filter((el) => el.id !== editingId)
    .sort((a, b) => a.zIndex - b.zIndex);
  const isPointerTool = selectedTool === "pointer";
  const single =
    selectedElementIds.size === 1
      ? elements.find((el) => selectedElementIds.has(el.id))
      : undefined;
  const selBounds = single
    ? boundsOf(single, false)
    : selectionBounds(elements, selectedElementIds);
  const selCenter = selBounds ? centerOf(selBounds) : null;

  return (
    <div className="relative w-full h-full">
      <svg
        className="w-full h-full touch-none"
        style={{ display: "block" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        <BoardBackground background={background} viewState={viewState} />

        <g
          transform={`translate(${viewState.x}, ${viewState.y}) scale(${viewState.zoom})`}
        >
          {sorted.map((el) => (
            <WhiteboardElement key={el.id} element={el} />
          ))}

          {activeDrawing && <WhiteboardElement element={activeDrawing} />}

          {!readOnly && selBounds && selectedElementIds.size > 0 && (
            <g
              transform={
                single?.rotation && selCenter
                  ? `rotate(${single.rotation} ${selCenter.x} ${selCenter.y})`
                  : undefined
              }
            >
              <SelectionHandles
                bounds={selBounds}
                zoom={viewState.zoom}
                showRotate={isPointerTool && selectedElementIds.size === 1}
                onStartResize={(h, shift) => onStartResize?.(h, shift)}
                onStartRotate={(e) => onStartRotate?.(e)}
              />
            </g>
          )}

          {selectionRect && (
            <rect
              x={selectionRect.x}
              y={selectionRect.y}
              width={selectionRect.width}
              height={selectionRect.height}
              fill="rgba(161, 188, 152, 0.15)"
              stroke="var(--accent)"
              strokeWidth={1 / viewState.zoom}
              strokeDasharray={`${4 / viewState.zoom}`}
            />
          )}

          {textDraft && (textDraft.width > 0 || textDraft.height > 0) && (
            <rect
              x={textDraft.x}
              y={textDraft.y}
              width={textDraft.width}
              height={textDraft.height}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1 / viewState.zoom}
              strokeDasharray={`${4 / viewState.zoom}`}
            />
          )}
        </g>
      </svg>

      {sorted
        .filter(
          (el): el is IWhiteboardElement & { componentType: string } =>
            el.type === "component" && !!el.componentType,
        )
        .map((el) => {
          const def = templateRegistry[el.componentType];
          if (!def) return null;
          const Template = def.component;
          const w = el.width ?? def.defaultSize.width;
          const h = el.height ?? def.defaultSize.height;
          const screenX = el.x * viewState.zoom + viewState.x;
          const screenY = el.y * viewState.zoom + viewState.y;
          const isSelected = selectedElementIds.has(el.id);
          return (
            <div
              key={`component-${el.id}`}
              className="absolute origin-top-left"
              style={{
                left: screenX,
                top: screenY,
                width: w * viewState.zoom,
                height: h * viewState.zoom,
                transform: el.rotation
                  ? `rotate(${el.rotation}deg)`
                  : undefined,
                transformOrigin: "center",
                pointerEvents:
                  !readOnly && isPointerTool && isSelected ? "auto" : "none",
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  width: w,
                  height: h,
                  transform: `scale(${viewState.zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <Template
                  id={el.id}
                  data={el.data}
                  onDataChange={(d) => onComponentDataChange?.(el.id, d)}
                  onDelete={() => onComponentDelete?.(el.id)}
                  width={w}
                  height={h}
                />
              </div>
            </div>
          );
        })}

      {!readOnly && textBox && onTextCommit && onTextCancel && (
        <TextEditor
          box={textBox}
          viewState={viewState}
          onCommit={onTextCommit}
          onCancel={onTextCancel}
        />
      )}
    </div>
  );
}
