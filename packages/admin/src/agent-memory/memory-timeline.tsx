"use client";

import type { AgentMemoryGraphNode } from "@repo/schemas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface TimelineRange {
  from: number;
  to: number;
}

export interface TimelineTheme {
  background: string;
  foreground: string;
  mutedForeground: string;
  scheme: "dark" | "light";
}

const HEIGHT = 56;
const DAY = 86_400_000;
const MIN_TICK_PX = 5;
const MIN_LABEL_PX = 52;
/** Below this drag distance a pointer release counts as a click, not a pan. */
const CLICK_SLOP = 4;

type Unit = "year" | "month" | "day";

function startOf(unit: Unit, ms: number): number {
  const date = new Date(ms);
  if (unit === "year") return new Date(date.getFullYear(), 0, 1).getTime();
  if (unit === "month")
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function advance(unit: Unit, ms: number, steps = 1): number {
  const date = new Date(ms);
  if (unit === "year") date.setFullYear(date.getFullYear() + steps);
  else if (unit === "month") date.setMonth(date.getMonth() + steps);
  else date.setDate(date.getDate() + steps);
  return date.getTime();
}

function boundaries(unit: Unit, from: number, to: number): number[] {
  const out: number[] = [];
  let cursor = startOf(unit, from);
  // Guard against a pathological zoom producing an unbounded loop.
  for (let i = 0; cursor <= to && i < 4000; i++) {
    if (cursor >= from) out.push(cursor);
    cursor = advance(unit, cursor);
  }
  return out;
}

function label(unit: Unit, ms: number): string {
  const date = new Date(ms);
  if (unit === "year") return String(date.getFullYear());
  if (unit === "month")
    return date.toLocaleDateString(undefined, { month: "short" });
  return String(date.getDate());
}

/**
 * A ruler, not a chart: three tiers of vertical bars — years strongest, then
 * months, then days — with labels only where they fit. Panning is unbounded
 * into the future; the past stops a year before the first memory. Clicking a
 * tick selects that span and zooms one tier into it.
 */
export function MemoryTimeline({
  nodes,
  range,
  onChange,
  theme,
}: {
  nodes: AgentMemoryGraphNode[];
  range: TimelineRange | null;
  onChange: (range: TimelineRange | null) => void;
  theme: TimelineTheme;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const stamps = useMemo(() => {
    const values: number[] = [];
    for (const node of nodes) {
      if (node.kind !== "memory" || !node.occurredAt) continue;
      const ms = new Date(node.occurredAt).getTime();
      if (!Number.isNaN(ms)) values.push(ms);
    }
    return values.sort((a, b) => a - b);
  }, [nodes]);

  const firstMs = stamps[0] ?? Date.now() - 365 * DAY;
  const minMs = startOf("year", firstMs) - 365 * DAY;

  // Leftmost visible instant plus scale. Initialised to span first memory → now.
  const [view, setView] = useState<{ origin: number; msPerPx: number } | null>(
    null,
  );

  useEffect(() => {
    if (view || width === 0 || stamps.length === 0) return;
    const last = Math.max(stamps[stamps.length - 1] ?? Date.now(), Date.now());
    const span = Math.max(last - firstMs, 30 * DAY) * 1.15;
    setView({ origin: firstMs - span * 0.05, msPerPx: span / width });
  }, [view, width, stamps, firstMs]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const clamp = useCallback(
    (next: { origin: number; msPerPx: number }) => {
      const maxMsPerPx = (60 * 365 * DAY) / Math.max(width, 1);
      const minMsPerPx = (2 * DAY) / Math.max(width, 1);
      const msPerPx = Math.min(maxMsPerPx, Math.max(minMsPerPx, next.msPerPx));
      return { origin: Math.max(minMs, next.origin), msPerPx };
    },
    [width, minMs],
  );

  // Density per pixel column, so the ruler shows where memories actually sit.
  const density = useMemo(() => {
    if (!view || width === 0) return null;
    const counts = new Uint16Array(width);
    for (const ms of stamps) {
      const x = Math.floor((ms - view.origin) / view.msPerPx);
      if (x >= 0 && x < width) counts[x] = Math.min(counts[x] + 1, 65_535);
    }
    return counts;
  }, [stamps, view, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, HEIGHT);

    const toX = (ms: number) => (ms - view.origin) / view.msPerPx;
    const from = view.origin;
    const to = view.origin + width * view.msPerPx;
    const isDark = theme.scheme === "dark";
    const ink = (alpha: number) =>
      isDark
        ? `rgba(255, 255, 255, ${alpha})`
        : `rgba(20, 20, 22, ${alpha + 0.1})`;

    if (range) {
      const x0 = toX(range.from);
      const x1 = toX(range.to);
      context.fillStyle = ink(0.09);
      context.fillRect(x0, 0, Math.max(x1 - x0, 2), HEIGHT);
      context.fillStyle = ink(0.45);
      context.fillRect(x0, 0, 1, HEIGHT);
      context.fillRect(x1 - 1, 0, 1, HEIGHT);
    }

    if (density) {
      context.fillStyle = ink(0.5);
      for (let x = 0; x < width; x++) {
        const count = density[x] ?? 0;
        if (count === 0) continue;
        const height = Math.min(10, 2 + Math.log2(count + 1) * 2.5);
        context.globalAlpha = Math.min(1, 0.35 + count * 0.08);
        context.fillRect(x, HEIGHT - 20 - height, 1, height);
      }
      context.globalAlpha = 1;
    }

    const baseline = HEIGHT - 20;
    context.fillStyle = ink(0.1);
    context.fillRect(0, baseline, width, 1);

    const tiers: { unit: Unit; height: number; alpha: number }[] = [
      { unit: "day", height: 4, alpha: 0.18 },
      { unit: "month", height: 8, alpha: 0.34 },
      { unit: "year", height: 14, alpha: 0.75 },
    ];

    let labelled: Unit | null = null;
    for (const tier of tiers) {
      const marks = boundaries(tier.unit, from, to);
      if (marks.length < 2) continue;
      const spacing = (toX(marks[1] ?? 0) - toX(marks[0] ?? 0)) as number;
      if (spacing < MIN_TICK_PX) continue;
      context.fillStyle = ink(tier.alpha);
      for (const ms of marks) {
        context.fillRect(
          Math.round(toX(ms)),
          baseline - tier.height,
          1,
          tier.height,
        );
      }
      // The finest tier with room for text owns the labels.
      if (spacing >= MIN_LABEL_PX && !labelled) labelled = tier.unit;
    }

    if (labelled) {
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = ink(0.55);
      context.textBaseline = "top";
      for (const ms of boundaries(labelled, from, to)) {
        context.fillText(
          label(labelled, ms),
          Math.round(toX(ms)) + 4,
          baseline + 5,
        );
      }
    }
  }, [view, width, density, range, theme, stamps]);

  const pointer = useRef<{ x: number; origin: number; moved: number } | null>(
    null,
  );

  const unitAtZoom = useCallback((): Unit => {
    if (!view || width === 0) return "year";
    const span = width * view.msPerPx;
    if (span > 900 * DAY) return "year";
    if (span > 70 * DAY) return "month";
    return "day";
  }, [view, width]);

  const handleClick = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    const x = clientX - canvas.getBoundingClientRect().left;
    const ms = view.origin + x * view.msPerPx;
    const unit = unitAtZoom();
    const from = startOf(unit, ms);
    const to = advance(unit, from);
    onChange({ from, to });
    // Zoom the selected span to ~70% of the strip: one tier deeper, centred.
    const msPerPx = (to - from) / (width * 0.7);
    setView(clamp({ origin: from - width * 0.15 * msPerPx, msPerPx }));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ height: HEIGHT }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: HEIGHT }}
        className="cursor-crosshair touch-none"
        onPointerDown={(event) => {
          if (!view) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.current = {
            x: event.clientX,
            origin: view.origin,
            moved: 0,
          };
        }}
        onPointerMove={(event) => {
          const start = pointer.current;
          if (!start || !view) return;
          const dx = event.clientX - start.x;
          start.moved = Math.max(start.moved, Math.abs(dx));
          setView(
            clamp({
              origin: start.origin - dx * view.msPerPx,
              msPerPx: view.msPerPx,
            }),
          );
        }}
        onPointerUp={(event) => {
          const start = pointer.current;
          pointer.current = null;
          if (start && start.moved < CLICK_SLOP) handleClick(event.clientX);
        }}
        onWheel={(event) => {
          if (!view) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const x = event.clientX - canvas.getBoundingClientRect().left;
          const anchor = view.origin + x * view.msPerPx;
          const msPerPx = view.msPerPx * (event.deltaY > 0 ? 1.18 : 1 / 1.18);
          const next = clamp({ origin: anchor - x * msPerPx, msPerPx });
          // Re-anchor after clamping so the cursor stays over the same instant.
          setView(next);
        }}
        onDoubleClick={() => {
          if (!view) return;
          onChange(null);
          setView(
            clamp({
              origin: view.origin - width * view.msPerPx * 1.5,
              msPerPx: view.msPerPx * 4,
            }),
          );
        }}
      />
      {range && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute top-1 right-2 font-mono text-[10px] text-muted-foreground hover:text-foreground"
        >
          {new Date(range.from).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}{" "}
          ✕
        </button>
      )}
    </div>
  );
}
