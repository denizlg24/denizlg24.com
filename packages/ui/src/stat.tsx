import type { ReactNode } from "react";
import { cn } from "./utils";

const TONE = {
  default: "text-accent-strong",
  muted: "text-muted-foreground",
  good: "text-status-good",
  warning: "text-status-warning",
  critical: "text-status-critical",
} as const;

export type StatTone = keyof typeof TONE;

/** A bare figure: tiny uppercase label over a large tabular number. No box. */
export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-calistoga text-2xl leading-none tabular-nums",
          TONE[tone],
        )}
      >
        {value}
      </span>
      {hint ? (
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

/** A row of stats that wraps; columns share the width evenly from `sm` up. */
export function StatGroup({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
