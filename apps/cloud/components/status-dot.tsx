import { cn } from "@repo/ui/utils";

export type StatusTone = "good" | "warning" | "serious" | "critical" | "muted";

const TONE_CLASS: Record<StatusTone, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  serious: "bg-status-serious",
  critical: "bg-status-critical",
  muted: "bg-muted-foreground/50",
};

export function StatusDot({
  tone,
  className,
}: {
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        TONE_CLASS[tone],
        className,
      )}
    />
  );
}

export function healthTone(
  status: "ok" | "degraded" | "down" | "unknown",
): StatusTone {
  switch (status) {
    case "ok":
      return "good";
    case "degraded":
      return "warning";
    case "down":
      return "critical";
    default:
      return "muted";
  }
}

export function runTone(
  status: "pending" | "running" | "completed" | "failed",
): StatusTone {
  switch (status) {
    case "completed":
      return "good";
    case "failed":
      return "critical";
    case "running":
      return "warning";
    default:
      return "muted";
  }
}

export function usageTone(percent: number | null | undefined): StatusTone {
  if (percent === null || percent === undefined) return "muted";
  if (percent >= 90) return "critical";
  if (percent >= 80) return "serious";
  return "good";
}
