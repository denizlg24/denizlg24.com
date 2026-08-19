"use client";

import * as React from "react";

import { cn } from "./utils";

const ACTION_WIDTH = 88;

export function SwipeRow({
  children,
  action,
  onAction,
  actionLabel = "Delete",
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  onAction: () => void;
  actionLabel?: string;
  className?: string;
}) {
  const startX = React.useRef<number | null>(null);
  const [offset, setOffset] = React.useState(0);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <button
        type="button"
        aria-label={actionLabel}
        className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center bg-destructive text-white"
        onClick={onAction}
      >
        {action ?? actionLabel}
      </button>
      <div
        className="relative bg-background transition-transform motion-reduce:transition-none"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(event) => {
          startX.current = event.clientX;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (startX.current === null) return;
          const delta = event.clientX - startX.current;
          setOffset(Math.max(-ACTION_WIDTH, Math.min(0, delta)));
        }}
        onPointerUp={(event) => {
          startX.current = null;
          setOffset(offset < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          startX.current = null;
          setOffset(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}
