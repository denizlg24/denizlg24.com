"use client";

import {
  ARROW_HEAD_LENGTH_RATIO,
  ARROW_HEAD_MAX_LENGTH,
  DEFAULT_FONT_FAMILY,
  HIGHLIGHTER_OPACITY,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  WHITEBOARD_FONT_FAMILIES,
} from "@repo/whiteboard-render";
import type { IWhiteboardElement } from "@/lib/data-types";
import { boundsOf, centerOf } from "@/lib/whiteboard-geometry";
import type {
  DrawingData,
  ImageData,
  ShapeData,
  TextData,
} from "@/lib/whiteboard-types";

export function penPathD(points: { x: number; y: number }[]): string {
  const first = points[0];
  if (!first) return "";
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    d += ` Q ${prev.x} ${prev.y} ${(prev.x + curr.x) / 2} ${(prev.y + curr.y) / 2}`;
  }
  const last = points[points.length - 1];
  if (last) d += ` L ${last.x} ${last.y}`;
  return d;
}

function PenElement({ element }: { element: IWhiteboardElement }) {
  const d = element.data as unknown as DrawingData;
  if (!d.points || d.points.length < 2) return null;
  return (
    <g transform={`translate(${element.x}, ${element.y})`}>
      <path
        d={penPathD(d.points)}
        fill="none"
        stroke={d.color}
        strokeWidth={d.thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={d.brush === "highlighter" ? HIGHLIGHTER_OPACITY : 1}
      />
    </g>
  );
}

function ShapeElement({ element }: { element: IWhiteboardElement }) {
  const d = element.data as unknown as ShapeData;
  const w = element.width ?? 0;
  const h = element.height ?? 0;
  const fill = d.fill && d.fill !== "none" ? d.fill : "none";

  if (d.shapeType === "arrow" || d.shapeType === "line") {
    const x2 = d.x2 ?? 0;
    const y2 = d.y2 ?? 0;
    let head: React.ReactNode = null;
    if (d.shapeType === "arrow") {
      const angle = Math.atan2(y2, x2);
      const headLen = Math.min(
        ARROW_HEAD_MAX_LENGTH,
        Math.sqrt(x2 * x2 + y2 * y2) * ARROW_HEAD_LENGTH_RATIO,
      );
      const a1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const a1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const a2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const a2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
      head = (
        <polygon
          points={`${x2},${y2} ${a1x},${a1y} ${a2x},${a2y}`}
          fill={d.color}
        />
      );
    }
    return (
      <g transform={`translate(${element.x}, ${element.y})`}>
        <line
          x1={0}
          y1={0}
          x2={x2}
          y2={y2}
          stroke={d.color}
          strokeWidth={d.thickness}
          strokeLinecap="round"
        />
        {head}
      </g>
    );
  }

  if (d.shapeType === "circle") {
    return (
      <ellipse
        cx={element.x + w / 2}
        cy={element.y + h / 2}
        rx={w / 2}
        ry={h / 2}
        fill={fill}
        stroke={d.color}
        strokeWidth={d.thickness}
      />
    );
  }

  return (
    <rect
      x={element.x}
      y={element.y}
      width={w}
      height={h}
      fill={fill}
      stroke={d.color}
      strokeWidth={d.thickness}
      rx={d.shapeType === "square" ? 0 : 2}
    />
  );
}

function TextElement({ element }: { element: IWhiteboardElement }) {
  const d = element.data as unknown as TextData;
  const w = element.width ?? 100;
  const h = element.height ?? 40;
  const family = WHITEBOARD_FONT_FAMILIES[d.fontFamily ?? DEFAULT_FONT_FAMILY];
  return (
    <foreignObject
      x={element.x}
      y={element.y}
      width={w}
      height={h}
      style={{ overflow: "visible" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          color: d.color,
          fontSize: `${d.fontSize}px`,
          fontWeight: d.fontWeight ?? 400,
          fontFamily: family.css,
          textAlign: d.align ?? "left",
          lineHeight: TEXT_LINE_HEIGHT,
          wordWrap: "break-word",
          overflowWrap: "break-word",
          whiteSpace: "pre-wrap",
          userSelect: "none",
          pointerEvents: "none",
          padding: `${TEXT_PADDING}px`,
        }}
      >
        {d.text}
      </div>
    </foreignObject>
  );
}

function ImageElement({ element }: { element: IWhiteboardElement }) {
  const d = element.data as unknown as ImageData;
  return (
    <image
      href={d.src}
      x={element.x}
      y={element.y}
      width={element.width ?? 200}
      height={element.height ?? 200}
      preserveAspectRatio="none"
    />
  );
}

function ComponentElement({ element }: { element: IWhiteboardElement }) {
  return (
    <rect
      x={element.x}
      y={element.y}
      width={element.width ?? 100}
      height={element.height ?? 60}
      fill="transparent"
      stroke="none"
    />
  );
}

function inner(element: IWhiteboardElement): React.ReactNode {
  const data = element.data as Record<string, unknown>;
  if (element.type === "component")
    return <ComponentElement element={element} />;
  if (data.points) return <PenElement element={element} />;
  if (data.shapeType) return <ShapeElement element={element} />;
  if (data.text !== undefined) return <TextElement element={element} />;
  if (data.src) return <ImageElement element={element} />;
  return null;
}

export function WhiteboardElement({
  element,
}: {
  element: IWhiteboardElement;
}) {
  const body = inner(element);
  if (!body) return null;
  if (!element.rotation) return <>{body}</>;
  const c = centerOf(boundsOf(element, false));
  return <g transform={`rotate(${element.rotation} ${c.x} ${c.y})`}>{body}</g>;
}
