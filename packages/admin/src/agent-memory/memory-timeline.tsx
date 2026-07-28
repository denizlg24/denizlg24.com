"use client";

import type { AgentMemoryGraphNode } from "@repo/schemas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardTheme } from "./memory-card";

export interface TimelineRange {
  from: number;
  to: number;
}

/** The card palette, unchanged — the ruler is drawn from the same ink. */
export type TimelineTheme = CardTheme;

const HEIGHT = 56;
const DAY = 86_400_000;
const MIN_TICK_PX = 5;
const MIN_LABEL_PX = 52;
/** Below this drag distance a pointer release counts as a click, not a pan. */
const CLICK_SLOP = 4;
/** A release is held this long before acting, so a double-click can pre-empt it. */
const DOUBLE_CLICK_MS = 250;
const ZOOM_STEP = 1.18;

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

/**
 * `limit` exists so the spacing test can be answered from two boundaries: at a
 * wide zoom the day tier is rejected outright, and materialising its ~4000
 * `Date` constructions first is pure waste on a redraw that panning fires at
 * pointer-move rate.
 */
function boundaries(
  unit: Unit,
  from: number,
  to: number,
  limit = Number.POSITIVE_INFINITY,
): number[] {
  const out: number[] = [];
  let cursor = startOf(unit, from);
  // Guard against a pathological zoom producing an unbounded loop.
  for (let i = 0; cursor <= to && i < 4000 && out.length < limit; i++) {
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

    let labelled: { unit: Unit; marks: number[] } | null = null;
    for (const tier of tiers) {
      const [firstMark, secondMark] = boundaries(tier.unit, from, to, 2);
      if (firstMark === undefined || secondMark === undefined) continue;
      const spacing = toX(secondMark) - toX(firstMark);
      if (spacing < MIN_TICK_PX) continue;
      const marks = boundaries(tier.unit, from, to);
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
      if (spacing >= MIN_LABEL_PX && !labelled) {
        labelled = { unit: tier.unit, marks };
      }
    }

    if (labelled) {
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = ink(0.55);
      context.textBaseline = "top";
      for (const ms of labelled.marks) {
        context.fillText(
          label(labelled.unit, ms),
          Math.round(toX(ms)) + 4,
          baseline + 5,
        );
      }
    }
  }, [view, width, density, range, theme]);

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

  const selectAt = useCallback(
    (ms: number) => {
      if (!view) return;
      const unit = unitAtZoom();
      const from = startOf(unit, ms);
      const to = advance(unit, from);
      onChange({ from, to });
      // Zoom the selected span to ~70% of the strip: one tier deeper, centred.
      const msPerPx = (to - from) / (width * 0.7);
      setView(clamp({ origin: from - width * 0.15 * msPerPx, msPerPx }));
    },
    [view, unitAtZoom, onChange, width, clamp],
  );

  const zoomAround = useCallback(
    (anchorMs: number, anchorX: number, factor: number) => {
      if (!view) return;
      const msPerPx = view.msPerPx * factor;
      setView(clamp({ origin: anchorMs - anchorX * msPerPx, msPerPx }));
    },
    [view, clamp],
  );

  const zoomOut = useCallback(() => {
    if (!view) return;
    setView(
      clamp({
        origin: view.origin - width * view.msPerPx * 1.5,
        msPerPx: view.msPerPx * 4,
      }),
    );
  }, [view, width, clamp]);

  // React 19's onWheel is passive, so preventDefault there is a no-op and the
  // page scrolls behind the strip while zooming. The handler lives in a ref so
  // the listener itself can be attached once instead of on every pan frame.
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelHandler.current = (event) => {
      const canvas = canvasRef.current;
      if (!canvas || !view) return;
      event.preventDefault();
      const x = event.clientX - canvas.getBoundingClientRect().left;
      zoomAround(
        view.origin + x * view.msPerPx,
        x,
        event.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
      );
    };
  }, [view, zoomAround]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = (event: WheelEvent) => wheelHandler.current(event);
    canvas.addEventListener("wheel", handle, { passive: false });
    return () => canvas.removeEventListener("wheel", handle);
  }, []);

  // A release both selects a span and zooms one tier in, so letting it fire
  // twice before onDoubleClick clears the range leaves the view nowhere near
  // where the user started. The click waits out the double-click threshold.
  const pendingClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingClick = () => {
    if (pendingClick.current === null) return;
    clearTimeout(pendingClick.current);
    pendingClick.current = null;
  };
  useEffect(() => cancelPendingClick, []);

  const centerMs = view ? view.origin + (width * view.msPerPx) / 2 : minMs;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const panStep = width * 0.1 * view.msPerPx;
    switch (event.key) {
      case "ArrowLeft":
        setView(clamp({ ...view, origin: view.origin - panStep }));
        break;
      case "ArrowRight":
        setView(clamp({ ...view, origin: view.origin + panStep }));
        break;
      case "ArrowUp":
      case "+":
        zoomAround(centerMs, width / 2, 1 / ZOOM_STEP);
        break;
      case "ArrowDown":
      case "-":
        zoomAround(centerMs, width / 2, ZOOM_STEP);
        break;
      case "Enter":
      case " ":
        selectAt(centerMs);
        break;
      case "Escape":
        onChange(null);
        zoomOut();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const spanLabel = (() => {
    if (!range) return "";
    const format = (ms: number) =>
      new Date(ms).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    const from = format(range.from);
    const until = format(range.to - 1);
    return from === until ? from : `${from} → ${until}`;
  })();

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ height: HEIGHT }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: HEIGHT }}
        className="cursor-crosshair touch-none outline-none focus-visible:ring-1 focus-visible:ring-ring"
        tabIndex={0}
        role="slider"
        aria-label="Memory timeline range"
        aria-valuemin={minMs}
        aria-valuemax={view ? view.origin + width * view.msPerPx : minMs}
        aria-valuenow={centerMs}
        aria-valuetext={spanLabel || "No range selected"}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          if (!view) return;
          cancelPendingClick();
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
          if (!start || start.moved >= CLICK_SLOP) return;
          const canvas = canvasRef.current;
          if (!canvas || !view) return;
          const x = event.clientX - canvas.getBoundingClientRect().left;
          const ms = view.origin + x * view.msPerPx;
          cancelPendingClick();
          pendingClick.current = setTimeout(() => {
            pendingClick.current = null;
            selectAt(ms);
          }, DOUBLE_CLICK_MS);
        }}
        onPointerCancel={(event) => {
          // Without this a cancelled gesture leaves the pan armed, and the next
          // move over the strip resumes from a stale origin with no button held.
          pointer.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onDoubleClick={() => {
          cancelPendingClick();
          onChange(null);
          zoomOut();
        }}
      />
      {range && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Clear range ${spanLabel}`}
          className="absolute top-1 right-2 font-mono text-[10px] text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden="true">{spanLabel} ✕</span>
        </button>
      )}
    </div>
  );
}
