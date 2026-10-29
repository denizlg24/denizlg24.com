import { cn } from "./utils";

const TONE = {
  default: "bg-accent-strong/70",
  good: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
} as const;

/** A hairline progress meter. `value` is 0–1; anything over 1 reads as full and critical. */
export function Meter({
  value,
  tone,
  className,
}: {
  value: number;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const resolved = tone ?? (value > 1 ? "critical" : "default");
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      className={cn(
        "h-1 w-full overflow-hidden rounded-full bg-border",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", TONE[resolved])}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
