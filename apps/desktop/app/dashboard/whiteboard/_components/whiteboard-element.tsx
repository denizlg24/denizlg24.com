"use client";

import type { IWhiteboardElement } from "@/lib/data-types";
import type {
  DrawingData,
  ImageData,
  ShapeData,
  TextData,
} from "@/lib/whiteboard-types";

function PenElement({ element }: { element: IWhiteboardElement }) {
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

function ShapeElement({ element }: { element: IWhiteboardElement }) {
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

function TextElement({ element }: { element: IWhiteboardElement }) {
  const d = element.data as unknown as TextData;
  const w = element.width ?? 100;
  const h = element.height ?? 40;

  return (
    <foreignObject
      x={element.x}
      y={element.y}
      width={w}
      height={h}
      style={{ overflow: "hidden" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          color: d.color,
          fontSize: `${d.fontSize ?? 16}px`,
          lineHeight: 1.3,
          fontFamily: "inherit",
          wordWrap: "break-word",
          overflowWrap: "break-word",
          overflow: "hidden",
          whiteSpace: "pre-wrap",
          userSelect: "none",
          pointerEvents: "none",
          padding: "2px",
        }}
      >
        {d.text}
      </div>
    </foreignObject>
  );
}

function ImageElement({ element }: { element: IWhiteboardElement }) {
  const d = element.data as unknown as ImageData;
  const w = element.width ?? 200;
  const h = element.height ?? 200;

  return (
    <image
      href={d.src}
      x={element.x}
      y={element.y}
      width={w}
      height={h}
      preserveAspectRatio="none"
    />
  );
}

function ComponentElement({ element }: { element: IWhiteboardElement }) {
  const w = element.width ?? 100;
  const h = element.height ?? 60;
  return (
    <rect
      x={element.x}
      y={element.y}
      width={w}
      height={h}
      fill="transparent"
      stroke="none"
    />
  );
}

export function WhiteboardElement({
  element,
}: {
  element: IWhiteboardElement;
}) {
  const data = element.data as Record<string, unknown>;

  if (element.type === "component") {
    return <ComponentElement element={element} />;
  }

  if (data.points) {
    return <PenElement element={element} />;
  }
  if (data.shapeType) {
    return <ShapeElement element={element} />;
  }
  if (data.text !== undefined) {
    return <TextElement element={element} />;
  }
  if (data.src) {
    return <ImageElement element={element} />;
  }

  return null;
}
