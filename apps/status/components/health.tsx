import { cn } from "@repo/ui/utils";
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  type LucideIcon,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { healthLabels } from "@/lib/health";
import type { DayHealth, Health } from "@/lib/model";

export const healthIcons: Record<Health, LucideIcon> = {
  operational: CircleCheck,
  degraded: TriangleAlert,
  down: CircleX,
  maintenance: Wrench,
  unknown: CircleHelp,
};
export const healthText: Record<Health, string> = {
  operational: "text-status-good",
  degraded: "text-status-warning",
  down: "text-status-critical",
  maintenance: "text-status-info",
  unknown: "text-muted-foreground/60",
};
export const healthFill: Record<Health, string> = {
  operational: "bg-status-good",
  degraded: "bg-status-warning",
  down: "bg-status-critical",
  maintenance: "bg-status-info",
  unknown: "bg-muted-foreground/25",
};
/** Orange is a partial outage on the bar; maintenance is blue so a planned window never reads as one. */
export const dayFill: Record<DayHealth, string> = {
  operational: "bg-status-good",
  degraded: "bg-status-warning",
  partial: "bg-status-serious",
  down: "bg-status-critical",
  unknown: "bg-muted-foreground/25",
};
/**
 * The banner is a solid fill, so the label sits on the status colour itself.
 * Which neutral stays legible flips with the theme: the light palette's green
 * and red are dark enough to carry white, everything else — and every colour in
 * the dark palette, which is lightened across the board — needs dark text.
 */
export const healthBanner: Record<Health, string> = {
  operational: "bg-status-good text-white dark:text-black/85",
  degraded: "bg-status-warning text-black/85",
  down: "bg-status-critical text-white dark:text-black/85",
  maintenance: "bg-status-info text-white dark:text-black/85",
  unknown: "bg-muted-foreground/30 text-foreground",
};
export const headlines: Record<Health, string> = {
  operational: "All Systems Operational",
  degraded: "Some Systems Experiencing Issues",
  down: "System Outage",
  maintenance: "Under maintenance",
  unknown: "No recent data",
};

/** Colour alone never carries the state; every dot names itself for a reader. */
export function Dot({
  status,
  className,
}: {
  status: Health;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={healthLabels[status]}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        healthFill[status],
        className,
      )}
    />
  );
}
export function HealthIcon({
  status,
  className,
}: {
  status: Health;
  className?: string;
}) {
  const Icon = healthIcons[status];
  return (
    <Icon
      aria-hidden
      className={cn("size-4 shrink-0", healthText[status], className)}
    />
  );
}
export function HealthLabel({
  status,
  className,
}: {
  status: Health;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[11px] font-medium tracking-wide uppercase tabular-nums",
        healthText[status],
        className,
      )}
    >
      {healthLabels[status]}
    </span>
  );
}
