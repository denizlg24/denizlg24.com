"use client";

import type { IWhiteboardElement } from "@/lib/data-types";
import type { DrawingData, ShapeData, TextData } from "@/lib/whiteboard-types";

function getElementBounds(el: IWhiteboardElement): {
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
      return {
        x: el.x + minX,
        y: el.y + minY,
        w: maxX - minX,
        h: maxY - minY,
      };
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

function computeContentBounds(elements: IWhiteboardElement[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  if (elements.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const el of elements) {
    const b = getElementBounds(el);
    if (b.w === 0 && b.h === 0) continue;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  if (minX === Number.POSITIVE_INFINITY) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function PenPreview({ element }: { element: IWhiteboardElement }) {
  const d = element.data as unknown as DrawingData;
  if (!d.points || d.points.length < 2) return null;

  let pathD = `M ${d.points[0].x} ${d.points[0].y}`;
  for (let i = 1; i < d.points.length; i++) {
    const prev = d.points[i - 1];
    const curr = d.points[i];
    const mx = (prev.x + curr.x) / 2;
    const my = (prev.y + curr.y) / 2;
    pathD += ` Q ${prev.x} ${prev.y} ${mx} ${my}`;
  }
  const last = d.points[d.points.length - 1];
  pathD += ` L ${last.x} ${last.y}`;

  return (
    <g transform={`translate(${element.x}, ${element.y})`}>
      <path
        d={pathD}
        fill="none"
        stroke={d.color}
        strokeWidth={d.thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

function ShapePreview({ element }: { element: IWhiteboardElement }) {
  const d = element.data as unknown as ShapeData;
  const w = element.width ?? 0;
  const h = element.height ?? 0;

  if (d.shapeType === "arrow") {
    const x2 = d.x2 ?? 0;
    const y2 = d.y2 ?? 0;
    const angle = Math.atan2(y2, x2);
    const headLen = Math.min(16, Math.sqrt(x2 * x2 + y2 * y2) * 0.3);
    const a1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
    const a1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
    const a2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
    const a2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
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
        <polygon
          points={`${x2},${y2} ${a1x},${a1y} ${a2x},${a2y}`}
          fill={d.color}
        />
      </g>
    );
  }

  if (d.shapeType === "circle") {
    const rx = w / 2;
    const ry = h / 2;
    return (
      <ellipse
        cx={element.x + rx}
        cy={element.y + ry}
        rx={rx}
        ry={ry}
        fill="none"
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
      fill="none"
      stroke={d.color}
      strokeWidth={d.thickness}
      rx={d.shapeType === "square" ? 0 : 2}
    />
  );
}

function TextPreview({ element }: { element: IWhiteboardElement }) {
  const d = element.data as unknown as TextData;
  const fontSize = d.fontSize ?? 16;

  return (
    <text
      x={element.x + 2}
      y={element.y + fontSize}
      fill={d.color}
      fontSize={fontSize}
      fontFamily="inherit"
      style={{ userSelect: "none" }}
    >
      {d.text}
    </text>
  );
}

function PreviewElement({ element }: { element: IWhiteboardElement }) {
  const data = element.data as Record<string, unknown>;
  if (element.type === "component") return null;
  if (data.points) return <PenPreview element={element} />;
  if (data.shapeType) return <ShapePreview element={element} />;
  if (data.text !== undefined) return <TextPreview element={element} />;
  return null;
}

interface WhiteboardPreviewProps {
  elements: IWhiteboardElement[] | null;
  className?: string;
}

export function WhiteboardPreview({
  elements,
  className,
}: WhiteboardPreviewProps) {
  if (elements === null) {
    return (
      <div
        className={`flex items-center justify-center bg-muted/30 animate-pulse ${className ?? ""}`}
      >
        <div className="flex flex-col items-center gap-1.5 opacity-40">
          <div className="w-12 h-1.5 bg-muted rounded-full" />
          <div className="w-8 h-1.5 bg-muted rounded-full" />
          <div className="w-10 h-1.5 bg-muted rounded-full" />
        </div>
      </div>
    );
  }

  const bounds = computeContentBounds(elements);

  if (!bounds || elements.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-muted/30 ${className ?? ""}`}
      >
        <span className="text-[10px] text-muted-foreground/60">
          Empty board
        </span>
      </div>
    );
  }

  const pad = Math.max(bounds.w, bounds.h) * 0.08;
  const vx = bounds.x - pad;
  const vy = bounds.y - pad;
  const vw = bounds.w + pad * 2;
  const vh = bounds.h + pad * 2;

  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className={`overflow-hidden ${className ?? ""}`}>
      <svg
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full"
        style={{ display: "block" }}
      >
        {sorted.map((el) => (
          <PreviewElement key={el.id} element={el} />
        ))}
      </svg>
    </div>
  );
}
