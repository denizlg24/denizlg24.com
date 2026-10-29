"use client";

import { cn } from "@repo/ui/utils";

interface CountdownRingProps {
  remaining: number;
  period: number;
  size?: number;
}

export function CountdownRing({
  remaining,
  period,
  size = 32,
}: CountdownRingProps) {
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = remaining / period;
  const offset = circumference * (1 - progress);

  const isUrgent = remaining <= 5;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn(
            "transition-[stroke-dashoffset] duration-1000 ease-linear",
            isUrgent ? "text-status-critical" : "text-accent-strong/70",
          )}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-mono text-[10px] tabular-nums",
          isUrgent ? "text-status-critical" : "text-muted-foreground",
        )}
      >
        {remaining}
      </span>
    </div>
  );
}
