"use client";

import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

const step = 16;
const bigStep = 64;

export function DockResizer({
  width,
  min,
  max,
  onResize,
  onReset,
}: {
  width: number | null;
  min: number;
  max: number;
  onResize: (width: number, persist: boolean) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || width === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width };
    setDragging(true);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const origin = drag.current;
    if (!origin) return;
    onResize(origin.width + origin.x - event.clientX, false);
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    const origin = drag.current;
    if (!origin) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onResize(origin.width + origin.x - event.clientX, true);
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (width === null) return;
    const delta = event.shiftKey ? bigStep : step;
    const next =
      event.key === "ArrowLeft"
        ? width + delta
        : event.key === "ArrowRight"
          ? width - delta
          : event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : null;
    if (next === null) return;
    event.preventDefault();
    onResize(next, true);
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-controls="assistant-dock"
      aria-label="Resize assistant"
      aria-valuenow={width ?? undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      title="Drag to resize · double-click to reset"
      className="dock-resizer"
      data-dragging={dragging || undefined}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
