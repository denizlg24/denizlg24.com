import { cn } from "./utils";

export type StatusTone = "good" | "warning" | "serious" | "critical" | "muted";

const TONE_CLASS: Record<StatusTone, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  serious: "bg-status-serious",
  critical: "bg-status-critical",
  muted: "bg-muted-foreground/50",
};

// Colour alone is not a status indicator: assistive tech and CVD users get the
// same reading from the adjacent label only if the dot carries a name too.
export function StatusDot({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label?: string;
  className?: string;
}) {
  const shape = cn(
    "inline-block size-2 shrink-0 rounded-full",
    TONE_CLASS[tone],
    className,
  );
  return label ? (
    <span role="img" aria-label={label} className={shape} />
  ) : (
    <span aria-hidden className={shape} />
  );
}

export function usageTone(percent: number | null | undefined): StatusTone {
  if (percent === null || percent === undefined) return "muted";
  if (percent >= 90) return "critical";
  if (percent >= 80) return "serious";
  return "good";
}
