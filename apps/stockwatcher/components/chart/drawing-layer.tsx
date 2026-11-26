"use client";

import {
  useEffect,
  useId,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  usePlotArea,
  useXAxisInverseDataSnapScale,
  useXAxisScale,
  useYAxisInverseScale,
  useYAxisScale,
} from "recharts";
import type { Drawing, DrawingKind } from "@/lib/models";
import { fibLevels, nearestIndex, toolPoints } from "@/lib/chart-studio";
import { amount, percent } from "@/lib/utils";

export type Tool = "cursor" | "measure" | "erase" | "alert" | DrawingKind;
type Anchor = { t: number; p: number };
type Pixel = { x: number; y: number };

export function DrawingLayer({
  times,
  drawings,
  tool,
  color,
  symbol,
  onAdd,
  onRemove,
  onAlert,
  onNote,
  locatorRef,
}: {
  times: number[];
  drawings: Drawing[];
  tool: Tool;
  color: string;
  symbol: string;
  onAdd: (drawing: Drawing) => void;
  onRemove: (id: string) => void;
  onAlert?: (price: number) => void;
  onNote?: (points: { t: number; p: number }[]) => void;
  /** Receives a function mapping a viewport y coordinate to a price. */
  locatorRef?: RefObject<((clientY: number) => number | null) | null>;
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale("price");
  const xInverse = useXAxisInverseDataSnapScale();
  const yInverse = useYAxisInverseScale("price");
  const plot = usePlotArea();
  const clip = `drawing-clip-${useId().replaceAll(":", "")}`;
  const [pending, setPending] = useState<Anchor[]>([]);
  const [cursor, setCursor] = useState<Anchor | null>(null);
  useEffect(() => {
    if (!locatorRef) return;
    locatorRef.current = (clientY) => {
      if (!yInverse || !plot) return null;
      const node = document.getElementById(clip);
      const svg = node instanceof SVGElement ? node.ownerSVGElement : null;
      if (!svg) return null;
      const y = clientY - svg.getBoundingClientRect().top;
      if (y < plot.y || y > plot.y + plot.height) return null;
      const price = Number(yInverse(y));
      return Number.isFinite(price) && price > 0 ? price : null;
    };
    return () => {
      locatorRef.current = null;
    };
  });

  if (!xScale || !yScale || !plot || times.length < 2) return null;
  const first = times[0];
  const last = times.at(-1)!;
  const firstX = xScale(first, { position: "middle" }) ?? plot.x;
  const lastX = xScale(last, { position: "middle" }) ?? plot.x + plot.width;
  const stepTime = (last - first) / (times.length - 1);
  const stepX = (lastX - firstX) / (times.length - 1);

  const toX = (t: number) => {
    if (t > last) return lastX + ((t - last) / stepTime) * stepX;
    if (t < first) return firstX - ((first - t) / stepTime) * stepX;
    return xScale(times[nearestIndex(times, t)], { position: "middle" }) ?? 0;
  };
  const toY = (p: number) => yScale(p) ?? 0;
  const px = (anchor: Anchor): Pixel => ({ x: toX(anchor.t), y: toY(anchor.p) });
  const right = plot.x + plot.width;
  const bottom = plot.y + plot.height;

  function locate(event: ReactPointerEvent<SVGRectElement>): Anchor | null {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg || !xInverse || !yInverse) return null;
    const box = svg.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const snapped = Number(xInverse(x));
    let t = Number.isFinite(snapped) ? snapped : last;
    if (x > lastX + stepX / 2) t = last + Math.round((x - lastX) / stepX) * stepTime;
    const p = Number(yInverse(y));
    return Number.isFinite(p) ? { t: Math.round(t), p } : null;
  }

  function click(event: ReactPointerEvent<SVGRectElement>) {
    if (tool === "cursor" || tool === "erase") return;
    const anchor = locate(event);
    if (!anchor) return;
    if (tool === "alert") {
      onAlert?.(anchor.p);
      return;
    }
    const points = [...pending, anchor];
    const needed = tool === "measure" ? 2 : toolPoints[tool];
    if (points.length < needed) {
      setPending(points);
      return;
    }
    setPending([]);
    if (tool === "measure") return;
    if (tool === "text") {
      onNote?.(points);
      return;
    }
    onAdd({ id: crypto.randomUUID(), symbol, kind: tool, points, color });
  }

  const preview: Drawing | null =
    pending.length &&
    cursor &&
    tool !== "cursor" &&
    tool !== "erase" &&
    tool !== "measure" &&
    tool !== "alert"
      ? {
          id: "preview",
          symbol,
          kind: tool,
          points: [...pending, cursor].slice(0, 3),
          color,
        }
      : null;

  function shape(drawing: Drawing, ghost = false) {
    const [a, b, c] = drawing.points.map(px);
    const stroke = drawing.color;
    const common = {
      stroke,
      strokeWidth: 1.4,
      fill: "none",
      strokeDasharray: ghost ? "4 3" : undefined,
    };
    switch (drawing.kind) {
      case "hline":
        return (
          <g>
            <line x1={plot!.x} x2={right} y1={a.y} y2={a.y} {...common} />
            <text x={right - 4} y={a.y - 4} className="drawing-label" fill={stroke} textAnchor="end">
              {amount(drawing.points[0].p)}
            </text>
          </g>
        );
      case "vline":
        return <line x1={a.x} x2={a.x} y1={plot!.y} y2={bottom} {...common} />;
      case "text":
        return (
          <text x={a.x} y={a.y} className="drawing-text" fill={stroke}>
            {drawing.text ?? "Note"}
          </text>
        );
      case "trend":
      case "ray": {
        if (!b) return <circle cx={a.x} cy={a.y} r={3} fill={stroke} />;
        let end = b;
        if (drawing.kind === "ray" && b.x !== a.x) {
          const slope = (b.y - a.y) / (b.x - a.x);
          const x = b.x > a.x ? right : plot!.x;
          end = { x, y: a.y + slope * (x - a.x) };
        }
        const change = (drawing.points[1].p / drawing.points[0].p - 1) * 100;
        return (
          <g>
            <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} {...common} />
            {ghost ? (
              <text x={b.x + 6} y={b.y - 6} className="drawing-label" fill={stroke}>
                {percent(change)}
              </text>
            ) : null}
          </g>
        );
      }
      case "rect": {
        if (!b) return null;
        return (
          <rect
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
            width={Math.abs(b.x - a.x)}
            height={Math.abs(b.y - a.y)}
            {...common}
            fill={stroke}
            fillOpacity={0.08}
          />
        );
      }
      case "fib": {
        if (!b) return null;
        const [p0, p1] = drawing.points.map((point) => point.p);
        const x0 = Math.min(a.x, b.x);
        return (
          <g>
            {fibLevels.map((level) => {
              const price = p1 - (p1 - p0) * level;
              const y = toY(price);
              return (
                <g key={level}>
                  <line
                    x1={x0}
                    x2={right}
                    y1={y}
                    y2={y}
                    {...common}
                    strokeWidth={level === 0.5 || level === 0.618 ? 1.3 : 0.9}
                    strokeOpacity={0.85}
                  />
                  <text x={x0 + 4} y={y - 3} className="drawing-label" fill={stroke}>
                    {(level * 100).toFixed(1)}% · {amount(price)}
                  </text>
                </g>
              );
            })}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} strokeDasharray="2 3" />
          </g>
        );
      }
      case "channel": {
        if (!b) return null;
        const offset = c ? c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x || 1)) : 0;
        return (
          <g>
            <path
              d={`M${a.x},${a.y} L${b.x},${b.y} L${b.x},${b.y + offset} L${a.x},${a.y + offset} Z`}
              fill={stroke}
              fillOpacity={0.07}
              stroke="none"
            />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
            <line x1={a.x} y1={a.y + offset} x2={b.x} y2={b.y + offset} {...common} />
            <line
              x1={a.x}
              y1={a.y + offset / 2}
              x2={b.x}
              y2={b.y + offset / 2}
              {...common}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
          </g>
        );
      }
    }
  }

  const measuring = tool === "measure" && pending.length === 1 && cursor;
  const startIndex = measuring ? nearestIndex(times, pending[0].t) : 0;
  const endIndex = measuring ? nearestIndex(times, cursor.t) : 0;

  return (
    <g className="drawing-layer" data-tool={tool}>

      <defs>
        <clipPath id={clip}>
          <rect x={plot.x} y={plot.y} width={plot.width} height={plot.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {drawings.map((drawing) => (
          <g
            key={drawing.id}
            className="drawing"
            data-erasable={tool === "erase" || undefined}
            onClick={() => tool === "erase" && onRemove(drawing.id)}
          >
            {shape(drawing)}
          </g>
        ))}
        {preview ? <g className="drawing drawing-preview">{shape(preview, true)}</g> : null}
        {tool === "alert" && cursor ? (
          <g className="drawing-alert-preview">
            <line x1={plot.x} x2={right} y1={toY(cursor.p)} y2={toY(cursor.p)} stroke="var(--term-key)" strokeDasharray="6 3" />
            <text x={right - 4} y={toY(cursor.p) - 4} className="drawing-label" fill="var(--term-key)" textAnchor="end">
              Alert at {amount(cursor.p)}
            </text>
          </g>
        ) : null}
        {measuring ? (
          <MeasureBox
            a={px(pending[0])}
            b={px(cursor)}
            from={pending[0].p}
            to={cursor.p}
            bars={endIndex - startIndex}
          />
        ) : null}
      </g>
      {tool !== "cursor" && tool !== "erase" ? (
        <rect
          className="drawing-capture"
          x={plot.x}
          y={plot.y}
          width={plot.width}
          height={plot.height}
          fill="transparent"
          onPointerMove={(event) => setCursor(locate(event))}
          onPointerLeave={() => setCursor(null)}
          onClick={click}
          onContextMenu={(event) => {
            event.preventDefault();
            setPending([]);
          }}
        />
      ) : null}
    </g>
  );
}

function MeasureBox({
  a,
  b,
  from,
  to,
  bars,
}: {
  a: Pixel;
  b: Pixel;
  from: number;
  to: number;
  bars: number;
}) {
  const change = to - from;
  const pct = from ? (to / from - 1) * 100 : null;
  const tone = change >= 0 ? "var(--gain)" : "var(--loss)";
  return (
    <g className="drawing-measure">
      <rect
        x={Math.min(a.x, b.x)}
        y={Math.min(a.y, b.y)}
        width={Math.abs(b.x - a.x)}
        height={Math.abs(b.y - a.y)}
        fill={tone}
        fillOpacity={0.12}
        stroke={tone}
        strokeDasharray="3 3"
      />
      <text x={b.x + 8} y={b.y} className="drawing-label" fill={tone}>
        {amount(change)} ({percent(pct)}) · {Math.abs(bars)} bars
      </text>
    </g>
  );
}
